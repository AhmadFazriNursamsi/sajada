"use server";

import { assertLocal } from "@/lib/server/local";
import { loadWorkspace, saveSection, userMessage } from "@/lib/server/workspace";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function loadWorkspaceAction(tenant: string): Promise<ActionResult<Record<string, unknown>>> {
  try {
    await assertLocal();
    return { ok: true, data: await loadWorkspace(tenant) };
  } catch (error) {
    return { ok: false, error: userMessage(error) };
  }
}

export async function saveSectionAction(tenant: string, section: string, value: unknown, browserSections: Record<string, unknown>): Promise<ActionResult<null>> {
  try {
    await assertLocal();
    await saveSection(tenant, section, value, browserSections);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: userMessage(error) };
  }
}
