// Generated from shared/ap-statement.ts.
import { apAging, calendarDate } from './ap-aging-domain.mjs';
const normalize = (s) => s.trim().toLowerCase();
function safe(n) { if (!Number.isSafeInteger(n))
    throw Error('Saldo mutasi melebihi presisi rupiah yang didukung.'); return n; }
export function apStatement(bills, payments, start, end, supplier = '') {
    calendarDate(start);
    calendarDate(end);
    if (start > end)
        throw Error('Tanggal awal harus sebelum atau sama dengan akhir.');
    apAging(bills, payments, end);
    const dates = new Map(bills.map(b => [b.id, b.date]));
    for (const p of payments)
        if (p.date < dates.get(p.billId))
            throw Error('Tanggal pembayaran mendahului invoice; data perlu diperiksa.');
    const chosen = bills.filter(b => !supplier || normalize(b.supplier) === normalize(supplier)), ids = new Set(chosen.map(b => b.id)), paymentRows = payments.filter(p => ids.has(p.billId));
    let opening = 0;
    for (const b of chosen)
        if (b.date < start)
            opening = safe(opening + b.base);
    for (const p of paymentRows)
        if (p.date < start)
            opening = safe(opening - p.amount);
    const entries = [...chosen.filter(b => b.date >= start && b.date <= end).map(b => ({ id: b.id, kind: 'invoice', date: b.date, supplier: b.supplier, reference: b.reference, invoiceId: b.id, invoiceReference: b.reference, increase: b.base, decrease: 0, balance: 0, actor: b.createdBy, poId: b.poId, receiptId: b.receiptId })), ...paymentRows.filter(p => p.date >= start && p.date <= end).map(p => { const b = chosen.find(b => b.id === p.billId); return { id: p.id, kind: 'payment', date: p.date, supplier: b.supplier, reference: p.reference || p.id, invoiceId: b.id, invoiceReference: b.reference, increase: 0, decrease: p.amount, balance: 0, actor: p.actor, poId: b.poId, receiptId: b.receiptId }; })].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'invoice' ? -1 : 1) || a.id.localeCompare(b.id));
    let closing = opening, invoiced = 0, paid = 0;
    const rows = entries.map(r => { invoiced = safe(invoiced + r.increase); paid = safe(paid + r.decrease); closing = safe(closing + r.increase - r.decrease); return { ...r, balance: closing }; });
    if (safe(opening + invoiced - paid) !== closing)
        throw Error('Mutasi utang tidak dapat direkonsiliasi.');
    return { start, end, supplier, currency: 'IDR', opening, invoiced, paid, closing, rows };
}
export function statementCSV(s) { const data = [['Awal periode', 'Akhir periode', 'Pemasok filter', 'Tanggal', 'Jenis', 'Referensi', 'Pemasok', 'Invoice', 'ID invoice', 'Penambahan IDR', 'Pembayaran IDR', 'Saldo utang IDR', 'Aktor', 'PO', 'Penerimaan'], [s.start, s.end, s.supplier || 'Semua pemasok', s.start, 'Saldo awal', '', '', '', '', 0, 0, s.opening, '', '', ''], ...s.rows.map(r => [s.start, s.end, s.supplier || 'Semua pemasok', r.date, r.kind, r.reference, r.supplier, r.invoiceReference, r.invoiceId, r.increase, r.decrease, r.balance, r.actor || '', r.poId || '', r.receiptId || '']), [s.start, s.end, s.supplier || 'Semua pemasok', s.end, 'Saldo akhir', '', '', '', '', s.invoiced, s.paid, s.closing, '', '', '']]; return '\uFEFF' + data.map(row => row.map(v => '"' + (typeof v === 'string' && /^[=+@\-\t\r]/.test(v) ? "'" + v : String(v)).replaceAll('"', '""') + '"').join(',')).join('\n'); }
