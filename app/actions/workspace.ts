"use server";

import { requireStaff } from "@/lib/server/auth";
import { UserError } from "@/lib/server/db";
import { loadWorkspace, restoreWorkspace, saveSection, userMessage, type Workspace } from "@/lib/server/workspace";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Every action needs a signed-in staff account with access to the koperasi; saves are checked
// against the account's role on the server (lib/server/workspace/authorize.ts).

export async function loadWorkspaceAction(tenant: string): Promise<ActionResult<Workspace>> {
  try {
    await requireStaff(tenant);
    return { ok: true, data: await loadWorkspace(tenant) };
  } catch (error) {
    return { ok: false, error: userMessage(error) };
  }
}

/** Saves one section if the database is still at expectedRevision; returns the new revision. */
export async function saveSectionAction(tenant: string, section: string, value: unknown, browserSections: Record<string, unknown>, expectedRevision: number): Promise<ActionResult<number>> {
  try {
    const user = await requireStaff(tenant);
    return { ok: true, data: await saveSection(user, tenant, section, value, browserSections, expectedRevision) };
  } catch (error) {
    return { ok: false, error: userMessage(error) };
  }
}

async function requireAdmin(tenant: string) {
  const user = await requireStaff(tenant);
  if (user.role !== "admin") throw new UserError("Hanya admin yang dapat memulihkan data koperasi dari backup.");
}

export async function restoreWorkspaceAction(tenant: string, sections: Record<string, unknown>): Promise<ActionResult<null>> {
  try {
    await requireAdmin(tenant);
    await restoreWorkspace(tenant, sections);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: userMessage(error) };
  }
}
