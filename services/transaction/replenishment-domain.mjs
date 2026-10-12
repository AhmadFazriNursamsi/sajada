// Generated from shared/replenishment.ts.
import { validateReplacements } from './po-replacement-domain.mjs';
import { validateInspections } from './po-inspection-domain.mjs';
import { validateConfirmations } from './po-confirmation-domain.mjs';
import { stockAt, applyStock } from './inventory-domain.mjs';
export function checkSupplier(p) { text(p.id, 100); text(p.name); text(p.address, 1000); for (const [v, max] of [[p.contact, 200], [p.phone, 80], [p.email, 254]])
    if (typeof v !== 'string' || v.length > max)
        throw Error('Kontak pemasok tidak valid.'); if (!p.phone.trim() && !p.email.trim())
    throw Error('Telepon atau email pemasok wajib diisi.'); if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email))
    throw Error('Email pemasok tidak valid.'); if (typeof p.active !== 'boolean' || !Number.isFinite(Date.parse(p.changedAt)))
    throw Error('Audit/status pemasok tidak valid.'); text(p.changedBy); }
export function setSupplier(s, p) { checkSupplier(p); if ((s.suppliers || []).some(x => x.id !== p.id && x.name.trim().toLowerCase() === p.name.trim().toLowerCase()))
    throw Error('Nama pemasok sudah terdaftar.'); return { ...s, suppliers: [...(s.suppliers || []).filter(x => x.id !== p.id), { ...p }] }; }
export function emptyReplenishment() { return { version: 1, policies: [], orders: [], receipts: [] }; }
function units(n, positive = false) { if (!Number.isSafeInteger(n) || n < (positive ? 1 : 0) || n > 1e9)
    throw Error('Jumlah harus unit bulat dalam batas 1 miliar.'); }
function text(s, max = 200) { if (typeof s !== 'string' || !s.trim() || s.length > max)
    throw Error('Referensi/nama/aktor wajib diisi sesuai batas panjang.'); }
export function checkPolicy(p, w, products) { if (!w.locations.some(l => l.id === p.locationId) || !products.some(x => x.id === p.productId))
    throw Error('Lokasi/produk kebijakan tidak ditemukan.'); for (const n of [p.safety, p.target])
    units(n); for (const n of [p.minimumOrder, p.multiple])
    units(n, true); if (p.target <= p.safety)
    throw Error('Target stok harus di atas safety stock.'); text(p.supplier); if (!Number.isSafeInteger(p.unitCost) || p.unitCost <= 0 || p.unitCost > 1e12)
    throw Error('Harga beli harus rupiah bulat positif, maksimal 1 triliun.'); if (!Number.isInteger(p.leadDays) || p.leadDays < 0 || p.leadDays > 365)
    throw Error('Lead time 0–365 hari.'); if (typeof p.enabled !== 'boolean')
    throw Error('Status otomatis tidak valid.'); text(p.changedBy); if (!Number.isFinite(Date.parse(p.changedAt)))
    throw Error('Waktu kebijakan tidak valid.'); }
export function setReorderPolicy(s, p, w, products) { checkPolicy(p, w, products); if (p.supplierId && !s.suppliers?.some(x => x.id === p.supplierId && x.active))
    throw Error('Pemasok utama tidak tersedia atau nonaktif.'); return { ...s, policies: [...s.policies.filter(x => x.locationId !== p.locationId || x.productId !== p.productId), { ...p }] }; }
export function automaticPO(s, w, products, actor, at, newId) {
    text(actor);
    if (!Number.isFinite(Date.parse(at)))
        throw Error('Waktu PO tidak valid.');
    let orders = s.orders;
    for (const p of s.policies) {
        checkPolicy(p, w, products);
        const supplier = p.supplierId ? s.suppliers?.find(x => x.id === p.supplierId) : undefined;
        if (p.supplierId && (!supplier || !supplier.active))
            continue;
        if (supplier)
            checkSupplier(supplier);
        if (!p.enabled || products.find(x => x.id === p.productId)?.active === false)
            continue;
        const b = stockAt(w, p.locationId, p.productId), available = b.onHand - b.reserved;
        if (available > p.safety)
            continue;
        const incoming = w.documents.filter(d => d.kind === 'transfer' && d.status === 'transit' && d.toId === p.locationId && d.productId === p.productId).reduce((n, d) => n + d.quantity, 0), onOrder = orders.filter(o => o.locationId === p.locationId && o.productId === p.productId && ['draft', 'approved'].includes(o.status)).reduce((n, o) => n + o.quantity - o.received, 0);
        const gap = p.target - available - incoming - onOrder;
        if (gap <= 0)
            continue;
        const quantity = Math.ceil(Math.max(gap, p.minimumOrder) / p.multiple) * p.multiple;
        units(quantity, true);
        if (b.onHand + incoming + onOrder + quantity > 1e9)
            throw Error('PO melebihi kapasitas fisik maksimum lokasi.');
        if (quantity * p.unitCost > 1e12)
            throw Error('Nilai PO melebihi batas 1 triliun IDR.');
        const id = newId();
        text(id, 100);
        if (orders.some(o => o.id === id))
            throw Error('ID PO sudah digunakan.');
        orders = [...orders, { id, number: 'PO-' + id, locationId: p.locationId, productId: p.productId, productName: products.find(x => x.id === p.productId).name, supplier: supplier?.name || p.supplier, ...(supplier ? { supplierSnapshot: { ...supplier } } : {}), currency: 'IDR', leadDays: p.leadDays, unitCost: p.unitCost, quantity, received: 0, status: 'draft', createdAt: at, createdBy: actor, available, incoming, onOrder, safety: p.safety, target: p.target }];
    }
    return orders === s.orders ? s : { ...s, orders };
}
// Lead time uses calendar days in WIB, starting on approval. No delivery promise or supplier dispatch is implied.
export function poExpectedOn(at, leadDays) { if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 365 || !Number.isFinite(Date.parse(at)))
    throw Error('Lead time/waktu persetujuan PO tidak valid.'); return new Date((Math.floor((Date.parse(at) + 7 * 3600000) / 86400000) + leadDays) * 86400000).toISOString().slice(0, 10); }
