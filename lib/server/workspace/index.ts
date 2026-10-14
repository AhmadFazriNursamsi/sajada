import { ZodError } from "zod";
import { validateBackup } from "../../../shared/backup.ts";
import { DB_SECTIONS } from "../../../shared/workspace-sections.ts";
import { inTenant, UserError, type Tx } from "../db.ts";
import { readMain, saveMain, type MainSection } from "./main.ts";
import { SECTION_STORES } from "./sections.ts";
import { demoMain } from "./demo.ts";
import { withDatabaseIds } from "./legacy-ids.ts";
import { authorizeSave } from "./authorize.ts";
import type { Role } from "../../roles.ts";
import { emptyNumbers, validateNumberRestore, type NumberState } from "../../../shared/member-number.ts";

type Sections = Record<string, unknown>;

async function readAll(c: Tx, t: string, tenantName: string): Promise<Sections> {
  const data: Sections = { "sajada-v2": await readMain(c, t, tenantName) };
  for (const [section, store] of Object.entries(SECTION_STORES)) data[section] = await store.read(c, t);
  return data;
}

export type Workspace = { sections: Sections; revision: number };

async function revision(c: Tx, t: string): Promise<number> {
  await c.query("INSERT INTO sajada.web_workspace_revision(tenant_id) VALUES($1) ON CONFLICT DO NOTHING", [t]);
  return Number((await c.query("SELECT revision FROM sajada.web_workspace_revision WHERE tenant_id=$1", [t])).rows[0].revision);
}
async function bump(c: Tx, t: string): Promise<number> {
  await revision(c, t);
  return Number((await c.query("UPDATE sajada.web_workspace_revision SET revision=revision+1 WHERE tenant_id=$1 RETURNING revision", [t])).rows[0].revision);
}

/** All database-backed sections of one tenant (keyed like the web app's storage keys) and their revision. */
export function loadWorkspace(tenantName: string): Promise<Workspace> {
  return inTenant(tenantName, async (c, t) => ({ sections: await readAll(c, t, tenantName), revision: await revision(c, t) }));
}

/**
 * Replaces one section (null removes it). The change must be allowed for the actor's role
 * (authorize.ts), and the whole tenant workspace (database sections plus any browser-held
 * sections passed as context) must pass the same integrity rules as a backup restore before
 * anything is written.
 */
export function saveSection(actor: { role: Role; name: string }, tenantName: string, section: string, value: unknown, browserSections: Sections, expectedRevision: number): Promise<number> {
  if (!DB_SECTIONS.includes(section)) throw new UserError("Bagian data tidak dikenal.");
  return inTenant(tenantName, async (c, t) => {
    if ((await revision(c, t)) !== expectedRevision)
      throw new UserError("Data koperasi sudah diubah di tab atau perangkat lain. Data terbaru dimuat ulang; ulangi perubahan Anda.");
    const before = await readAll(c, t, tenantName);
    authorizeSave(actor, section, before[section], value);
    const context = Object.fromEntries(Object.entries(browserSections).filter(([key, v]) => !DB_SECTIONS.includes(key) && v != null));
    validateWorkspace(tenantName, { ...context, ...before, [section]: value });
    if (section === "sajada-v2") {
      if (value == null) throw new UserError("Data utama koperasi tidak dapat dihapus.");
      await saveMain(c, t, before[section] as MainSection, value as MainSection);
    } else {
      await SECTION_STORES[section].save(c, t, before[section], value);
    }
    return bump(c, t);
  });
}

// Sections the app's "Reset data demo" removes; members, numbers, network, regions and funding stay.
const RESET_SECTIONS = ["sajada-ledger", "sajada-commissions", "sajada-member-capital", "sajada-capital-fees", "sajada-profit-sharing", "sajada-tiered-sharing"];

/** Demo reset: clears sales, stock and purchasing, then restores the demo catalog and depot. */
export function resetWorkspace(tenantName: string): Promise<void> {
  return inTenant(tenantName, (c, t) => resetIn(c, t, tenantName));
}
export async function resetIn(c: Tx, t: string, tenantName: string) {
  const before = await readAll(c, t, tenantName);
  await c.query("SELECT sajada.web_clear_workspace($1,'transactions')", [t]);
  for (const section of RESET_SECTIONS) await SECTION_STORES[section].save(c, t, before[section], null);
  const cleared = await readMain(c, t, tenantName);
  const next = demoMain(tenantName, cleared.members);
  validateWorkspace(tenantName, { ...(await readAll(c, t, tenantName)), "sajada-v2": next });
  await saveMain(c, t, cleared, next);
  await bump(c, t);
}

/** Backup restore: replaces every section of the tenant with the backup's sections. */
export function restoreWorkspace(tenantName: string, sections: Sections): Promise<void> {
  if (!sections || typeof sections !== "object" || sections["sajada-v2"] == null) throw new UserError("Data utama anggota/transaksi wajib ada.");
  if (Object.keys(sections).some((k) => !DB_SECTIONS.includes(k))) throw new UserError("Bagian backup tidak dikenali.");
  const data: Sections = { ...sections, "sajada-v2": withDatabaseIds(sections["sajada-v2"]) };
  validateWorkspace(tenantName, data);
  return inTenant(tenantName, (c, t) => restoreIn(c, t, tenantName, data));
}
export async function restoreIn(c: Tx, t: string, tenantName: string, data: Sections) {
  const current = await readAll(c, t, tenantName);
  validateNumberRestore((current["sajada-member-numbers"] as NumberState) ?? emptyNumbers(), (data["sajada-member-numbers"] as NumberState) ?? emptyNumbers());
  await c.query("SELECT sajada.web_clear_workspace($1,'everything')", [t]);
  const cleared = await readAll(c, t, tenantName);
  for (const [section, store] of Object.entries(SECTION_STORES)) await store.save(c, t, cleared[section], null);
  await saveMain(c, t, await readMain(c, t, tenantName), data["sajada-v2"] as MainSection);
  // Regions before numbers and network, which refer to placed members.
  for (const section of ["sajada-regions", ...Object.keys(SECTION_STORES).filter((s) => s !== "sajada-regions")])
    if (data[section] != null) await SECTION_STORES[section].save(c, t, null, data[section]);
  await bump(c, t);
}

export function validateWorkspace(tenantName: string, data: Sections) {
  const present = Object.fromEntries(Object.entries(data).filter(([, v]) => v != null));
  validateBackup({ format: "sajada-backup", version: 1, tenant: tenantName, createdAt: new Date().toISOString(), data: present }, tenantName);
}

/** Turns any failure into a message for the app's toast; unexpected errors are logged. */
export function userMessage(error: unknown): string {
  if (error instanceof UserError) return error.message;
  if (error instanceof ZodError) return "Data tidak valid: " + error.issues.map((i) => i.path.join(".") || i.message).slice(0, 3).join(", ");
  const e = error as { code?: string; message?: string };
  if (typeof e?.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) {
    console.error("Database rejected workspace change:", e.message);
    return "Database menolak perubahan: " + e.message;
  }
  if (error instanceof Error && !(error as { code?: string }).code) return error.message;
  console.error(error);
  return "Perubahan tidak dapat disimpan.";
}
