// Generated from shared/member-capital.ts.
export const INITIAL_CAPITAL_IDR = 12500000;
export const WALLET_CAPITAL_IDR = 10000000;
export const MEMBER_FEES_IDR = 2500000;
export const DEFAULT_FEE_PLAN = { memberDues: 0, adminFee: 0, other: MEMBER_FEES_IDR, note: 'Iuran, admin fee dan lainnya belum dirinci' };
export function validateFeePlan(p) { if (!p || typeof p !== 'object' || Object.keys(p).some(k => !['memberDues', 'adminFee', 'other', 'note'].includes(k)))
    throw Error('Rincian biaya tidak valid.'); for (const x of [p.memberDues, p.adminFee, p.other])
    if (!Number.isSafeInteger(x) || x < 0 || x > MEMBER_FEES_IDR)
        throw Error('Komponen biaya harus rupiah bulat nonnegatif.'); if (p.memberDues + p.adminFee + p.other !== MEMBER_FEES_IDR)
    throw Error('Total iuran, admin fee dan lainnya wajib Rp2.500.000.'); if (typeof p.note !== 'string' || !p.note.trim() || p.note.length > 1000)
    throw Error('Catatan rincian biaya wajib diisi.'); return p; }
export function validateCapitalRecord(r) { if (!r || !r.member?.trim() || !['allocated', 'disbursed'].includes(r.status))
    throw Error('Catatan permodalan tidak valid.'); if (r.breakdown) {
    const b = r.breakdown;
    if (r.status !== 'disbursed' || b.version !== 1 || b.wallet !== WALLET_CAPITAL_IDR || !Number.isFinite(Date.parse(b.activatedAt)) || !b.actor?.trim() || b.actor.length > 200)
        throw Error('Aktivasi saldo belanja tidak valid.');
    validateFeePlan(b.fees);
} return r; }
export function memberCapital(names, records) { return [...new Set(names)].map(member => ({ member, amount: INITIAL_CAPITAL_IDR, status: records[member]?.status || 'allocated', date: records[member]?.date, reference: records[member]?.reference, breakdown: records[member]?.breakdown })); }
export function disburseCapital(member, names, records, reference, date) { if (!names.includes(member))
    throw Error('Anggota tidak ditemukan pada tenant aktif.'); if (records[member]?.status === 'disbursed')
    throw Error('Modal awal sudah ditandai dicairkan.'); if (!reference.trim())
    throw Error('Referensi pencairan wajib diisi.'); return { ...records, [member]: { member, status: 'disbursed', reference: reference.trim(), date } }; }
export function activateCapitalWallet(member, names, records, fees, reference, date, actor, at) { validateFeePlan(fees); if (!names.includes(member))
    throw Error('Anggota tidak ditemukan pada tenant aktif.'); if (records[member]?.breakdown)
    throw Error('Saldo modal anggota sudah diaktifkan.'); if (!reference?.trim() || reference.length > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date)
    throw Error('Referensi dan tanggal aktivasi wajib valid.'); const old = records[member]; const record = { member, status: 'disbursed', reference: old?.reference || reference.trim(), date: old?.date || date, breakdown: { version: 1, wallet: WALLET_CAPITAL_IDR, fees: { ...fees }, actor, activatedAt: at } }; validateCapitalRecord(record); return { ...records, [member]: record }; }
export function walletBalance(member, records, orders, tenant) { const r = records[member]; if (r)
    validateCapitalRecord(r); const opening = r?.breakdown?.wallet || 0; let grossSpent = 0, refunded = 0; for (const o of orders.filter(o => o.walletPayment?.member === member)) {
    const p = o.walletPayment;
    if (o.tenant !== tenant || !!o.cancelledAt !== !!o.walletRefund || o.currency !== 'IDR' || !Number.isSafeInteger(o.total) || o.total <= 0 || p.amount !== o.total || !p.actor?.trim() || !Number.isFinite(Date.parse(p.at)) || !r?.breakdown || o.paidDate !== new Date(Date.parse(p.at) + 7 * 3600000).toISOString().slice(0, 10) || p.capitalActivatedAt !== r.breakdown.activatedAt || Date.parse(p.at) < Date.parse(r.breakdown.activatedAt))
        throw Error('Mutasi saldo belanja tidak konsisten.');
    grossSpent += p.amount;
    const f = o.walletRefund;
    if (f) {
        if (o.receiptPolicy !== 'full-receipt-v1' || !f.id?.trim() || !f.reference?.trim() || f.reference.length > 100 || !f.reason?.trim() || f.reason.length > 200 || f.amount !== p.amount || !f.actor?.trim() || f.actor.length > 200 || !Number.isFinite(Date.parse(f.at)) || Date.parse(f.at) < Date.parse(p.at) || o.dispatchedAt || o.receivedAt || o.cancelledAt !== f.at || o.cancelReason !== f.reason || o.cancelledBy !== f.actor)
            throw Error('Refund saldo belanja tidak konsisten.');
        refunded += f.amount;
    }
} const spent = grossSpent - refunded; if (spent > opening)
    throw Error('Pengeluaran melebihi saldo modal belanja.'); const events = [...orders].reverse().filter(o => o.walletPayment?.member === member).flatMap((o, i) => [{ at: o.walletPayment.at, amount: o.walletPayment.amount, rank: i * 2 }, ...(o.walletRefund ? [{ at: o.walletRefund.at, amount: -o.walletRefund.amount, rank: i * 2 + 1 }] : [])]).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.rank - b.rank); let used = 0; for (const e of events) {
    used += e.amount;
    if (used < 0 || used > opening)
        throw Error('Riwayat transaksi saldo pernah melebihi kapasitas.');
} return { opening, grossSpent, refunded, spent, available: opening - spent }; }
export function payWithCapitalWallet(orders, paid, records, names, tenant, orderId, member, actor, at) { const o = orders.find(o => o.id === orderId); if (!o || o.tenant !== tenant || !names.includes(member))
    throw Error('Pesanan atau anggota tidak ditemukan pada tenant aktif.'); if (o.walletPayment) {
    if (o.walletPayment.member !== member || !paid.includes(o.id))
        throw Error('Pembayaran pesanan sudah berbeda.');
    walletBalance(member, records, orders, tenant);
    return { orders, paid };
} if (paid.includes(o.id) || o.cancelledAt || o.dispatchedAt || o.currency !== 'IDR')
    throw Error('Pesanan tidak dapat dibayar dengan saldo modal.'); const r = records[member]; if (!r?.breakdown)
    throw Error('Aktifkan saldo modal belanja anggota terlebih dahulu.'); if (!actor?.trim() || actor.length > 200 || !Number.isFinite(Date.parse(at)) || Date.parse(at) < Date.parse(r.breakdown.activatedAt))
    throw Error('Audit pembayaran tidak valid.'); if (walletBalance(member, records, orders, tenant).available < o.total)
    throw Error('Saldo belanja koperasi tidak cukup.'); const next = orders.map(x => x.id === o.id ? { ...x, paidDate: new Date(Date.parse(at) + 7 * 3600000).toISOString().slice(0, 10), walletPayment: { member, amount: o.total, capitalActivatedAt: r.breakdown.activatedAt, actor, at } } : x); walletBalance(member, records, next, tenant); return { orders: next, paid: [...paid, o.id] }; }
