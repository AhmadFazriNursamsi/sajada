import { inTenant, pool, UserError, type Tx } from "./db.ts";
import { hashPassword, passwordProblem } from "./password.ts";
import { bump, readAll, validateWorkspace } from "./workspace/index.ts";
import { saveMain, type MainSection } from "./workspace/main.ts";
import { SECTION_STORES } from "./workspace/sections.ts";
import { assignRegion, regionPath, type RegionData } from "../../shared/regions.ts";
import { validateGraph } from "../../shared/mlm.ts";

// Member self-registration (Bab 2): a prospective member applies on the public /daftar page; a
// member officer or admin of that koperasi approves it, which creates the member (with area,
// region placement and sponsor) and its portal account in one transaction, or rejects it.

export const FAMILY_STATUS: Record<string, string> = { J: "Janda", D: "Duda", B: "Bapak", I: "Ibu", L: "Anak laki-laki", P: "Anak perempuan" };
const USERNAME = /^[a-z0-9._-]{3,40}$/;
const PHONE = /^\+?[0-9]{8,15}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PER_IP_PER_HOUR = 5;

export type RegistrationInput = {
  tenant: string; name: string; phone: string; email: string; familyStatus: string;
  regionId: string; area: string; sponsor: string; username: string; password: string;
};
export type Registration = {
  id: string; name: string; phone: string; email: string | null; familyStatus: string; area: string;
  regionId: string | null; sponsorNote: string | null; username: string; status: string; createdAt: string;
  decisionNote: string | null;
};
export type MemberProfile = { phone: string | null; email: string | null; familyStatus: string | null };

const text = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");
const normalPhone = (v: unknown) => String(v ?? "").replace(/[\s().-]/g, "");

/** Koperasi a prospective member can choose (names only). */
export async function publicTenants(): Promise<string[]> {
  return (await pool().query("SELECT name FROM sajada.tenant ORDER BY name")).rows.map((r) => r.name);
}

async function villages(c: Tx, t: string) {
  const regions = (await c.query("SELECT id,name,level,parent_id FROM sajada.web_region WHERE tenant_id=$1 ORDER BY seq", [t])).rows
    .map((r) => ({ id: r.id, name: r.name, level: r.level, parentId: r.parent_id }));
  return regions.filter((r) => r.level === "village").map((r) => ({
    id: r.id,
    // Kelurahan, kecamatan, kabupaten/kota (the province is left out to keep it short).
    label: regionPath(regions, r.id).reverse().filter((x) => x.level !== "province").map((x) => x.name).join(", "),
  }));
}

/** Kelurahan/desa of a koperasi's Struktur daerah, for the sign-up form (empty: type the area). */
export function registrationRegions(tenant: string) {
  return inTenant(tenant, (c, t) => villages(c, t));
}

