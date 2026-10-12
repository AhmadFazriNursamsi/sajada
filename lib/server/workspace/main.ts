import { UserError, type Tx } from "../db.ts";

// The "sajada-v2" workspace section: members, catalog, sales orders, payments, catalog stock
// moves, location inventory and replenishment, stored on the domain tables.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
export type MainSection = {
  orders: Row[];
  members: [string, string, string, string, number][];
  paid: string[];
  products: Row[];
  stockMoves: Row[];
  warehouses: Row;
  replenishment: Row;
};

const iso = (v: unknown) => (v == null ? undefined : new Date(v as string).toISOString());
// Key order is not meaningful (jsonb reorders keys), so compare a key-sorted serialisation.
const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Row)[k])])) : v;
export const same = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
// validateWarehouses compares serialised documents, so give them back the key order
// applyStock() (shared/warehouses.ts) builds them with.
const DOCUMENT_KEYS = ["id", "kind", "locationId", "productId", "quantity", "reference", "sourceId", "status", "returned", "actor", "at", "toId"];
const inOrder = (o: Row, keys: string[]) => ({ ...Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]])), ...o });
const num = (v: unknown) => Number(v);
// Drop undefined keys so objects compare equal to what the web app produced.
export const clean = <T extends Row>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export async function memberIds(c: Tx, t: string) {
  const rows = (await c.query("SELECT id,name FROM sajada.member WHERE tenant_id=$1", [t])).rows;
  return { byName: new Map<string, string>(rows.map((r) => [r.name, r.id])), byId: new Map<string, string>(rows.map((r) => [r.id, r.name])) };
}

// ---------- read ----------

export async function readMain(c: Tx, t: string, tenantName: string): Promise<MainSection> {
  const ids = await memberIds(c, t);
  const members = (await c.query("SELECT name,initials,area,level,reported_sales FROM sajada.member WHERE tenant_id=$1 ORDER BY seq", [t])).rows
    .map((r) => [r.name, r.initials, r.area, r.level, num(r.reported_sales)] as [string, string, string, string, number]);
  const products = (await c.query("SELECT id,sku,name,category,unit_price,emoji,bg,stock,active FROM sajada.product WHERE tenant_id=$1 ORDER BY seq", [t])).rows
    .map((r) => ({ name: r.name, category: r.category, price: num(r.unit_price), emoji: r.emoji, bg: r.bg, stock: num(r.stock), id: r.id, sku: r.sku, active: r.active }));

  const items = new Map<string, Row[]>();
  for (const r of (await c.query("SELECT order_id,product_id,name,quantity,unit_price FROM sajada.order_item WHERE tenant_id=$1 ORDER BY order_id,line_no", [t])).rows) {
    const list = items.get(r.order_id) ?? [];
    list.push({ product_id: r.product_id, name: r.name, price: num(r.unit_price), quantity: num(r.quantity) });
    items.set(r.order_id, list);
  }
  const orders = (await c.query("SELECT * FROM sajada.sales_order WHERE tenant_id=$1 AND reference IS NOT NULL ORDER BY seq DESC", [t])).rows.map((r) =>
    clean({
      id: r.reference, total: num(r.total), tenant: tenantName, date: r.order_date ?? undefined, items: items.get(r.id) ?? [], currency: "IDR",
      locationId: r.inventory_location_id ?? undefined, receiptPolicy: r.web.receiptPolicy,
      seller: ids.byId.get(r.member_id), upline: r.web.upline, policy: r.web.policy,
      paidDate: r.paid_date ?? undefined,
      cancelledAt: iso(r.cancelled_at), cancelledBy: r.cancelled_by ?? undefined, cancelReason: r.cancel_reason ?? undefined,
      dispatchedAt: iso(r.dispatched_at), dispatchedBy: r.dispatched_by ?? undefined, dispatchReference: r.dispatch_reference ?? undefined,
      receivedAt: iso(r.received_at), receivedBy: r.received_by ?? undefined, receiptReference: r.receipt_reference ?? undefined, receiverName: r.receiver_name ?? undefined,
      walletPayment: r.web.walletPayment, walletRefund: r.web.walletRefund,
    }),
  );
  const paid = (await c.query("SELECT o.reference FROM sajada.web_order_payment p JOIN sajada.sales_order o ON o.tenant_id=p.tenant_id AND o.id=p.order_id WHERE p.tenant_id=$1 ORDER BY p.seq", [t])).rows.map((r) => r.reference);
  const stockMoves = (await c.query("SELECT id,product_id,product_name,delta,after,reference,date FROM sajada.product_stock_move WHERE tenant_id=$1 ORDER BY seq", [t])).rows
    .map((r) => ({ id: r.id, productId: r.product_id, productName: r.product_name, delta: num(r.delta), after: num(r.after), reference: r.reference, date: r.date }));
  return { orders, members, paid, products, stockMoves, warehouses: await readWarehouses(c, t, ids.byId), replenishment: await readReplenishment(c, t) };
}

