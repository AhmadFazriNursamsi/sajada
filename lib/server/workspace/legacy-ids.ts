import { randomUUID } from "node:crypto";

// Backups made while the web app kept its data in localStorage use demo identifiers such as
// "SKU-1", "depot-awal" and "opening-SKU-1" for products, stock locations and stock documents.
// The database keys those by UUID, so a restore gives each such identifier a new UUID and
// rewrites every reference to it (including the stock request payloads and movement ids, which
// embed document and location ids).

/* eslint-disable @typescript-eslint/no-explicit-any */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function withDatabaseIds(main: any): any {
  if (!main) return main;
  const map = new Map<string, string>();
  const claim = (id: unknown) => {
    if (typeof id === "string" && !UUID.test(id) && !map.has(id)) map.set(id, randomUUID());
  };
  for (const p of main.products ?? []) claim(p.id);
  const w = main.warehouses;
  for (const l of w?.locations ?? []) claim(l.id);
  for (const d of w?.documents ?? []) claim(d.id);
  if (!map.size) return main;

  const swap = (v: unknown) => (typeof v === "string" && map.has(v) ? map.get(v)! : v);
  const swapMovementId = (id: string) => {
    const at = id.lastIndexOf(":");
    return at < 0 ? id : swap(id.slice(0, at)) + id.slice(at);
  };
  const remap = (o: any, keys: string[]) => {
    if (!o) return o;
    const out = { ...o };
    for (const k of keys) if (k in out) out[k] = swap(out[k]);
    return out;
  };
  const next = structuredClone(main);
  next.products = (main.products ?? []).map((p: any) => remap(p, ["id"]));
  next.stockMoves = (main.stockMoves ?? []).map((m: any) => remap(m, ["productId"]));
  next.orders = (main.orders ?? []).map((o: any) => ({ ...remap(o, ["locationId"]), items: o.items.map((i: any) => remap(i, ["product_id"])) }));
  if (w) {
    next.warehouses = {
      ...w,
      locations: w.locations.map((l: any) => remap(l, ["id", "parentId"])),
      balances: w.balances.map((b: any) => remap(b, ["locationId", "productId"])),
      documents: w.documents.map((d: any) => remap(d, ["id", "locationId", "toId", "productId", "sourceId"])),
      movements: w.movements.map((m: any) => ({ ...remap(m, ["documentId", "locationId", "productId"]), id: swapMovementId(m.id) })),
      requests: w.requests.map((r: any) => ({ id: swap(r.id), payload: JSON.stringify((JSON.parse(r.payload) as unknown[]).map(swap)) })),
    };
  }
  const rep = main.replenishment;
  if (rep) {
    next.replenishment = { ...rep };
    for (const key of ["policies", "orders"]) if (rep[key]) next.replenishment[key] = rep[key].map((x: any) => remap(x, ["locationId", "productId"]));
  }
  return next;
}