export async function submitRegistration(input: RegistrationInput, clientIp: string): Promise<void> {
  const name = text(input.name), phone = normalPhone(input.phone), email = text(input.email).toLowerCase();
  const username = text(input.username).toLowerCase(), sponsor = text(input.sponsor), family = text(input.familyStatus);
  if (name.length < 3 || name.length > 100) throw new UserError("Nama lengkap 3–100 karakter.");
  if (!PHONE.test(phone)) throw new UserError("Nomor HP 8–15 angka, boleh diawali +.");
  if (email && (email.length > 200 || !EMAIL.test(email))) throw new UserError("Format email tidak valid.");
  if (!FAMILY_STATUS[family]) throw new UserError("Pilih status keluarga.");
  if (sponsor.length > 100) throw new UserError("Nama pengajak maksimal 100 karakter.");
  if (!USERNAME.test(username)) throw new UserError("Username 3–40 karakter: huruf kecil, angka, titik, garis bawah atau tanda hubung.");
  const problem = passwordProblem(input.password);
  if (problem) throw new UserError(problem);
  const recent = Number((await pool().query("SELECT count(*) FROM sajada.member_registration WHERE client_ip=$1 AND created_at>now()-interval '1 hour'", [clientIp])).rows[0].count);
  if (recent >= PER_IP_PER_HOUR) throw new UserError("Terlalu banyak pendaftaran dari jaringan ini. Coba lagi dalam satu jam.");
  const hash = await hashPassword(input.password);
  await inTenant(input.tenant, async (c, t) => {
    const options = await villages(c, t);
    let regionId: string | null = null, area: string;
    if (options.length) {
      const chosen = options.find((v) => v.id === input.regionId);
      if (!chosen) throw new UserError("Pilih kelurahan/desa tempat tinggal.");
      regionId = chosen.id;
      area = chosen.label.slice(0, 100);
    } else {
      area = text(input.area);
      if (area.length < 2 || area.length > 100) throw new UserError("Isi daerah tempat tinggal (2–100 karakter).");
    }
    if ((await c.query("SELECT 1 FROM sajada.app_user WHERE username=$1", [username])).rows[0] || (await c.query("SELECT 1 FROM sajada.member_registration WHERE username=$1 AND status='pending'", [username])).rows[0])
      throw new UserError("Username sudah dipakai. Pilih username lain.");
    if ((await c.query("SELECT 1 FROM sajada.member_registration WHERE tenant_id=$1 AND phone=$2 AND status='pending'", [t, phone])).rows[0])
      throw new UserError("Nomor HP ini sudah punya pendaftaran yang menunggu persetujuan.");
    await c.query(
      `INSERT INTO sajada.member_registration(tenant_id,full_name,phone,email,family_status,region_id,area,sponsor_note,username,password_hash,client_ip)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [t, name, phone, email || null, family, regionId, area, sponsor || null, username, hash, clientIp],
    );
  });
}

const toRegistration = (r: Record<string, any>): Registration => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  id: r.id, name: r.full_name, phone: r.phone, email: r.email, familyStatus: r.family_status, area: r.area, regionId: r.region_id,
  sponsorNote: r.sponsor_note, username: r.username, status: r.status, createdAt: new Date(r.created_at).toISOString(), decisionNote: r.decision_note,
});

/** Requests of a koperasi: pending first, then the last 20 decisions. */
export function listRegistrations(tenant: string) {
  return inTenant(tenant, async (c, t) => ({
    pending: (await c.query("SELECT * FROM sajada.member_registration WHERE tenant_id=$1 AND status='pending' ORDER BY created_at", [t])).rows.map(toRegistration),
    decided: (await c.query("SELECT * FROM sajada.member_registration WHERE tenant_id=$1 AND status<>'pending' ORDER BY decided_at DESC LIMIT 20", [t])).rows.map(toRegistration),
  }));
}

export function pendingCount(tenant: string): Promise<number> {
  return inTenant(tenant, async (c, t) => Number((await c.query("SELECT count(*) FROM sajada.member_registration WHERE tenant_id=$1 AND status='pending'", [t])).rows[0].count));
}

async function pendingRow(c: Tx, t: string, id: string) {
  const row = (await c.query("SELECT * FROM sajada.member_registration WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [t, id])).rows[0];
  if (!row) throw new UserError("Pendaftaran tidak ditemukan.");
  if (row.status !== "pending") throw new UserError("Pendaftaran ini sudah diputuskan.");
  return row;
}

/**
 * Approves a request: the member (under the given name), its region placement and sponsor are
 * written through the same workspace stores and integrity rules as the app's own saves, then
 * the portal account is created with the password the applicant chose.
 */
export function approveRegistration(actor: { id: string }, tenant: string, id: string, decision: { name: string; sponsor: string | null }): Promise<string> {
  return inTenant(tenant, async (c, t) => {
    const row = await pendingRow(c, t, id);
    const name = text(decision.name);
    if (name.length < 3 || name.length > 100) throw new UserError("Nama anggota 3–100 karakter.");
    if ((await c.query("SELECT 1 FROM sajada.app_user WHERE username=$1", [row.username])).rows[0])
      throw new UserError(`Username ${row.username} sudah dipakai akun lain. Tolak pendaftaran ini dan minta pendaftar memakai username lain.`);
    const before = await readAll(c, t, tenant);
    const main = before["sajada-v2"] as MainSection;
    if (main.members.some((m) => String(m[0]).toLowerCase() === name.toLowerCase()))
      throw new UserError(`Nama "${name}" sudah dipakai anggota lain di koperasi ini. Ubah nama (mis. tambah nama belakang) sebelum menyetujui.`);
    const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const nextMain: MainSection = { ...main, members: [...main.members, [name, initials, row.area, "Bronze", 0]] };
    const names = nextMain.members.map((m) => String(m[0]));
    const next: Record<string, unknown> = { ...before, "sajada-v2": nextMain };
    const sponsor = decision.sponsor ? text(decision.sponsor) : null;
    if (sponsor) {
      if (!names.includes(sponsor) || sponsor === name) throw new UserError("Sponsor harus anggota lain di koperasi ini.");
      const graph = { ...((before["sajada-network"] as Record<string, string | null>) ?? {}), [name]: sponsor };
      for (const n of names) if (!(n in graph)) graph[n] = null;
      next["sajada-network"] = validateGraph(graph);
    }
    if (row.region_id && before["sajada-regions"]) next["sajada-regions"] = assignRegion(before["sajada-regions"] as RegionData, name, row.region_id, names);
    validateWorkspace(tenant, next);
    await saveMain(c, t, main, nextMain);
    for (const section of ["sajada-network", "sajada-regions"])
      if (next[section] !== before[section]) await SECTION_STORES[section].save(c, t, before[section], next[section]);
    const memberId = (await c.query(
      "UPDATE sajada.member SET phone=$3,email=$4,family_status=$5 WHERE tenant_id=$1 AND name=$2 RETURNING id",
      [t, name, row.phone, row.email, row.family_status],
    )).rows[0].id;
    const userId = (await c.query(
      "INSERT INTO sajada.app_user(username,display_name,role,password_hash,must_change_password,tenant_id,member_id) VALUES($1,$2,'member',$3,false,$4,$5) RETURNING id",
      [row.username, name, row.password_hash, t, memberId],
    )).rows[0].id;
    await c.query("UPDATE sajada.member_registration SET status='approved',decided_at=now(),decided_by=$3,member_id=$4 WHERE tenant_id=$1 AND id=$2", [t, id, actor.id, memberId]);
    await c.query("INSERT INTO sajada.app_user_audit(action,user_id,actor_id,detail) VALUES('create',$1,$2,$3)", [userId, actor.id, JSON.stringify({ username: row.username, role: "member", via: "pendaftaran", tenant })]);
    await bump(c, t);
    return name;
  });
}

export function rejectRegistration(actor: { id: string }, tenant: string, id: string, note: string): Promise<void> {
  return inTenant(tenant, async (c, t) => {
    await pendingRow(c, t, id);
    const reason = text(note);
    if (reason.length < 3 || reason.length > 300) throw new UserError("Tulis alasan penolakan (3–300 karakter); alasan ini dilihat pendaftar saat mencoba login.");
    await c.query("UPDATE sajada.member_registration SET status='rejected',decided_at=now(),decided_by=$3,decision_note=$4 WHERE tenant_id=$1 AND id=$2", [t, id, actor.id, reason]);
  });
}

/** Contact and family status of every member of a koperasi, by member name. */
export function memberProfiles(tenant: string): Promise<Record<string, MemberProfile>> {
  return inTenant(tenant, async (c, t) =>
    Object.fromEntries((await c.query("SELECT name,phone,email,family_status FROM sajada.member WHERE tenant_id=$1", [t])).rows
      .map((r) => [r.name, { phone: r.phone, email: r.email, familyStatus: r.family_status }])));
}

export function setMemberProfile(tenant: string, name: string, profile: MemberProfile): Promise<void> {
  const phone = profile.phone ? normalPhone(profile.phone) : null, email = profile.email ? text(profile.email).toLowerCase() : null;
  if (phone && !PHONE.test(phone)) throw new UserError("Nomor HP 8–15 angka, boleh diawali +.");
  if (email && !EMAIL.test(email)) throw new UserError("Format email tidak valid.");
  if (!profile.familyStatus || !FAMILY_STATUS[profile.familyStatus]) throw new UserError("Pilih status keluarga.");
  return inTenant(tenant, async (c, t) => {
    const r = await c.query("UPDATE sajada.member SET phone=$3,email=$4,family_status=$5 WHERE tenant_id=$1 AND name=$2", [t, name, phone, email, profile.familyStatus]);
    if (!r.rowCount) throw new UserError("Anggota tidak ditemukan.");
  });
}

/** For the sign-in page: the state of a not-yet-approved request with this username and password. */
export async function registrationState(username: string): Promise<{ status: string; note: string | null; hash: string } | null> {
  const r = (await pool().query("SELECT status,decision_note,password_hash FROM sajada.member_registration WHERE username=$1 AND status<>'approved' ORDER BY created_at DESC LIMIT 1", [username])).rows[0];
  return r ? { status: r.status, note: r.decision_note, hash: r.password_hash } : null;
}
