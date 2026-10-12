import { loadWorkspaceAction, saveSectionAction } from "@/app/actions/workspace";
import { SECTIONS } from "@/shared/backup";
import { DB_SECTIONS } from "@/shared/workspace-sections";

// A localStorage-shaped store for the web app. Keys look like "<section>:<tenant>".
// Sections listed in DB_SECTIONS are loaded from and saved to PostgreSQL; the others stay in
// the browser's localStorage until they are moved to the database.

type Listener = (event: { type: "error"; message: string } | { type: "reloaded"; tenant: string }) => void;

let loaded: { tenant: string; data: Record<string, unknown> } | null = null;
let queue: Promise<void> = Promise.resolve();
const listeners = new Set<Listener>();

function split(key: string): [string, string] {
  const at = key.indexOf(":");
  return at < 0 ? [key, ""] : [key.slice(0, at), key.slice(at + 1)];
}
const inDb = (section: string) => DB_SECTIONS.includes(section);
const emit: Listener = (event) => listeners.forEach((l) => l(event));

function browserSections(tenant: string) {
  const out: Record<string, unknown> = {};
  for (const section of SECTIONS) {
    if (inDb(section)) continue;
    try {
      const raw = localStorage.getItem(section + ":" + tenant);
      if (raw) out[section] = JSON.parse(raw);
    } catch {
      // Unreadable browser data is left out of the validation context.
    }
  }
  return out;
}

export const workspaceStore = {
  /** Loads the tenant's database sections; resolves once getItem can serve them. */
  async load(tenant: string): Promise<void> {
    const result = await loadWorkspaceAction(tenant);
    if (!result.ok) throw new Error(result.error);
    loaded = { tenant, data: result.data };
  },

  isLoaded(tenant: string) {
    return loaded?.tenant === tenant;
  },

  getItem(key: string): string | null {
    const [section, tenant] = split(key);
    if (!inDb(section)) return localStorage.getItem(key);
    if (loaded?.tenant !== tenant || loaded.data[section] == null) return null;
    return JSON.stringify(loaded.data[section]);
  },

  setItem(key: string, value: string): void {
    const [section, tenant] = split(key);
    if (!inDb(section)) return localStorage.setItem(key, value);
    if (loaded?.tenant !== tenant) throw new Error("Data koperasi belum dimuat dari database.");
    const parsed = JSON.parse(value);
    loaded.data[section] = parsed;
    const context = browserSections(tenant);
    queue = queue.then(async () => {
      const result = await saveSectionAction(tenant, section, parsed, context).catch((e: Error) => ({ ok: false as const, error: e.message }));
      if (result.ok) return;
      emit({ type: "error", message: result.error });
      // Put the browser back in line with the database.
      try {
        await workspaceStore.load(tenant);
        emit({ type: "reloaded", tenant });
      } catch (e) {
        emit({ type: "error", message: (e as Error).message });
      }
    });
  },

  removeItem(key: string): void {
    const [section] = split(key);
    if (!inDb(section)) return localStorage.removeItem(key);
    throw new Error("Penghapusan data database belum didukung.");
  },

  /** Resolves when every queued save has finished. */
  flush(): Promise<void> {
    return queue;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
