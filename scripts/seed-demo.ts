// Seeds the demo koperasi (tenants) with the same starting data the web app shows.
// Usage: pnpm db:seed   (node --env-file=.env.local scripts/seed-demo.ts)
// Tenants that already exist are left untouched.
import { pool, inTenant } from "../lib/server/db.ts";
import { readMain, saveMain } from "../lib/server/workspace/main.ts";
import { validateWorkspace } from "../lib/server/workspace/index.ts";
import { demoMain } from "../lib/server/workspace/demo.ts";
import { TENANTS, tenantPeople } from "../shared/demo-data.ts";

for (const name of TENANTS) {
  const existing = (await pool().query("SELECT id FROM sajada.tenant WHERE name=$1", [name])).rows[0];
  if (existing) {
    console.log(`skip  ${name} (already in database)`);
    continue;
  }
  await pool().query("INSERT INTO sajada.tenant(id,name,base_currency) VALUES(gen_random_uuid(),$1,'IDR')", [name]);
  await inTenant(name, async (c, t) => {
    const before = await readMain(c, t, name);
    const next = demoMain(name, tenantPeople(name).map((m) => [...m] as [string, string, string, string, number]));
    validateWorkspace(name, { "sajada-v2": next });
    await saveMain(c, t, before, next);
  });
  console.log(`seed  ${name}`);
}
await pool().end();
