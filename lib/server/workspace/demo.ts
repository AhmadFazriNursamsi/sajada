import { randomUUID } from "node:crypto";
import { initialProducts } from "../../../shared/demo-data.ts";
import { addLocation, applyStock, emptyWarehouses, totalAvailable } from "../../../shared/warehouses.ts";
import { emptyReplenishment } from "../../../shared/replenishment.ts";
import type { MainSection } from "./main.ts";

/**
 * The demo catalog and opening depot for a tenant, as seedWarehouses() in shared/warehouses.ts
 * builds them, but with database identifiers. Used by the seed script and the demo reset.
 */
export function demoMain(tenantName: string, members: MainSection["members"]): MainSection {
  const at = new Date().toISOString();
  const products = initialProducts.map((p) => ({ ...p, id: randomUUID() }));
  const depot = randomUUID();
  let warehouses = addLocation(emptyWarehouses(), { id: depot, name: "Depot provinsi • " + tenantName, kind: "province", parentId: null, regionId: "Wilayah demo belum dipetakan", memberId: null });
  for (const p of products)
    if (p.stock > 0)
      warehouses = applyStock(warehouses, { id: randomUUID(), kind: "receive", locationId: depot, productId: p.id, quantity: p.stock, reference: "Migrasi saldo demo sebelumnya" }, "Migrasi demo", at);
  return {
    orders: [],
    members,
    paid: [],
    products: products.map((p) => ({ ...p, stock: totalAvailable(warehouses, p.id) })),
    stockMoves: [],
    warehouses,
    replenishment: emptyReplenishment(),
  };
}
