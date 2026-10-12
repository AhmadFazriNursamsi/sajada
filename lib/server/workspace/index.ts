import { ZodError } from "zod";
import { validateBackup } from "../../../shared/backup.ts";
import { DB_SECTIONS } from "../../../shared/workspace-sections.ts";
import { inTenant, UserError, type Tx } from "../db.ts";
import { readMain, saveMain, type MainSection } from "./main.ts";

type Sections = Record<string, unknown>;

async function readAll(c: Tx, t: string, tenantName: string): Promise<Sections> {
  return { "sajada-v2": await readMain(c, t, tenantName) };
}

/** All database-backed sections of one tenant, keyed like the web app's storage keys. */
export function loadWorkspace(tenantName: string): Promise<Sections> {
  return inTenant(tenantName, (c, t) => readAll(c, t, tenantName));
}

/**
 * Replaces one section. The whole tenant workspace (database sections plus the browser-held
 * sections passed as context) must pass the same integrity rules as a backup restore.
 */
export function saveSection(tenantName: string, section: string, value: unknown, browserSections: Sections): Promise<void> {
  if (!DB_SECTIONS.includes(section)) throw new UserError("Bagian data tidak dikenal.");
  return inTenant(tenantName, async (c, t) => {
    const before = await readAll(c, t, tenantName);
    const context = Object.fromEntries(Object.entries(browserSections).filter(([key, v]) => !DB_SECTIONS.includes(key) && v != null));
    validateWorkspace(tenantName, { ...context, ...before, [section]: value });
    if (section === "sajada-v2") await saveMain(c, t, before[section] as MainSection, value as MainSection);
  });
}

export function validateWorkspace(tenantName: string, data: Sections) {
  validateBackup({ format: "sajada-backup", version: 1, tenant: tenantName, createdAt: new Date().toISOString(), data }, tenantName);
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