async function readWarehouses(c: Tx, t: string, memberName: Map<string, string>) {
  const locations = (await c.query("SELECT id,name,kind,parent_id,coalesce(region_label,region_id) AS region,member_id FROM sajada.inventory_location WHERE tenant_id=$1 ORDER BY seq", [t])).rows
    .map((r) => ({ id: r.id, name: r.name, kind: r.kind, parentId: r.parent_id, regionId: r.region, memberId: r.member_id ? memberName.get(r.member_id) ?? r.member_id : null }));
  const balances = (await c.query("SELECT location_id,product_id,on_hand,reserved,minimum FROM sajada.inventory_balance WHERE tenant_id=$1 ORDER BY seq", [t])).rows
    .map((r) => ({ locationId: r.location_id, productId: r.product_id, onHand: num(r.on_hand), reserved: num(r.reserved), minimum: num(r.minimum) }));
  const docs = (await c.query("SELECT data,request_payload FROM sajada.inventory_document WHERE tenant_id=$1 ORDER BY seq", [t])).rows;
  const movements = (await c.query("SELECT id,document_id,location_id,product_id,physical_delta,reserved_delta,after_physical,after_reserved,actor,occurred_at FROM sajada.inventory_movement WHERE tenant_id=$1 ORDER BY seq", [t])).rows
    .map((r) => ({ id: r.id, documentId: r.document_id, locationId: r.location_id, productId: r.product_id, physical: num(r.physical_delta), reserved: num(r.reserved_delta), after: num(r.after_physical), reservedAfter: num(r.after_reserved), actor: r.actor, at: iso(r.occurred_at) }));
  return { version: 1, locations, balances, documents: docs.map((d) => inOrder(d.data, DOCUMENT_KEYS)), movements, requests: docs.map((d) => ({ id: d.data.id, payload: d.request_payload })) };
}

// Suppliers first: a PO insert checks its supplier snapshot against the stored supplier.
const PURCHASE_LISTS = [
  ["suppliers", "purchase_supplier"], ["policies", "reorder_policy"], ["orders", "purchase_order"], ["receipts", "purchase_receipt"],
  ["confirmations", "purchase_confirmation"], ["inspections", "purchase_inspection"], ["replacements", "purchase_replacement"],
  ["replacementReversals", "purchase_replacement_reversal"],
] as const;
const REQUIRED_LISTS = new Set(["policies", "orders", "receipts"]);

async function readReplenishment(c: Tx, t: string) {
  const state: Row = { version: 1 };
  for (const [key, table] of PURCHASE_LISTS) {
    const rows = (await c.query(`SELECT data FROM sajada.${table} WHERE tenant_id=$1 ORDER BY seq`, [t])).rows.map((r) => r.data);
    if (rows.length || REQUIRED_LISTS.has(key)) state[key] = rows;
  }
  return state;
}

// ---------- write ----------

function noRemoval<T>(before: T[], after: T[], key: (x: T) => string, label: string) {
  const kept = new Set(after.map(key));
  if (before.some((x) => !kept.has(key(x)))) throw new UserError(`${label} yang sudah tersimpan tidak dapat dihapus.`);
}
function immutable<T>(before: T[], after: T[], key: (x: T) => string, label: string) {
  const old = new Map(before.map((x) => [key(x), x]));
  for (const x of after) if (old.has(key(x)) && !same(old.get(key(x)), x)) throw new UserError(`${label} yang sudah tersimpan tidak dapat diubah.`);
}

