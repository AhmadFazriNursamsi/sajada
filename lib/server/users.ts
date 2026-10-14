import { pool, inTenant, UserError } from "./db.ts";
import { audit, endSessions } from "./auth.ts";
import { hashPassword, passwordProblem, verifyPassword } from "./password.ts";
import { isRole, isStaff, ROLE_LABELS, type Role } from "../roles.ts";

// Account management for the admin (Pengaturan → Pengguna & akses) and a user's own password.

export type UserRow = {
  id: string;
  username: string;
  name: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  /** Staff: koperasi the account may open. Member/investor: its one koperasi. */
  tenants: string[];
  /** Member/investor accounts: the person they belong to. */
  person: { id: string; name: string } | null;
  lockedUntil: string | null;
};

export type UserInput = {
  username: string;
  name: string;
  role: string;
  /** Staff accounts (ignored for admin, who opens every koperasi). */
  tenants: string[];
  /** Member/investor accounts: koperasi and member/investor id there. */
  tenant?: string;
  personId?: string;
};

const USERNAME = /^[a-z0-9._-]{3,40}$/;

export async function listUsers(): Promise<UserRow[]> {
  const rows = (
    await pool().query(`SELECT u.id,u.username,u.display_name,u.role,u.active,u.must_change_password,u.locked_until,u.member_id,u.investor_id,
        coalesce((SELECT array_agg(t.name ORDER BY t.name) FROM sajada.app_user_tenant a JOIN sajada.tenant t ON t.id=a.tenant_id WHERE a.user_id=u.id),'{}') AS staff_tenants,
        (SELECT name FROM sajada.tenant WHERE id=u.tenant_id) AS own_tenant
      FROM sajada.app_user u ORDER BY u.active DESC, u.role, u.username`)
  ).rows;
  const out: UserRow[] = [];
  for (const r of rows) {
    let person: UserRow["person"] = null;
    if (r.own_tenant && (r.member_id || r.investor_id))
      person = await inTenant(r.own_tenant, async (c, t) => {
        const q = r.member_id
          ? await c.query("SELECT id,name FROM sajada.member WHERE tenant_id=$1 AND id=$2", [t, r.member_id])
          : await c.query("SELECT id,name FROM sajada.investor WHERE tenant_id=$1 AND id=$2", [t, r.investor_id]);
        return q.rows[0] ? { id: q.rows[0].id, name: q.rows[0].name } : null;
      });
    out.push({
      id: r.id, username: r.username, name: r.display_name, role: r.role, active: r.active, mustChangePassword: r.must_change_password,
      tenants: r.role === "admin" ? [] : r.own_tenant ? [r.own_tenant] : r.staff_tenants, person,
      lockedUntil: r.locked_until && new Date(r.locked_until) > new Date() ? new Date(r.locked_until).toISOString() : null,
    });
  }
  return out;
}

/** Members and investors of a koperasi, to link member/investor accounts. */
export function listPeople(tenant: string) {
  return inTenant(tenant, async (c, t) => ({
    members: (await c.query("SELECT id,name FROM sajada.member WHERE tenant_id=$1 ORDER BY name", [t])).rows as { id: string; name: string }[],
    investors: (await c.query("SELECT id,name FROM sajada.investor WHERE tenant_id=$1 AND code IS NOT NULL ORDER BY name", [t])).rows as { id: string; name: string }[],
  }));
}

async function tenantIds(names: string[]): Promise<string[]> {
  const unique = [...new Set(names)];
  const rows = (await pool().query("SELECT id,name FROM sajada.tenant WHERE name = ANY($1)", [unique])).rows;
  if (rows.length !== unique.length) throw new UserError("Koperasi tidak ditemukan.");
  return rows.map((r) => r.id);
}

function check(input: UserInput) {
  const username = String(input.username ?? "").trim().toLowerCase();
  if (!USERNAME.test(username)) throw new UserError("Username 3–40 karakter: huruf kecil, angka, titik, garis bawah atau tanda hubung.");
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 100) throw new UserError("Nama tampilan wajib diisi (maksimal 100 karakter).");
  if (!isRole(input.role)) throw new UserError("Peran tidak dikenal.");
  const role = input.role;
  if (isStaff(role)) {
    if (role !== "admin" && !input.tenants?.length) throw new UserError("Pilih minimal satu koperasi untuk akun ini.");
  } else if (!input.tenant || !input.personId) throw new UserError(`Pilih koperasi dan ${role === "member" ? "anggota" : "investor"} untuk akun ${ROLE_LABELS[role]}.`);
  return { username, name, role };
}

