"use server";

import { assertLocal } from "@/lib/server/local";
import { loadWorkspace, resetWorkspace, restoreWorkspace, saveSection, userMessage, type Workspace } from "@/lib/server/workspace";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function loadWorkspaceAction(tenant: string): Promise<ActionResult<Workspace>> {
  try {
    await assertLocal();
    return { ok: true, data: await loadWorkspace(tenant) };
  } catch (error) {
    return { ok: false, error: userMessage(error) };
  }
}

/** Saves one section if the database is still at expectedRevision; returns the new revision. */
export async function saveSectionAction(tenant: string, section: string, value: unknown, browserSections: Record<string, unknown>, expectedRevision: number): Promise<ActionResult<number>> {
  try {
    await assertLocal();
    return { ok: true, data: await saveSection(tenant, section, value, browserSections, expectedRevision) };
  } catch (error) {
    return { ok: false, error: userMessage(error) };
  }
}

export async function resetWorkspaceAction(tenant: string): Promise<ActionResult<null>> {
  try {
    await assertLocal();
    await resetWorkspace(tenant);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: userMessage(error) };
  }
}

export async function restoreWorkspaceAction(tenant: string, sections: Record<string, unknown>): Promise<ActionResult<null>> {
  try {
    await assertLocal();
    await restoreWorkspace(tenant, sections);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: userMessage(error) };
  }
}
