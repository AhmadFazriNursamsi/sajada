import test from "node:test";
import assert from "node:assert/strict";
import { authorizeSave } from "./authorize.ts";
import { initialProducts, seedWarehouses } from "../../../shared/test-fixtures.ts";
import { emptyReplenishment } from "../../../shared/replenishment.ts";
import { applyStock, totalAvailable } from "../../../shared/warehouses.ts";
import { automaticPO } from "../../../shared/replenishment.ts";
import type { Role } from "../../roles.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const at = "2026-10-14T03:00:00.000Z";
const as = (role: Role, name = "Petugas Uji") => ({ role, name });
const allowed = (role: Role, section: string, before: unknown, next: unknown, name?: string) => assert.doesNotThrow(() => authorizeSave(as(role, name), section, before, next));
const refused = (role: Role, section: string, before: unknown, next: unknown, pattern: RegExp, name?: string) =>
  assert.throws(() => authorizeSave(as(role, name), section, before, next), pattern);

function base() {
  const warehouses = seedWarehouses(initialProducts, "Koperasi Uji");
  return {
    members: [["Andi", "AN", "Bandung", "Bronze", 0], ["Budi", "BU", "Bogor", "Bronze", 0]],
    orders: [{ id: "SO-1", total: 50000, tenant: "Koperasi Uji", items: [], currency: "IDR", seller: "Andi" }],
    paid: [] as string[],
    products: initialProducts.map((p) => ({ ...p, stock: totalAvailable(warehouses, p.id) })),
    stockMoves: [],
    warehouses,
    replenishment: emptyReplenishment(),
  } as any;
}
const clone = <T,>(v: T): T => structuredClone(v);
const depot = (m: any) => m.warehouses.locations[0].id;
const product = (m: any) => m.products.find((p: any) => totalAvailable(m.warehouses, p.id) > 2).id;

/** What the app's checkout saves: the order, its stock reservation, catalog stock and auto POs. */
function checkout(before: any, actor: string) {
  const next = clone(before);
  const pid = product(before);
  next.warehouses = applyStock(before.warehouses, { id: "res-1", kind: "reserve", locationId: depot(before), productId: pid, quantity: 2, reference: "SO-2" }, actor, at);
  next.products = before.products.map((p: any) => ({ ...p, stock: totalAvailable(next.warehouses, p.id) }));
  next.orders = [{ id: "SO-2", total: 100000, tenant: "Koperasi Uji", items: [], currency: "IDR", seller: "Andi", locationId: depot(before) }, ...before.orders];
  let n = 0;
  next.replenishment = automaticPO(before.replenishment, next.warehouses, next.products, actor, at, () => "auto-" + ++n);
  return next;
}

test("admin may change anything; viewer nothing", () => {
  const b = base(), n = clone(b);
  n.members.push(["Cici", "CI", "Bekasi", "Bronze", 0]);
  allowed("admin", "sajada-v2", b, n);
  refused("viewer", "sajada-v2", b, n, /Pemantau hanya dapat melihat/);
  refused("viewer", "sajada-ledger", null, { entries: [] }, /Pemantau/);
});

test("other sections follow SECTION_EDITORS", () => {
  allowed("accountant", "sajada-ledger", null, { x: 1 });
  refused("member_officer", "sajada-ledger", null, { x: 1 }, /Petugas anggota & penjualan tidak boleh mengubah akuntansi/);
  allowed("member_officer", "sajada-network", {}, { Budi: "Andi" });
  refused("accountant", "sajada-network", {}, { Budi: "Andi" }, /jaringan sponsor/);
  refused("depot_officer", "sajada-funding", null, {}, /investor & pendanaan/);
  allowed("accountant", "sajada-capital-fees", null, {});
  refused("member_officer", "sajada-capital-fees", null, {}, /rincian iuran/);
});

test("member officer: checkout with its reservation and catalog stock is allowed", () => {
  const b = base();
  allowed("member_officer", "sajada-v2", b, checkout(b, "Petugas Uji"));
});

test("member officer: reservation recorded under another name is refused", () => {
  const b = base();
  refused("member_officer", "sajada-v2", b, checkout(b, "Orang Lain"), /pelaksana harus akun yang sedang login/);
});

