// Generated from shared/ap-aging.ts.
export const agingBuckets = ['current', 'd1_30', 'd31_60', 'd61_90', 'over90'];
export const agingLabels = { current: 'Belum jatuh tempo', d1_30: '1–30 hari', d31_60: '31–60 hari', d61_90: '61–90 hari', over90: '>90 hari' };
export function calendarDate(s) { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s + 'T00:00:00Z')) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s)
    throw Error('Tanggal laporan/tagihan/pembayaran tidak valid.'); return s; }
function value(v) { if (!Number.isSafeInteger(v) || v < 0)
    throw Error('Nilai rupiah laporan harus bulat non-negatif.'); return v; }
function sum(a, b) { return value(a + b); }
const key = (s) => s.trim().toLowerCase();
export function apAging(bills, payments, asOf, options = {}) {
    calendarDate(asOf);
    if (options.bucket && !agingBuckets.includes(options.bucket))
        throw Error('Bucket umur utang tidak valid.');
    const ids = new Set();
    for (const b of bills) {
        if (ids.has(b.id))
            throw Error('ID tagihan berulang.');
        ids.add(b.id);
        calendarDate(b.date);
        calendarDate(b.due);
        if (b.due < b.date || typeof b.supplier !== 'string' || !b.supplier.trim())
            throw Error('Pemasok/jatuh tempo tagihan tidak valid.');
        value(b.base);
        if (!b.base)
            throw Error('Tagihan harus positif.');
    }
    const paymentIds = new Set(), paidByBill = new Map(), allPaid = new Map();
    for (const p of payments) {
        if (paymentIds.has(p.id) || !ids.has(p.billId))
            throw Error('Pembayaran berulang atau tanpa tagihan.');
        paymentIds.add(p.id);
        calendarDate(p.date);
        value(p.amount);
        if (!p.amount)
            throw Error('Pembayaran harus positif.');
        allPaid.set(p.billId, sum(allPaid.get(p.billId) || 0, p.amount));
        if (p.date <= asOf)
            paidByBill.set(p.billId, sum(paidByBill.get(p.billId) || 0, p.amount));
    }
    for (const b of bills)
        if ((allPaid.get(b.id) || 0) > b.base)
            throw Error('Pembayaran melebihi nilai tagihan.');
    const rows = bills.filter(b => b.date <= asOf && (!options.supplier || key(b.supplier) === key(options.supplier))).flatMap(b => { const paid = paidByBill.get(b.id) || 0, outstanding = b.base - paid; if (!outstanding)
        return []; const daysOverdue = Math.max(0, Math.round((Date.parse(asOf + 'T00:00:00Z') - Date.parse(b.due + 'T00:00:00Z')) / 86400000)); const bucket = daysOverdue === 0 ? 'current' : daysOverdue <= 30 ? 'd1_30' : daysOverdue <= 60 ? 'd31_60' : daysOverdue <= 90 ? 'd61_90' : 'over90'; if (options.bucket && options.bucket !== bucket)
        return []; return [{ id: b.id, supplier: b.supplier, reference: b.reference, date: b.date, due: b.due, original: b.base, paid, outstanding, daysOverdue, bucket, poId: b.poId, receiptId: b.receiptId }]; }).sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstanding - a.outstanding || a.id.localeCompare(b.id));
    const totals = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 };
    const groups = new Map();
    let total = 0;
    for (const r of rows) {
        total = sum(total, r.outstanding);
        totals[r.bucket] = sum(totals[r.bucket], r.outstanding);
        const k = key(r.supplier), g = groups.get(k) || { supplier: r.supplier, count: 0, total: 0, overdue: 0, maxDays: 0, buckets: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 } };
        g.count++;
        g.total = sum(g.total, r.outstanding);
        if (r.daysOverdue > 0)
            g.overdue = sum(g.overdue, r.outstanding);
        g.maxDays = Math.max(g.maxDays, r.daysOverdue);
        g.buckets[r.bucket] = sum(g.buckets[r.bucket], r.outstanding);
        groups.set(k, g);
    }
    return { asOf, currency: 'IDR', total, overdue: total - totals.current, totals, rows, suppliers: [...groups.values()].sort((a, b) => b.overdue - a.overdue || b.maxDays - a.maxDays || a.supplier.localeCompare(b.supplier)) };
}
export function agingCSV(report) { const rows = [['Per tanggal', 'Pemasok', 'Invoice', 'Tanggal invoice', 'Jatuh tempo', 'Nilai IDR', 'Dibayar sampai tanggal IDR', 'Sisa IDR', 'Terlambat hari', 'Bucket', 'PO', 'Penerimaan'], ...report.rows.map(r => [report.asOf, r.supplier, r.reference, r.date, r.due, r.original, r.paid, r.outstanding, r.daysOverdue, agingLabels[r.bucket], r.poId || '', r.receiptId || ''])]; return '\uFEFF' + rows.map(row => row.map(v => '"' + (typeof v === 'string' && /^[=+@\-\t\r]/.test(v) ? "'" + v : String(v)).replaceAll('"', '""') + '"').join(',')).join('\n'); }
