import { pool, UserError } from "./db.ts";
import { audit, TENANT_ORDER } from "./auth.ts";

// Koperasi (tenants) are created and renamed by the admin (Pengaturan → Koperasi); nothing is
// pre-filled. A koperasi name is its key in the web app, so names are unique (ignoring case).
export type TenantRow = { id: string; name: string; currency: string };

function cleanName(input: string) {
  const name = String(input ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 100) throw new UserError("Nama koperasi 3–100 karakter.");
  return name;
}

export async function listTenants(): Promise<TenantRow[]> {
  return (await pool().query(`SELECT id,name,base_currency AS currency FROM sajada.tenant ORDER BY ${TENANT_ORDER}`)).rows;
}

async function nameTaken(name: string, exceptId: string | null) {
  return !!(await pool().query("SELECT 1 FROM sajada.tenant WHERE lower(name)=lower($1) AND id IS DISTINCT FROM $2", [name, exceptId])).rows[0];
}

export async function createTenant(actorId: string, input: string): Promise<string> {
  const name = cleanName(input);
  if (await nameTaken(name, null)) throw new UserError("Nama koperasi sudah dipakai.");
  const id = (await pool().query("INSERT INTO sajada.tenant(name,base_currency) VALUES($1,'IDR') RETURNING id", [name])).rows[0].id;
  await audit("update", actorId, actorId, { tenant: name, change: "koperasi dibuat" });
  return id;
}

export async function renameTenant(actorId: string, id: string, input: string) {
  const name = cleanName(input);
  if (await nameTaken(name, id)) throw new UserError("Nama koperasi sudah dipakai.");
  const old = (await pool().query("SELECT name FROM sajada.tenant WHERE id=$1", [id])).rows[0];
  if (!old) throw new UserError("Koperasi tidak ditemukan.");
  await pool().query("UPDATE sajada.tenant SET name=$2 WHERE id=$1", [id, name]);
  await audit("update", actorId, actorId, { tenant: name, change: `nama koperasi dari ${old.name}` });
}