export function checkPOTiming(o) { if (o.leadDays === undefined) {
    if (o.expectedOn !== undefined)
        throw Error('Tanggal tiba tanpa snapshot lead time.');
    return;
} poExpectedOn(o.createdAt, o.leadDays); if (['approved', 'closed'].includes(o.status)) {
    if (!o.approvedAt || Date.parse(o.approvedAt) < Date.parse(o.createdAt) || o.expectedOn !== poExpectedOn(o.approvedAt, o.leadDays))
        throw Error('Jadwal PO berbeda dari persetujuan/lead time.');
}
else if (o.expectedOn !== undefined)
    throw Error('Jadwal tiba hanya untuk PO yang disetujui.'); }
export function approvePO(s, id, actor, at) { text(actor); const o = s.orders.find(o => o.id === id); if (!o)
    throw Error('PO tidak ditemukan.'); if (['approved', 'closed'].includes(o.status))
    return s; if (o.status !== 'draft')
    throw Error('PO tidak dapat disetujui.'); if (!Number.isFinite(Date.parse(at)) || Date.parse(at) < Date.parse(o.createdAt))
    throw Error('Waktu persetujuan sebelum pembuatan PO.'); const schedule = o.leadDays === undefined ? {} : { expectedOn: poExpectedOn(at, o.leadDays) }; return { ...s, orders: s.orders.map(x => x.id === id ? { ...x, ...schedule, status: 'approved', approvedAt: at, approvedBy: actor } : x) }; }
export function cancelPO(s, id, reason, actor, at) { text(reason); text(actor); const o = s.orders.find(o => o.id === id); if (!o)
    throw Error('PO tidak ditemukan.'); if (o.status === 'cancelled') {
    if (o.cancelReason !== reason)
        throw Error('Alasan pembatalan berbeda.');
    return s;
} if (o.status !== 'draft' || o.received > 0)
    throw Error('Hanya draf PO belum diterima dapat dibatalkan.'); return { ...s, orders: s.orders.map(x => x.id === id ? { ...x, status: 'cancelled', cancelReason: reason, cancelledBy: actor, cancelledAt: at } : x), policies: s.policies.map(p => p.locationId === o.locationId && p.productId === o.productId ? { ...p, enabled: false, changedAt: at, changedBy: actor } : p) }; }