/** Columns for the account's role: staff use app_user_tenant, member/investor one person. */
async function personColumns(role: Role, input: UserInput) {
  if (isStaff(role)) return { tenantId: null, memberId: null, investorId: null };
  const [tenantId] = await tenantIds([input.tenant!]);
  const people = await listPeople(input.tenant!);
  const list = role === "member" ? people.members : people.investors;
  if (!list.some((p) => p.id === input.personId)) throw new UserError(role === "member" ? "Anggota tidak ditemukan di koperasi ini." : "Investor tidak ditemukan di koperasi ini.");
  return { tenantId, memberId: role === "member" ? input.personId! : null, investorId: role === "investor" ? input.personId! : null };
}

export async function createUser(actorId: string, input: UserInput, password: string): Promise<string> {
  const { username, name, role } = check(input);
  const problem = passwordProblem(password);
  if (problem) throw new UserError(problem);
  const p = await personColumns(role, input);
  const hash = await hashPassword(password);
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    if ((await c.query("SELECT 1 FROM sajada.app_user WHERE username=$1", [username])).rows[0]) throw new UserError("Username sudah dipakai.");
    const id = (
      await c.query(
        "INSERT INTO sajada.app_user(username,display_name,role,password_hash,must_change_password,tenant_id,member_id,investor_id) VALUES($1,$2,$3,$4,true,$5,$6,$7) RETURNING id",
        [username, name, role, hash, p.tenantId, p.memberId, p.investorId],
      )
    ).rows[0].id;
    if (isStaff(role) && role !== "admin")
      for (const t of await tenantIds(input.tenants)) await c.query("INSERT INTO sajada.app_user_tenant(user_id,tenant_id) VALUES($1,$2)", [id, t]);
    await c.query("COMMIT");
    await audit("create", id, actorId, { username, role, tenants: role === "admin" ? "all" : isStaff(role) ? input.tenants : [input.tenant] });
    return id;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

async function activeAdmins(exceptId: string) {
  return Number((await pool().query("SELECT count(*) FROM sajada.app_user WHERE role='admin' AND active AND id<>$1", [exceptId])).rows[0].count);
}

export async function updateUser(actorId: string, id: string, input: UserInput & { active: boolean }) {
  const old = (await pool().query("SELECT username,role,active FROM sajada.app_user WHERE id=$1", [id])).rows[0];
  if (!old) throw new UserError("Akun tidak ditemukan.");
  const { name, role } = check({ ...input, username: old.username });
  const active = !!input.active;
  if (old.role === "admin" && (role !== "admin" || !active) && (await activeAdmins(id)) === 0)
    throw new UserError("Harus ada minimal satu admin aktif. Buat admin lain terlebih dahulu.");
  const p = await personColumns(role, input);
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    await c.query("UPDATE sajada.app_user SET display_name=$2,role=$3,active=$4,tenant_id=$5,member_id=$6,investor_id=$7,updated_at=now() WHERE id=$1", [
      id, name, role, active, p.tenantId, p.memberId, p.investorId,
    ]);
    await c.query("DELETE FROM sajada.app_user_tenant WHERE user_id=$1", [id]);
    if (isStaff(role) && role !== "admin")
      for (const t of await tenantIds(input.tenants)) await c.query("INSERT INTO sajada.app_user_tenant(user_id,tenant_id) VALUES($1,$2)", [id, t]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  // A changed role, access or a deactivation takes effect at once.
  if (old.role !== role || old.active !== active || !active) await endSessions(id);
  await audit("update", id, actorId, { role, active, tenants: role === "admin" ? "all" : isStaff(role) ? input.tenants : [input.tenant] });
}

/** Admin sets a temporary password; the user must replace it at the next sign-in. */
export async function resetPassword(actorId: string, id: string, password: string) {
  const problem = passwordProblem(password);
  if (problem) throw new UserError(problem);
  const r = await pool().query("UPDATE sajada.app_user SET password_hash=$2,must_change_password=true,failed_logins=0,locked_until=NULL,updated_at=now() WHERE id=$1", [id, await hashPassword(password)]);
  if (!r.rowCount) throw new UserError("Akun tidak ditemukan.");
  await endSessions(id);
  await audit("password_reset", id, actorId);
}

export async function changeOwnPassword(userId: string, current: string, next: string) {
  const row = (await pool().query("SELECT password_hash FROM sajada.app_user WHERE id=$1 AND active", [userId])).rows[0];
  if (!row || !(await verifyPassword(String(current ?? ""), row.password_hash))) throw new UserError("Password saat ini salah.");
  const problem = passwordProblem(next);
  if (problem) throw new UserError(problem);
  if (current === next) throw new UserError("Password baru harus berbeda dari password saat ini.");
  await pool().query("UPDATE sajada.app_user SET password_hash=$2,must_change_password=false,updated_at=now() WHERE id=$1", [userId, await hashPassword(next)]);
  await audit("password_change", userId, userId);
}
