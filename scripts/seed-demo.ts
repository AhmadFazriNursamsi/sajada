// Seeds the demo koperasi (tenants) with the same starting data the web app shows.
// Usage: node --env-file=.env.local scripts/seed-demo.ts
// Tenants that already exist are left untouched.
import { randomUUID } from "node:crypto";
import { pool, inTenant } from "../lib/server/db.ts";
import { readMain, saveMain } from "../lib/server/workspace/main.ts";
import { validateWorkspace } from "../lib/server/workspace/index.ts";
import { TENANTS, tenantPeople, initialProducts } from "../shared/demo-data.ts";
import { addLocation, applyStock, emptyWarehouses, totalAvailable } from "../shared/warehouses.ts";
import { emptyReplenishment } from "../shared/replenishment.ts";

for (const name of TENANTS) {
  const existing = (await pool().query("SELECT id FROM sajada.tenant WHERE name=$1", [name])).rows[0];
  if (existing) {
    console.log(`skip  ${name} (already in database)`);
    continue;
  }
  await pool().query("INSERT INTO sajada.tenant(id,name,base_currency) VALUES(gen_random_uuid(),$1,'IDR')", [name]);
  await inTenant(name, async (c, t) => {
    const before = await readMain(c, t, name);
    const at = new Date().toISOString();
    const products = initialProducts.map((p) => ({ ...p, id: randomUUID() }));
    // Same as seedWarehouses() in shared/warehouses.ts, with database identifiers.
    const depot = randomUUID();
    let warehouses = addLocation(emptyWarehouses(), { id: depot, name: "Depot provinsi • " + name, kind: "province", parentId: null, regionId: "Wilayah demo belum dipetakan", memberId: null });
    for (const p of products)
      if (p.stock > 0)
        warehouses = applyStock(warehouses, { id: randomUUID(), kind: "receive", locationId: depot, productId: p.id, quantity: p.stock, reference: "Migrasi saldo demo sebelumnya" }, "Migrasi demo", at);
    const next = {
      orders: [],
      members: tenantPeople(name).map((m) => [...m] as [string, string, string, string, number]),
      paid: [],
      products: products.map((p) => ({ ...p, stock: totalAvailable(warehouses, p.id) })),
      stockMoves: [],
      warehouses,
      replenishment: emptyReplenishment(),
    };
    validateWorkspace(name, { "sajada-v2": next });
    await saveMain(c, t, before, next);
  });
  console.log(`seed  ${name}`);
}
await pool().end();
