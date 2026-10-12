// Generated from shared/supplier-performance.ts.
import { poDelivery } from './po-delivery-domain.mjs';
import { calendarDate } from './ap-aging-domain.mjs';
import { poExpectedOn } from './replenishment-domain.mjs';
export const supplierKey = (o) => o.supplierSnapshot ? 'id:' + o.supplierSnapshot.id : 'name:' + o.supplier.trim().toLowerCase();
function sum(a, b) { const n = a + b; if (!Number.isSafeInteger(n) || n < 0)
    throw Error('Total laporan pemasok melebihi batas angka aman.'); return n; }
const days = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
const rate = (onTime, total) => total ? Math.round(onTime / total * 1000) / 10 : null;
function metrics(rows) { const original = rows.filter(r => r.originalDaysLate !== undefined), confirmed = rows.filter(r => r.confirmedDaysLate !== undefined); return { completed: rows.length, value: rows.reduce((n, r) => sum(n, r.value), 0), originalEligible: original.length, originalOnTime: original.filter(r => r.originalDaysLate === 0).length, originalLate: original.filter(r => r.originalDaysLate > 0).length, originalRate: rate(original.filter(r => r.originalDaysLate === 0).length, original.length), missingOriginal: rows.length - original.length, confirmedEligible: confirmed.length, confirmedOnTime: confirmed.filter(r => r.confirmedDaysLate === 0).length, confirmedRate: rate(confirmed.filter(r => r.confirmedDaysLate === 0).length, confirmed.length), averageElapsedDays: rows.length ? Math.round(rows.reduce((n, r) => sum(n, r.elapsedDays), 0) / rows.length * 10) / 10 : null }; }
// Completion cohort, not a historical frozen database snapshot; no partial PO counts as complete.
export function supplierPerformance(orders, receipts, confirmations, start, end, options = {}) {
    calendarDate(start);
    calendarDate(end);
    if (start > end)
        throw Error('Tanggal awal harus sebelum atau sama dengan akhir.');
    poDelivery(orders, end, {}, confirmations);
    const ids = new Set(), received = new Map(), last = new Map();
    for (const r of receipts) {
        const o = orders.find(o => o.id === r.orderId);
        if (ids.has(r.id) || !o || !o.approvedAt || !['approved', 'closed'].includes(o.status) || !Number.isSafeInteger(r.quantity) || r.quantity < 1 || r.quantity > 1e9 || !Number.isFinite(Date.parse(r.at)) || Date.parse(r.at) < Date.parse(o.approvedAt))
            throw Error('Penerimaan PO berulang atau audit/tanggal tidak valid.');
        ids.add(r.id);
        received.set(r.orderId, sum(received.get(r.orderId) || 0, r.quantity));
        if (!last.has(r.orderId) || Date.parse(r.at) > Date.parse(last.get(r.orderId).at))
            last.set(r.orderId, r);
    }
    for (const o of orders)
        if ((received.get(o.id) || 0) !== o.received)
            throw Error('Penerimaan tidak cocok dengan saldo PO.');
    const rows = orders.filter(o => o.status === 'closed' && (!options.locationId || o.locationId === options.locationId) && (!options.supplierKey || supplierKey(o) === options.supplierKey)).flatMap(o => { const final = last.get(o.id); if (!final)
        throw Error('PO selesai tanpa penerimaan.'); const completedOn = poExpectedOn(final.at, 0); if (completedOn < start || completedOn > end)
        return []; const approvedOn = poExpectedOn(o.approvedAt, 0), c = confirmations.filter(c => c.orderId === o.id && Date.parse(c.at) <= Date.parse(final.at)).sort((a, b) => b.revision - a.revision)[0]; return [{ id: o.id, number: o.number, supplierKey: supplierKey(o), supplier: o.supplier, locationId: o.locationId, productName: o.productName, completedOn, approvedOn, elapsedDays: days(completedOn, approvedOn), originalExpectedOn: o.expectedOn, originalDaysLate: o.expectedOn ? Math.max(0, days(completedOn, o.expectedOn)) : undefined, confirmedOn: c?.confirmedOn, confirmedDaysLate: c ? Math.max(0, days(completedOn, c.confirmedOn)) : undefined, confirmationReference: c?.reference, quantity: o.quantity, value: o.quantity * o.unitCost }]; }).sort((a, b) => b.completedOn.localeCompare(a.completedOn) || a.id.localeCompare(b.id));
    const groups = new Map();
    for (const row of rows) {
        groups.set(row.supplierKey, [...(groups.get(row.supplierKey) || []), row]);
    }
    const suppliers = [...groups.entries()].map(([key, rs]) => { const latest = orders.filter(o => rs.some(r => r.id === o.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0]; return { key, supplier: latest.supplier, ...metrics(rs) }; }).sort((a, b) => (a.originalRate ?? 101) - (b.originalRate ?? 101) || b.completed - a.completed || a.key.localeCompare(b.key));
    return { start, end, currency: 'IDR', basis: 'completed_receipts', summary: metrics(rows), suppliers, rows };
}
export function supplierPerformanceCSV(report) { const rows = [['Awal periode', 'Akhir periode', 'PO', 'Kunci pemasok', 'Nama snapshot', 'Lokasi ID', 'Barang', 'Disetujui WIB', 'Selesai diterima WIB', 'Hari penyelesaian', 'Estimasi awal', 'Terlambat estimasi hari', 'Konfirmasi terakhir sebelum selesai', 'Referensi konfirmasi', 'Terlambat konfirmasi hari', 'Jumlah PO', 'Nilai barang IDR'], ...report.rows.map(r => [report.start, report.end, r.number, r.supplierKey, r.supplier, r.locationId, r.productName, r.approvedOn, r.completedOn, r.elapsedDays, r.originalExpectedOn || '', r.originalDaysLate ?? '', r.confirmedOn || '', r.confirmationReference || '', r.confirmedDaysLate ?? '', r.quantity, r.value])]; return '\uFEFF' + rows.map(row => row.map(v => '"' + (typeof v === 'string' && /^[=+@\-\t\r]/.test(v) ? "'" + v : String(v)).replaceAll('"', '""') + '"').join(',')).join('\n'); }
