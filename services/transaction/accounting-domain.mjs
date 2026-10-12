// Generated from shared/accounting.ts.
import { validateCapitalRecord } from './member-capital-domain.mjs';
export const accounts = { '1100': 'Kas / bank', '1190': 'Pendanaan program belum direkonsiliasi', '1200': 'Piutang usaha', '1300': 'Persediaan', '2100': 'Utang usaha', '2210': 'Saldo belanja anggota', '2310': 'Iuran / biaya menunggu klasifikasi', '3100': 'Modal anggota', '4100': 'Penjualan', '5100': 'Beban operasional' };
export function positive(value) { if (!Number.isSafeInteger(value) || value <= 0)
    throw Error('Jumlah harus rupiah bulat positif.'); return value; }
export function billAmount(amount, rate) { if (!Number.isFinite(amount) || !Number.isFinite(rate) || amount <= 0 || rate <= 0)
    throw Error('Nominal dan kurs harus positif.'); return positive(Math.round(amount * rate)); }
export function outstanding(bill, payments) { return bill.base - payments.filter(p => p.billId === bill.id).reduce((s, p) => s + p.amount, 0); }
export function validatePayment(bill, payments, amount, cash) { positive(amount); if (amount > outstanding(bill, payments))
    throw Error('Pembayaran melebihi sisa utang.'); if (amount > cash)
    throw Error('Saldo kas demo belum cukup. Catat modal atau penerimaan terlebih dahulu.'); return amount; }
export function ledger(orders, paid, bills, payments, capital, memberRecords = {}) {
    const rows = [];
    function pair(reference, date, description, debit, credit, amount) { positive(amount); rows.push({ reference, date, description, account: debit, debit: amount, credit: 0 }, { reference, date, description, account: credit, debit: 0, credit: amount }); }
    for (const [name, r] of Object.entries(memberRecords)) {
        validateCapitalRecord(r);
        if (r.breakdown) {
            const d = new Date(Date.parse(r.breakdown.activatedAt) + 7 * 3600000).toISOString().slice(0, 10);
            pair('CAP-WALLET-' + name, d, 'Aktivasi saldo belanja ' + name, '1190', '2210', r.breakdown.wallet);
            pair('CAP-FEES-' + name, d, 'Komponen iuran/biaya belum diklasifikasi ' + name, '1190', '2310', r.breakdown.fees.memberDues + r.breakdown.fees.adminFee + r.breakdown.fees.other);
        }
    }
    for (const c of capital)
        pair(c.id, c.date, c.note, '1100', '3100', c.amount);
    for (const o of new Map(orders.map(o => [o.id, o])).values()) {
        pair(o.id, o.date, 'Penjualan demo', '1200', '4100', o.total);
        if (o.cancelledAt)
            pair(o.id + '-CANCEL', o.cancelledAt.slice(0, 10), 'Pembatalan penjualan demo', '4100', '1200', o.total);
        if (paid.includes(o.id))
            pair(o.id + '-PAY', o.paidDate || o.date, o.walletPayment ? 'Pembayaran saldo belanja ' + o.walletPayment.member : 'Penerimaan piutang', o.walletPayment ? '2210' : '1100', '1200', o.total);
        if (o.walletRefund)
            pair(o.id + '-WREF', new Date(Date.parse(o.walletRefund.at) + 7 * 3600000).toISOString().slice(0, 10), 'Refund saldo belanja ' + o.walletPayment.member, '1200', '2210', o.walletRefund.amount);
    }
    for (const b of bills)
        pair(b.id, b.date, b.supplier + ' · ' + b.reference, b.account, '2100', b.base);
    for (const p of payments)
        pair(p.id, p.date, 'Pembayaran utang ' + p.billId + (p.reference ? ' · ' + p.reference : ''), '2100', '1100', p.amount);
    return rows;
}
export function trialBalance(lines) { return Object.entries(accounts).map(([account, name]) => { const entries = lines.filter(l => l.account === account); const debit = entries.reduce((s, l) => s + l.debit, 0), credit = entries.reduce((s, l) => s + l.credit, 0); return { account, name, debit, credit, balanceDebit: Math.max(debit - credit, 0), balanceCredit: Math.max(credit - debit, 0) }; }); }
export function age(due, today) { const days = Math.floor((Date.parse(today + 'T00:00:00Z') - Date.parse(due + 'T00:00:00Z')) / 86400000); if (!Number.isFinite(days))
    throw Error('Tanggal tidak valid.'); return days <= 0 ? 'Belum jatuh tempo' : days <= 30 ? '1–30 hari' : days <= 60 ? '31–60 hari' : days <= 90 ? '61–90 hari' : '>90 hari'; }
