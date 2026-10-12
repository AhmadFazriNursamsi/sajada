// Generated from shared/purchase-ap.ts.
import { jakartaDay } from './inventory-reports-domain.mjs';
const date = (v) => { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v)
    throw Error('Tanggal invoice/jatuh tempo tidak valid.'); return v; };
const text = (v, max = 200) => { if (typeof v !== 'string' || !v.trim() || v.length > max)
    throw Error('Referensi atau aktor wajib diisi.'); return v.trim(); };
export function receivedPurchases(s, bills) { return s.receipts.map(r => { const po = s.orders.find(o => o.id === r.orderId); if (!po || !['approved', 'closed'].includes(po.status))
    throw Error('Penerimaan tidak mempunyai PO yang disetujui.'); return { receipt: r, po, value: r.quantity * po.unitCost, bill: bills.find(b => b.receiptId === r.id) }; }); }
export function invoiceFromReceipt(s, bills, input) {
    const reference = text(input.reference, 60), actor = text(input.actor), id = text(input.id, 100);
    date(input.date);
    date(input.due);
    const today = jakartaDay(input.at);
    if (input.date > today || input.due < input.date)
        throw Error('Tanggal invoice tidak boleh di masa depan; jatuh tempo minimal tanggal invoice.');
    const row = receivedPurchases(s, bills).find(r => r.receipt.id === input.receiptId);
    if (!row)
        throw Error('Penerimaan PO tidak ditemukan.');
    if (Date.parse(input.at) < Date.parse(row.receipt.at) || input.date < jakartaDay(row.receipt.at))
        throw Error('Tanggal pencatatan minimal tanggal penerimaan barang.');
    const existing = bills.find(b => b.id === id);
    if (existing) {
        if (existing.receiptId !== input.receiptId || existing.reference !== reference || existing.date !== input.date || existing.due !== input.due)
            throw Error('ID tagihan digunakan untuk data berbeda.');
        return existing;
    }
    if (row.bill)
        throw Error('Penerimaan ini sudah ditagihkan.');
    if (bills.some(b => b.supplier.trim().toLowerCase() === row.po.supplier.trim().toLowerCase() && b.reference.trim().toLowerCase() === reference.toLowerCase()))
        throw Error('Nomor invoice pemasok sudah digunakan.');
    if (!Number.isSafeInteger(row.value) || row.value <= 0 || row.value > 1e12)
        throw Error('Nilai tagihan di luar batas.');
    return { id, supplier: row.po.supplier, reference, date: input.date, due: input.due, currency: 'IDR', amount: row.value, rate: 1, base: row.value, account: '1300', receiptId: row.receipt.id, poId: row.po.id, quantity: row.receipt.quantity, unitCost: row.po.unitCost, createdAt: input.at, createdBy: actor };
}
export function validatePurchaseBills(s, bills) { const used = new Set(); for (const b of bills) {
    if (!b.receiptId) {
        if (b.poId || b.quantity !== undefined || b.unitCost !== undefined)
            throw Error('Snapshot invoice tanpa penerimaan.');
        continue;
    }
    if (used.has(b.receiptId))
        throw Error('Penerimaan ditagihkan berulang.');
    used.add(b.receiptId);
    const r = s.receipts.find(r => r.id === b.receiptId), o = s.orders.find(o => o.id === b.poId);
    if (!r || !o || r.orderId !== o.id || !['approved', 'closed'].includes(o.status) || b.quantity !== r.quantity || b.unitCost !== o.unitCost || b.supplier !== o.supplier || b.amount !== r.quantity * o.unitCost || b.base !== b.amount || b.currency !== 'IDR' || b.rate !== 1 || b.account !== '1300')
        throw Error('Invoice berbeda dari PO/penerimaan barang.');
    text(b.createdBy);
    const at = jakartaDay(b.createdAt);
    date(b.date);
    date(b.due);
    if (Date.parse(b.createdAt) < Date.parse(r.at) || b.date < jakartaDay(r.at) || b.date > at || b.due < b.date)
        throw Error('Audit tanggal invoice tidak konsisten.');
} }