export async function saveMain(c: Tx, t: string, before: MainSection, next: MainSection) {
  // Members (identified by name).
  noRemoval(before.members, next.members, (m) => m[0], "Anggota");
  const oldMembers = new Map(before.members.map((m) => [m[0], m]));
  for (const m of next.members) {
    const old = oldMembers.get(m[0]);
    if (!old) await c.query("INSERT INTO sajada.member(tenant_id,id,name,status,initials,area,level,reported_sales) VALUES($1,gen_random_uuid(),$2,'active',$3,$4,$5,$6)", [t, ...m]);
    else if (!same(old, m)) await c.query("UPDATE sajada.member SET initials=$3,area=$4,level=$5,reported_sales=$6 WHERE tenant_id=$1 AND name=$2", [t, ...m]);
  }
  const ids = await memberIds(c, t);
  const memberId = (name: unknown) => {
    const id = ids.byName.get(String(name));
    if (!id) throw new UserError("Anggota tidak ditemukan.");
    return id;
  };

  // Catalog.
  noRemoval(before.products, next.products, (p) => p.id, "Produk");
  const oldProducts = new Map(before.products.map((p) => [p.id, p]));
  for (const p of next.products) {
    const old = oldProducts.get(p.id);
    const values = [t, p.id, p.sku, p.name, p.price, p.stock, p.category, p.emoji, p.bg, p.active];
    if (!old) await c.query("INSERT INTO sajada.product(tenant_id,id,sku,name,currency,unit_price,stock,category,emoji,bg,active) VALUES($1,$2,$3,$4,'IDR',$5,$6,$7,$8,$9,$10)", values);
    else if (!same(old, p)) await c.query("UPDATE sajada.product SET sku=$3,name=$4,unit_price=$5,stock=$6,category=$7,emoji=$8,bg=$9,active=$10 WHERE tenant_id=$1 AND id=$2", values);
  }

  await saveWarehouses(c, t, before.warehouses, next.warehouses, memberId);
  await saveOrders(c, t, before, next, memberId);

  noRemoval(before.stockMoves, next.stockMoves, (m) => m.id, "Riwayat stok");
  immutable(before.stockMoves, next.stockMoves, (m) => m.id, "Riwayat stok");
  const oldMoves = new Set(before.stockMoves.map((m) => m.id));
  for (const m of next.stockMoves) if (!oldMoves.has(m.id))
    await c.query("INSERT INTO sajada.product_stock_move(tenant_id,id,product_id,product_name,delta,after,reference,date) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [t, m.id, m.productId, m.productName, m.delta, m.after, m.reference, m.date]);

  await saveReplenishment(c, t, before.replenishment, next.replenishment);
}

async function saveWarehouses(c: Tx, t: string, before: Row, next: Row, memberId: (name: unknown) => string) {
  noRemoval(before.locations, next.locations, (l: Row) => l.id, "Lokasi stok");
  immutable(before.locations, next.locations, (l: Row) => l.id, "Lokasi stok");
  const oldLocations = new Set(before.locations.map((l: Row) => l.id));
  const regions = new Set((await c.query("SELECT id FROM sajada.region")).rows.map((r) => r.id));
  for (const l of next.locations) if (!oldLocations.has(l.id)) {
    const official = regions.has(l.regionId);
    await c.query("INSERT INTO sajada.inventory_location(tenant_id,id,name,kind,parent_id,region_id,region_label,member_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'web')",
      [t, l.id, l.name, l.kind, l.parentId, official ? l.regionId : null, official ? null : l.regionId, l.memberId ? memberId(l.memberId) : null]);
  }

  const balanceKey = (b: Row) => b.locationId + "|" + b.productId;
  noRemoval(before.balances, next.balances, balanceKey, "Saldo stok");
  const oldBalances = new Map(before.balances.map((b: Row) => [balanceKey(b), b]));
  for (const b of next.balances) {
    const old = oldBalances.get(balanceKey(b));
    if (!old) await c.query("INSERT INTO sajada.inventory_balance(tenant_id,location_id,product_id,on_hand,reserved,minimum) VALUES($1,$2,$3,$4,$5,$6)", [t, b.locationId, b.productId, b.onHand, b.reserved, b.minimum]);
    else if (!same(old, b)) await c.query("UPDATE sajada.inventory_balance SET on_hand=$4,reserved=$5,minimum=$6 WHERE tenant_id=$1 AND location_id=$2 AND product_id=$3", [t, b.locationId, b.productId, b.onHand, b.reserved, b.minimum]);
  }

  noRemoval(before.documents, next.documents, (d: Row) => d.id, "Dokumen stok");
  const oldDocs = new Map(before.documents.map((d: Row) => [d.id, d]));
  const payload = new Map(next.requests.map((r: Row) => [r.id, r.payload]));
  for (const d of next.documents) {
    const old = oldDocs.get(d.id);
    if (!old) await c.query("INSERT INTO sajada.inventory_document(tenant_id,id,location_id,product_id,data,request_payload) VALUES($1,$2,$3,$4,$5,$6)", [t, d.id, d.locationId, d.productId, JSON.stringify(d), payload.get(d.id)]);
    else if (!same(old, d)) await c.query("UPDATE sajada.inventory_document SET data=$3 WHERE tenant_id=$1 AND id=$2", [t, d.id, JSON.stringify(d)]);
  }
  if (next.requests.length !== next.documents.length || next.requests.some((r: Row, i: number) => r.id !== next.documents[i].id))
    throw new UserError("Riwayat operasi stok tidak sesuai dokumen.");

  if (next.movements.length < before.movements.length || before.movements.some((m: Row, i: number) => !same(m, next.movements[i])))
    throw new UserError("Kartu stok yang sudah tersimpan tidak dapat diubah.");
  for (const m of next.movements.slice(before.movements.length))
    await c.query("INSERT INTO sajada.inventory_movement(tenant_id,id,document_id,location_id,product_id,physical_delta,reserved_delta,after_physical,after_reserved,actor,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [t, m.id, m.documentId, m.locationId, m.productId, m.physical, m.reserved, m.after, m.reservedAfter, m.actor, m.at]);
}

async function saveOrders(c: Tx, t: string, before: MainSection, next: MainSection, memberId: (name: unknown) => string) {
  noRemoval(before.orders, next.orders, (o) => o.id, "Pesanan");
  const oldOrders = new Map(before.orders.map((o) => [o.id, o]));
  const dbId = new Map<string, string>(
    (await c.query("SELECT id,reference FROM sajada.sales_order WHERE tenant_id=$1 AND reference IS NOT NULL", [t])).rows.map((r) => [r.reference, r.id]),
  );
  // Orders are listed newest first; insert oldest first so seq keeps that order.
  for (const o of [...next.orders].reverse()) {
    const old = oldOrders.get(o.id);
    if (old && same(old, o)) continue;
    if (!o.seller) throw new UserError("Pesanan wajib mempunyai penjual.");
    const web = clean({ receiptPolicy: o.receiptPolicy, upline: o.upline, policy: o.policy, walletPayment: o.walletPayment, walletRefund: o.walletRefund });
    const status = o.cancelledAt ? "cancelled" : next.paid.includes(o.id) ? "paid" : "pending";
    const audit = [o.cancelledAt ?? null, o.cancelledBy ?? null, o.cancelReason ?? null, o.dispatchedAt ?? null, o.dispatchedBy ?? null, o.dispatchReference ?? null,
      o.receivedAt ?? null, o.receivedBy ?? null, o.receiptReference ?? null, o.receiverName ?? null];
    if (!old) {
      const id = (await c.query(
        `INSERT INTO sajada.sales_order(tenant_id,id,member_id,currency,base_currency,fx_rate,total,total_base,status,idempotency_key,inventory_location_id,reference,order_date,paid_date,web,
          cancelled_at,cancelled_by,cancel_reason,dispatched_at,dispatched_by,dispatch_reference,received_at,received_by,receipt_reference,receiver_name)
         VALUES($1,gen_random_uuid(),$2,'IDR','IDR',1,$3,$3,$4,'web:'||$5,$6,$5,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
        [t, memberId(o.seller), o.total, status, o.id, o.locationId ?? null, o.date ?? null, o.paidDate ?? null, JSON.stringify(web), ...audit],
      )).rows[0].id;
      dbId.set(o.id, id);
      for (const [i, item] of o.items.entries())
        await c.query("INSERT INTO sajada.order_item(tenant_id,order_id,line_no,product_id,quantity,unit_price,name) VALUES($1,$2,$3,$4,$5,$6,$7)", [t, id, i + 1, item.product_id, item.quantity ?? 1, item.price, item.name]);
    } else {
      if (!same(old.items, o.items) || old.total !== o.total || old.seller !== o.seller || old.locationId !== o.locationId)
        throw new UserError("Isi pesanan yang sudah tersimpan tidak dapat diubah.");
      await c.query(
        `UPDATE sajada.sales_order SET status=$3,paid_date=$4,web=$5,cancelled_at=$6,cancelled_by=$7,cancel_reason=$8,dispatched_at=$9,dispatched_by=$10,dispatch_reference=$11,
          received_at=$12,received_by=$13,receipt_reference=$14,receiver_name=$15 WHERE tenant_id=$1 AND id=$2`,
        [t, dbId.get(o.id), status, o.paidDate ?? null, JSON.stringify(web), ...audit],
      );
    }
  }
  noRemoval(before.paid, next.paid, (id) => id, "Status lunas");
  const wasPaid = new Set(before.paid);
  for (const ref of next.paid) if (!wasPaid.has(ref)) {
    const id = dbId.get(ref);
    if (!id) throw new UserError("Pembayaran tanpa pesanan.");
    await c.query("INSERT INTO sajada.web_order_payment(tenant_id,order_id) VALUES($1,$2)", [t, id]);
    const o = next.orders.find((x) => x.id === ref);
    if (o && !o.cancelledAt && before.orders.some((x) => x.id === ref)) await c.query("UPDATE sajada.sales_order SET status='paid' WHERE tenant_id=$1 AND id=$2 AND status='pending'", [t, id]);
  }
}

async function saveReplenishment(c: Tx, t: string, before: Row, next: Row) {
  for (const [key] of PURCHASE_LISTS) {
    const oldList: Row[] = before[key] ?? [], list: Row[] = next[key] ?? [];
    const keyOf = (x: Row) => (key === "policies" ? x.locationId + "|" + x.productId : x.id);
    noRemoval(oldList, list, keyOf, "Data pengadaan");
    const old = new Map(oldList.map((x) => [keyOf(x), x]));
    for (const x of list) {
      const prev = old.get(keyOf(x));
      if (prev && same(prev, x)) continue;
      const data = JSON.stringify(x);
      if (key === "policies") {
        await c.query("INSERT INTO sajada.reorder_policy(tenant_id,location_id,product_id,data) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,location_id,product_id) DO UPDATE SET data=excluded.data", [t, x.locationId, x.productId, data]);
      } else if (key === "orders") {
        if (prev) await c.query("UPDATE sajada.purchase_order SET data=$3 WHERE tenant_id=$1 AND id=$2", [t, x.id, data]);
        else await c.query("INSERT INTO sajada.purchase_order(tenant_id,id,location_id,product_id,data) VALUES($1,$2,$3,$4,$5)", [t, x.id, x.locationId, x.productId, data]);
      } else if (key === "suppliers") {
        await c.query("INSERT INTO sajada.purchase_supplier(tenant_id,id,data) VALUES($1,$2,$3) ON CONFLICT(tenant_id,id) DO UPDATE SET data=excluded.data", [t, x.id, data]);
      } else if (prev) {
        throw new UserError("Riwayat pengadaan yang sudah tersimpan tidak dapat diubah.");
      } else if (key === "receipts") {
        await c.query("INSERT INTO sajada.purchase_receipt(tenant_id,id,order_id,data) VALUES($1,$2,$3,$4)", [t, x.id, x.orderId, data]);
      } else if (key === "confirmations") {
        await c.query("INSERT INTO sajada.purchase_confirmation(tenant_id,id,order_id,revision,data) VALUES($1,$2,$3,$4,$5)", [t, x.id, x.orderId, x.revision, data]);
      } else if (key === "inspections") {
        await c.query("INSERT INTO sajada.purchase_inspection(tenant_id,id,order_id,receipt_id,data) VALUES($1,$2,$3,$4,$5)", [t, x.id, x.orderId, x.receiptId ?? null, data]);
      } else if (key === "replacements") {
        await c.query("INSERT INTO sajada.purchase_replacement(tenant_id,id,inspection_id,receipt_id,quantity,data) VALUES($1,$2,$3,$4,$5,$6)", [t, x.id, x.inspectionId, x.receiptId, x.quantity, data]);
      } else {
        await c.query("INSERT INTO sajada.purchase_replacement_reversal(tenant_id,id,replacement_id,data) VALUES($1,$2,$3,$4)", [t, x.id, x.replacementId, data]);
      }
    }
  }
}