export function receivePO(s, w, id, receiptId, quantity, actor, at) {
    units(quantity, true);
    text(actor);
    const old = s.receipts.find(r => r.id === receiptId);
    if (old) {
        if (old.orderId !== id || old.quantity !== quantity)
            throw Error('ID penerimaan dipakai untuk data berbeda.');
        return { state: s, warehouses: w };
    }
    const o = s.orders.find(o => o.id === id);
    if (!o || o.status !== 'approved' || quantity > o.quantity - o.received)
        throw Error('PO belum disetujui atau penerimaan melebihi sisa.');
    const next = applyStock(w, { id: receiptId, kind: 'receive', locationId: o.locationId, productId: o.productId, quantity, reference: o.number }, actor, at), received = o.received + quantity;
    return { state: { ...s, orders: s.orders.map(x => x.id === id ? { ...x, received, status: received === x.quantity ? 'closed' : 'approved' } : x), receipts: [...s.receipts, { id: receiptId, orderId: id, quantity, at, actor }] }, warehouses: next };
}
export function validateReplenishment(input, w, products) {
    if (!input || input.version !== 1 || !Array.isArray(input.policies) || !Array.isArray(input.orders) || !Array.isArray(input.receipts) || Object.keys(input).some(k => !['version', 'replacementReversals', 'replacements', 'inspections', 'confirmations', 'suppliers', 'policies', 'orders', 'receipts'].includes(k)))
        throw Error('Data safety stock/PO tidak valid.');
    const s = input;
    if (s.suppliers !== undefined && !Array.isArray(s.suppliers))
        throw Error('Daftar pemasok tidak valid.');
    const supplierIds = new Set(), supplierNames = new Set();
    for (const x of s.suppliers || []) {
        checkSupplier(x);
        const name = x.name.trim().toLowerCase();
        if (supplierIds.has(x.id) || supplierNames.has(name))
            throw Error('Pemasok berulang.');
        supplierIds.add(x.id);
        supplierNames.add(name);
    }
    for (const p of s.policies)
        if (p.supplierId && !supplierIds.has(p.supplierId))
            throw Error('Pemasok aturan tidak ditemukan.');
    const keys = new Set();
    for (const p of s.policies) {
        checkPolicy(p, w, products);
        const key = JSON.stringify([p.locationId, p.productId]);
        if (keys.has(key))
            throw Error('Kebijakan stok berulang.');
        keys.add(key);
    }
    const ids = new Set();
    for (const o of s.orders) {
        checkPOTiming(o);
        text(o.id, 100);
        if (ids.has(o.id))
            throw Error('ID PO berulang.');
        ids.add(o.id);
        if (o.number !== 'PO-' + o.id || o.currency !== 'IDR' || !w.locations.some(l => l.id === o.locationId) || !products.some(p => p.id === o.productId))
            throw Error('Referensi PO tidak valid.');
        text(o.supplier);
        if (o.supplierSnapshot) {
            checkSupplier(o.supplierSnapshot);
            if (o.supplier !== o.supplierSnapshot.name)
                throw Error('Snapshot pemasok PO berbeda.');
        }
        text(o.productName);
        text(o.createdBy);
        units(o.quantity, true);
        units(o.received);
        for (const n of [o.available, o.incoming, o.onOrder, o.safety, o.target])
            if (!Number.isSafeInteger(n) || n < 0)
                throw Error('Snapshot stok PO tidak valid.');
        if (o.received > o.quantity || !Number.isSafeInteger(o.unitCost) || o.unitCost <= 0 || o.quantity * o.unitCost > 1e12 || !Number.isFinite(Date.parse(o.createdAt)) || !['draft', 'approved', 'closed', 'cancelled'].includes(o.status))
            throw Error('Nilai/status PO tidak valid.');
        if (['approved', 'closed'].includes(o.status)) {
            text(o.approvedBy);
            if (!Number.isFinite(Date.parse(o.approvedAt)))
                throw Error('Audit persetujuan tidak lengkap.');
        }
        if (o.target <= o.safety)
            throw Error('Target PO tidak valid.');
        if (!['approved', 'closed'].includes(o.status) && (o.approvedBy || o.approvedAt))
            throw Error('Audit persetujuan tanpa status.');
        if (o.status !== 'cancelled' && (o.cancelledAt || o.cancelledBy || o.cancelReason))
            throw Error('Audit pembatalan tanpa status.');
        if (o.status === 'closed' && o.received !== o.quantity || o.status === 'approved' && o.received === o.quantity || ['draft', 'cancelled'].includes(o.status) && o.received !== 0)
            throw Error('Status penerimaan PO tidak cocok.');
        if (o.status === 'cancelled') {
            text(o.cancelledBy);
            text(o.cancelReason);
            if (!Number.isFinite(Date.parse(o.cancelledAt)))
                throw Error('Audit pembatalan tidak lengkap.');
        }
    }
    const receiptIds = new Set();
    for (const r of s.receipts) {
        if (receiptIds.has(r.id))
            throw Error('Penerimaan PO berulang.');
        receiptIds.add(r.id);
        units(r.quantity, true);
        const o = s.orders.find(o => o.id === r.orderId), doc = w.documents.find(d => d.id === r.id);
        if (!o || !doc || doc.kind !== 'receive' || doc.reference !== o.number || doc.productId !== o.productId || doc.locationId !== o.locationId || doc.quantity !== r.quantity || doc.actor !== r.actor || doc.at !== r.at)
            throw Error('Penerimaan PO berbeda dari kartu stok.');
    }
    for (const o of s.orders)
        if (s.receipts.filter(r => r.orderId === o.id).reduce((n, r) => n + r.quantity, 0) !== o.received)
            throw Error('Saldo penerimaan PO tidak cocok.');
    validateConfirmations(s.confirmations || [], s.orders);
    validateInspections(s.inspections || [], s.orders, s.receipts);
    validateReplacements(s);
    return s;
}
