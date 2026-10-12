import pg from "pg";

// One pool per server process, kept across dev hot reloads.
const cache = globalThis as typeof globalThis & { sajadaPool?: pg.Pool };

export function pool(): pg.Pool {
  if (!cache.sajadaPool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    cache.sajadaPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  }
  return cache.sajadaPool;
}

/** An error whose message is meant for the user (shown in the app's toast). */
export class UserError extends Error {}

export type Tx = pg.PoolClient;

/**
 * Runs fn in one transaction scoped to the tenant (koperasi) with that display name.
 * Row-level security applies through app.tenant_id, and the tenant inventory lock
 * serialises writes with the /v1 API (same key as inventoryLock in the API services).
 */
export async function inTenant<T>(tenantName: string, fn: (c: Tx, tenantId: string) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    const tenant = (await c.query("SELECT id FROM sajada.tenant WHERE name=$1", [tenantName])).rows[0];
    if (!tenant) throw new UserError("Koperasi tidak ditemukan di database.");
    await c.query("SELECT set_config('app.tenant_id',$1,true)", [tenant.id]);
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [tenant.id + ":inventory"]);
    const result = await fn(c, tenant.id);
    await c.query("COMMIT");
    return result;
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}
