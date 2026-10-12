// Generated from shared/po-inspection.ts.
import { receivePO } from './replenishment-domain.mjs';
export function validateInspections(records, orders, receipts) {
    if (!Array.isArray(records))
        throw Error('Riwayat pemeriksaan tidak valid.');
    const ids = new Set(), receiptIds = new Set();
    for (const x of records) {
        const o = orders.find(o => o.id === x.orderId);
        if (!o || !['approved', 'closed'].includes(o.status) || typeof x.id !== 'string' || !x.id.trim() || x.id.length > 100 || ids.has(x.id))
            throw Error('Referensi/ID pemeriksaan tidak valid.');
        ids.add(x.id);
        for (const n of [x.accepted, x.rejected, x.remainingBefore])
            if (!Number.isSafeInteger(n) || n < 0 || n > 1e9)
                throw Error('Jumlah pemeriksaan harus unit bulat.');
        if (x.remainingBefore < 1 || x.remainingBefore > o.quantity || x.accepted + x.rejected < 1 || x.accepted + x.rejected > x.remainingBefore)
            throw Error('Jumlah diperiksa melebihi sisa PO atau kosong.');
        if (typeof x.reason !== 'string' || x.reason.length > 1000 || x.rejected > 0 && !x.reason.trim())
            throw Error('Alasan penolakan wajib diisi.');
        if (typeof x.actor !== 'string' || !x.actor.trim() || x.actor.length > 200 || !Number.isFinite(Date.parse(x.at)) || !o.approvedAt || Date.parse(x.at) < Date.parse(o.approvedAt))
            throw Error('Audit pemeriksaan tidak valid.');
        if (x.accepted) {
            const r = receipts.find(r => r.id === x.receiptId);
            if (x.receiptId !== x.id || receiptIds.has(x.receiptId) || !r || r.orderId !== x.orderId || r.quantity !== x.accepted || r.actor !== x.actor || r.at !== x.at)
                throw Error('Barang layak tidak cocok dengan penerimaan stok.');
            receiptIds.add(x.receiptId);
        }
        else if (x.receiptId !== undefined)
            throw Error('Barang ditolak tidak boleh mempunyai penerimaan stok.');
    }
    return records;
}
export function inspectPO(s, w, input, actor, at) {
    const old = s.inspections?.find(x => x.id === input.id);
    if (old) {
        if (['orderId', 'accepted', 'rejected', 'reason'].some(k => old[k] !== input[k]))
            throw Error('ID pemeriksaan digunakan untuk data berbeda.');
        return { state: s, warehouses: w };
    }
    const o = s.orders.find(o => o.id === input.orderId);
    if (!o || o.status !== 'approved' || o.received >= o.quantity)
        throw Error('Pemeriksaan hanya untuk PO disetujui yang belum selesai.');
    if (s.receipts.some(x => x.id === input.id) || w.documents.some(x => x.id === input.id))
        throw Error('ID sudah dipakai oleh penerimaan lain.');
    const record = { ...input, remainingBefore: o.quantity - o.received, ...(input.accepted > 0 ? { receiptId: input.id } : {}), actor, at };
    const prospective = { ...s, receipts: [...s.receipts, ...(input.accepted > 0 ? [{ id: input.id, orderId: o.id, quantity: input.accepted, actor, at }] : [])] };
    validateInspections([record], s.orders, prospective.receipts);
    const received = input.accepted > 0 ? receivePO(s, w, o.id, input.id, input.accepted, actor, at) : { state: s, warehouses: w };
    return { state: { ...received.state, inspections: [...(s.inspections || []), record] }, warehouses: received.warehouses };
}
