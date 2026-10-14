import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { pool, UserError } from "./db.ts";
import { dummyHash, verifyPassword } from "./password.ts";
import { isRole, isStaff, type Role, type SessionUser } from "../roles.ts";

// Sign-in sessions for the web app. The cookie holds a random token; the database keeps only
// its SHA-256. A session ends after 12 hours without use and at most 7 days after sign-in.
export const SESSION_COOKIE = "sajada_session";
const IDLE_HOURS = 12;
const MAX_DAYS = 7;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

// The national koperasi first (the app's default), then the others by name.
export const TENANT_ORDER = "(name LIKE '%Nasional') DESC, name";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function audit(action: string, userId: string | null, actorId: string | null, detail: object = {}) {
  await pool().query("INSERT INTO sajada.app_user_audit(action,user_id,actor_id,detail) VALUES($1,$2,$3,$4)", [action, userId, actorId, JSON.stringify(detail)]);
}

async function secureCookie() {
  // Behind the HTTPS reverse proxy (X-Forwarded-Proto: https) the cookie is HTTPS-only.
  return (await headers()).get("x-forwarded-proto")?.split(",")[0].trim() === "https";
}

/** Checks the password and starts a session. Returns an error message for the form, or null. */
export async function signIn(usernameInput: string, password: string): Promise<{ error: string } | { user: SessionUser }> {
  const username = String(usernameInput ?? "").trim().toLowerCase();
  const row = (await pool().query("SELECT id,password_hash,active,failed_logins,locked_until FROM sajada.app_user WHERE username=$1", [username])).rows[0];
  if (!row) {
    await verifyPassword(String(password ?? ""), await dummyHash());
    return { error: "Username atau password salah." };
  }
  if (row.locked_until && new Date(row.locked_until) > new Date())
    return { error: `Terlalu banyak percobaan gagal. Coba lagi setelah ${LOCK_MINUTES} menit.` };
  const ok = await verifyPassword(String(password ?? ""), row.password_hash);
  if (!ok || !row.active) {
    if (ok && !row.active) {
      await audit("login_failed", row.id, null, { reason: "inactive" });
      return { error: "Akun ini dinonaktifkan. Hubungi admin koperasi." };
    }
    // The fifth failure in a row locks the account for a while and starts the count again.
    const failures = row.failed_logins + 1;
    if (failures >= MAX_FAILURES)
      await pool().query("UPDATE sajada.app_user SET failed_logins=0, locked_until=now()+make_interval(mins=>$2) WHERE id=$1", [row.id, LOCK_MINUTES]);
    else await pool().query("UPDATE sajada.app_user SET failed_logins=$2 WHERE id=$1", [row.id, failures]);
    await audit("login_failed", row.id, null, { reason: failures >= MAX_FAILURES ? "password, locked" : "password" });
    return { error: "Username atau password salah." };
  }
  await pool().query("UPDATE sajada.app_user SET failed_logins=0, locked_until=NULL WHERE id=$1", [row.id]);
  const token = randomBytes(32).toString("base64url");
  await pool().query("INSERT INTO sajada.app_session(token_hash,user_id,expires_at) VALUES($1,$2,now()+make_interval(hours=>$3))", [sha256(token), row.id, IDLE_HOURS]);
  await pool().query("DELETE FROM sajada.app_session WHERE expires_at<now()");
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: await secureCookie(), path: "/", maxAge: MAX_DAYS * 86400 });
  await audit("login", row.id, row.id);
  const user = await userById(row.id);
  if (!user) throw new Error("Akun tidak ditemukan setelah login.");
  return { user };
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const row = (await pool().query("DELETE FROM sajada.app_session WHERE token_hash=$1 RETURNING user_id", [sha256(token)])).rows[0];
    if (row) await audit("logout", row.user_id, row.user_id);
  }
  jar.delete(SESSION_COOKIE);
}

/** Ends every session of a user (password reset, deactivation, role change). */
export async function endSessions(userId: string) {
  await pool().query("DELETE FROM sajada.app_session WHERE user_id=$1", [userId]);
}

export async function userById(id: string): Promise<SessionUser | null> {
  const u = (await pool().query("SELECT id,username,display_name,role,must_change_password,tenant_id FROM sajada.app_user WHERE id=$1 AND active", [id])).rows[0];
  if (!u || !isRole(u.role)) return null;
  const role = u.role as Role;
  let tenants: string[];
  if (role === "admin") tenants = (await pool().query(`SELECT name FROM sajada.tenant ORDER BY ${TENANT_ORDER}`)).rows.map((r) => r.name);
  else if (isStaff(role))
    tenants = (await pool().query(`SELECT name FROM sajada.app_user_tenant a JOIN sajada.tenant t ON t.id=a.tenant_id WHERE a.user_id=$1 ORDER BY ${TENANT_ORDER}`, [id])).rows.map((r) => r.name);
  else tenants = (await pool().query("SELECT name FROM sajada.tenant WHERE id=$1", [u.tenant_id])).rows.map((r) => r.name);
  return { id: u.id, username: u.username, name: u.display_name, role, mustChangePassword: u.must_change_password, tenants };
}

/** The signed-in user of this request, or null. Extends the session while it is in use. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = (
    await pool().query(
      `UPDATE sajada.app_session SET expires_at=least(now()+make_interval(hours=>$2), created_at+make_interval(days=>$3))
        WHERE token_hash=$1 AND expires_at>now() RETURNING user_id`,
      [sha256(token), IDLE_HOURS, MAX_DAYS],
    )
  ).rows[0];
  return s ? userById(s.user_id) : null;
}

/** The signed-in user, or a UserError the app shows (its session ended or it was disabled). */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new UserError("Sesi login berakhir. Muat ulang halaman lalu login kembali.");
  return user;
}

/** A staff user who may open this koperasi and has already replaced a temporary password. */
export async function requireStaff(tenant: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!isStaff(user.role)) throw new UserError("Akun anggota/investor hanya dapat membuka portal.");
  if (user.mustChangePassword) throw new UserError("Ganti password sementara Anda terlebih dahulu.");
  if (!user.tenants.includes(tenant)) throw new UserError("Akun Anda tidak memiliki akses ke koperasi ini.");
  return user;
}