test("member officer: edited stock balance or a depot receipt is refused", () => {
  const b = base();
  const tampered = checkout(b, "Petugas Uji");
  tampered.warehouses.balances[0].onHand += 100;
  tampered.products = tampered.products.map((p: any) => ({ ...p, stock: totalAvailable(tampered.warehouses, p.id) }));
  refused("member_officer", "sajada-v2", b, tampered, /hasil operasi stok tidak sesuai/);

  const receipt = clone(b);
  receipt.warehouses = applyStock(b.warehouses, { id: "rcv-1", kind: "receive", locationId: depot(b), productId: product(b), quantity: 5, reference: "Kiriman" }, "Petugas Uji", at);
  receipt.products = b.products.map((p: any) => ({ ...p, stock: totalAvailable(receipt.warehouses, p.id) }));
  refused("member_officer", "sajada-v2", b, receipt, /hanya reservasi, pelepasan dan pengiriman/);
  allowed("depot_officer", "sajada-v2", b, receipt);
});

test("catalog edits belong to the depot officer", () => {
  const b = base(), n = clone(b);
  n.products[0].price = n.products[0].price + 1000;
  refused("member_officer", "sajada-v2", b, n, /produk & katalog/);
  refused("accountant", "sajada-v2", b, n, /produk & katalog/);
  allowed("depot_officer", "sajada-v2", b, n);
  const stockOnly = clone(b);
  stockOnly.products[0].stock += 3;
  refused("member_officer", "sajada-v2", b, stockOnly, /stok katalog tidak sesuai depot/);
});

test("members belong to the member officer", () => {
  const b = base(), n = clone(b);
  n.members.push(["Cici", "CI", "Bekasi", "Bronze", 0]);
  allowed("member_officer", "sajada-v2", b, n);
  refused("depot_officer", "sajada-v2", b, n, /data anggota/);
  refused("accountant", "sajada-v2", b, n, /data anggota/);
});

test("accountant may only mark existing open orders paid", () => {
  const b = base();
  const pay = clone(b);
  pay.orders[0].paidDate = "14/10/2026";
  pay.paid = ["SO-1"];
  allowed("accountant", "sajada-v2", b, pay);

  const newOrder = clone(pay);
  newOrder.orders.push({ id: "SO-9", total: 1, tenant: "Koperasi Uji", items: [], currency: "IDR" });
  refused("accountant", "sajada-v2", b, newOrder, /pesanan & pembayaran/);

  const changedTotal = clone(pay);
  changedTotal.orders[0].total = 1;
  refused("accountant", "sajada-v2", b, changedTotal, /pesanan & pembayaran/);

  const cancelled = clone(b);
  cancelled.orders[0].cancelledAt = at;
  const payCancelled = clone(cancelled);
  payCancelled.orders[0].paidDate = "14/10/2026";
  payCancelled.paid = ["SO-1"];
  refused("accountant", "sajada-v2", cancelled, payCancelled, /pesanan & pembayaran/);

  refused("depot_officer", "sajada-v2", b, pay, /pesanan & pembayaran/);
});

test("draft POs: automatic ones from a sale are allowed, manual ones only for the depot officer", () => {
  const b = base();
  const pid = product(b);
  b.replenishment.policies = [{ locationId: depot(b), productId: pid, safety: 1000, target: 1200, minimumOrder: 1, multiple: 1, supplier: "Pemasok Uji", unitCost: 1000, leadDays: 3, enabled: true, changedAt: at, changedBy: "Depot" }];
  const sale = checkout(b, "Petugas Uji");
  assert.equal(sale.replenishment.orders.length, 1);
  allowed("member_officer", "sajada-v2", b, sale);

  const inflated = clone(sale);
  inflated.replenishment.orders[0].quantity += 50;
  refused("member_officer", "sajada-v2", b, inflated, /draf PO tidak sesuai perhitungan safety stock/);

  const manual = clone(b);
  manual.replenishment.policies[0].safety = 1;
  refused("member_officer", "sajada-v2", b, manual, /safety stock & PO/);
  allowed("depot_officer", "sajada-v2", b, manual);
});
