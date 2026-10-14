import { UserError } from "../db.ts";
import { ROLE_LABELS, SECTION_EDITORS, type Role } from "../../roles.ts";
import { applyStock, totalAvailable, type StockAction, type WarehouseState } from "../../../shared/warehouses.ts";
import { automaticPO, type Replenishment } from "../../../shared/replenishment.ts";

// Server-side role rules for saving one workspace section (see SECTION_EDITORS in lib/roles.ts).
// The browser computes the new section; this compares it with the stored one and refuses any
// change outside the user's role. Changes a role's own action causes elsewhere (stock
// reservations of a sale, automatic draft POs) are only accepted when replaying that action on
// the stored data gives exactly the submitted result.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Main = { orders: any[]; members: any[]; paid: string[]; products: any[]; stockMoves: any[]; warehouses: WarehouseState; replenishment: Replenishment };
type Actor = { role: Role; name: string };

const AREA_LABELS: Record<string, string> = {
  "sajada-member-capital": "saldo modal & belanja anggota",
  "sajada-member-numbers": "nomor anggota",
  "sajada-network": "jaringan sponsor",
  "sajada-regions": "struktur daerah",
  "sajada-capital-fees": "rincian iuran & biaya penyertaan",
  "sajada-commissions": "status komisi",
  "sajada-ledger": "akuntansi",
  "sajada-funding": "investor & pendanaan",
  "sajada-profit-sharing": "bagi hasil",
  "sajada-tiered-sharing": "bagi hasil bertingkat",
  members: "data anggota",
  orders: "pesanan & pembayaran",
  catalog: "produk & katalog",
  warehouses: "depot & persediaan",
  replenishment: "safety stock & PO",
};

// Key order is not meaningful (jsonb reorders keys), so compare key-sorted serialisations.
const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v;
const same = (a: unknown, b: unknown) => JSON.stringify(sorted(a ?? null)) === JSON.stringify(sorted(b ?? null));

function refuse(actor: Actor, area: string, detail = ""): never {
  throw new UserError(`Peran ${ROLE_LABELS[actor.role]} tidak boleh mengubah ${AREA_LABELS[area] ?? area}${detail ? ": " + detail : ""}.`);
}

export function authorizeSave(actor: Actor, section: string, before: unknown, next: unknown): void {
  if (actor.role === "admin") return;
  if (actor.role === "viewer") throw new UserError("Peran Pemantau hanya dapat melihat data.");
  if (section !== "sajada-v2") {
    if ((SECTION_EDITORS[section] as readonly string[] | undefined)?.includes(actor.role)) return;
    refuse(actor, section);
  }
  const b = before as Main, n = next as Main;
  const changed = (key: keyof Main) => !same(b[key], n[key]);
  const is = (role: Role) => actor.role === role;

  if (changed("members") && !is("member_officer")) refuse(actor, "members");
  if (changed("stockMoves") && !is("depot_officer")) refuse(actor, "catalog");
  if (changed("products") && !is("depot_officer")) {
    // Catalog stock follows the depots (saveWarehouses in the app); anything else is catalog work.
    const noStock = (ps: any[]) => ps.map((p) => ({ ...p, stock: undefined }));
    if (!same(noStock(b.products), noStock(n.products))) refuse(actor, "catalog");
    if (n.products.some((p) => p.stock !== totalAvailable(n.warehouses, p.id))) refuse(actor, "catalog", "stok katalog tidak sesuai depot");
  }
  if ((changed("orders") || changed("paid")) && !is("member_officer")) {
    if (!is("accountant") || !paymentsOnly(b, n)) refuse(actor, "orders");
  }
  if (changed("warehouses") && !is("depot_officer")) {
    const problem = is("member_officer") ? salesStockProblem(b.warehouses, n.warehouses, actor.name) : "bukan bagian tugas peran ini";
    if (problem) refuse(actor, "warehouses", problem);
  }
  if (changed("replenishment") && !is("depot_officer")) {
    const problem = automaticPOProblem(b.replenishment, n, actor.name);
    if (problem) refuse(actor, "replenishment", problem);
  }
}

/** Accountant: recording a payment only adds paidDate to existing, open orders and adds them to paid. */
function paymentsOnly(b: Main, n: Main): boolean {
  if (n.orders.length !== b.orders.length || !b.paid.every((id) => n.paid.includes(id))) return false;
  const old = new Map(b.orders.map((o) => [o.id, o]));
  for (const o of n.orders) {
    const prev = old.get(o.id);
    if (!prev) return false;
    const { paidDate, ...rest } = o, { paidDate: prevDate, ...prevRest } = prev;
    if (!same(rest, prevRest)) return false;
    if (paidDate !== prevDate && (prevDate !== undefined || !n.paid.includes(o.id))) return false;
  }
  return n.paid.filter((id) => !b.paid.includes(id)).every((id) => {
    const o = n.orders.find((x) => x.id === id);
    return o && !o.cancelledAt && o.paidDate !== undefined;
  });
}

const SALES_STOCK = new Set(["reserve", "release", "ship"]);

/** Member officer: only new reserve/release/ship operations, replayed from the stored depots. */
function salesStockProblem(b: WarehouseState, n: WarehouseState, actorName: string): string | null {
  if (!Array.isArray(n?.requests) || n.requests.length < b.requests.length || !same(n.requests.slice(0, b.requests.length), b.requests))
    return "riwayat operasi stok tidak boleh diubah";
  const added = n.requests.slice(b.requests.length);
  if (!added.length) return "hanya reservasi, pelepasan dan pengiriman pesanan yang diizinkan";
  let state = b;
  for (const r of added) {
    const [kind, locationId, toId, productId, quantity, reference, sourceId] = JSON.parse(r.payload);
    if (!SALES_STOCK.has(kind)) return "hanya reservasi, pelepasan dan pengiriman pesanan yang diizinkan";
    const doc = n.documents.find((d) => d.id === r.id);
    if (!doc) return "dokumen operasi stok tidak ditemukan";
    if (doc.actor !== actorName) return "pelaksana harus akun yang sedang login";
    const action: StockAction = { id: r.id, kind, reference, ...(locationId ? { locationId } : {}), ...(toId ? { toId } : {}), ...(productId ? { productId } : {}), ...(quantity != null ? { quantity } : {}), ...(sourceId ? { sourceId } : {}) };
    try {
      state = applyStock(state, action, doc.actor, doc.at);
    } catch (e) {
      return (e as Error).message;
    }
  }
  return same(state, n) ? null : "hasil operasi stok tidak sesuai";
}

/** Roles other than depot: only the draft POs automaticPO() adds after their change, by them. */
function automaticPOProblem(b: Replenishment, n: Main, actorName: string): string | null {
  const next = n.replenishment;
  if (!next || !Array.isArray(next.orders) || next.orders.length <= b.orders.length) return "hanya draf PO otomatis yang diizinkan";
  if (!same({ ...next, orders: next.orders.slice(0, b.orders.length) }, b)) return "hanya draf PO otomatis yang diizinkan";
  const added = next.orders.slice(b.orders.length);
  const first = added[0];
  if (added.some((o) => o.createdBy !== actorName || o.createdAt !== first.createdAt)) return "pembuat draf PO harus akun yang sedang login";
  const ids = added.map((o) => o.id);
  let expected: Replenishment;
  try {
    expected = automaticPO(b, n.warehouses, n.products, first.createdBy, first.createdAt, () => ids.shift() ?? "");
  } catch (e) {
    return (e as Error).message;
  }
  return same(expected, next) ? null : "draf PO tidak sesuai perhitungan safety stock";
}
