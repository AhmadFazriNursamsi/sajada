// Generated from shared/po-delivery.ts.
import { validateConfirmations } from './po-confirmation-domain.mjs';
import { checkPOTiming } from './replenishment-domain.mjs';
import { calendarDate } from './ap-aging-domain.mjs';
export const deliveryBuckets = ['overdue', 'today', 'upcoming', 'unscheduled', 'draft'];
export const deliveryLabels = { overdue: 'Terlambat', today: 'Tiba hari ini', upcoming: 'Akan tiba', unscheduled: 'Belum terjadwal', draft: 'Menunggu persetujuan' };
function sum(a, b) { const n = a + b; if (!Number.isSafeInteger(n) || n < 0)
    throw Error('Total laporan PO melebihi batas angka aman.'); return n; }
// Current PO balance, evaluated against a chosen calendar date. This is not a historical snapshot.
export function poDelivery(orders, referenceDate, options = {}, confirmations = []) {
    const confirmed = validateConfirmations(confirmations, orders);
    calendarDate(referenceDate);
    if (options.bucket && !deliveryBuckets.includes(options.bucket))
        throw Error('Kelompok jadwal PO tidak valid.');
    const ids = new Set();
    for (const o of orders) {
        if (ids.has(o.id) || !['draft', 'approved', 'closed', 'cancelled'].includes(o.status))
            throw Error('PO berulang/status tidak valid.');
        ids.add(o.id);
        checkPOTiming(o);
        if (!Number.isSafeInteger(o.quantity) || o.quantity < 1 || o.quantity > 1e9 || !Number.isSafeInteger(o.received) || o.received < 0 || o.received > o.quantity || !Number.isSafeInteger(o.unitCost) || o.unitCost < 1 || o.quantity * o.unitCost > 1e12)
            throw Error('Nilai/saldo PO tidak valid.');
        if (o.status === 'approved' && o.received === o.quantity || o.status === 'closed' && o.received !== o.quantity || ['draft', 'cancelled'].includes(o.status) && o.received !== 0)
            throw Error('Saldo tidak cocok dengan status PO.');
    }
    const rows = orders.filter(o => ['draft', 'approved'].includes(o.status) && (!options.locationId || o.locationId === options.locationId) && (!options.supplier || o.supplier.trim().toLowerCase() === options.supplier.trim().toLowerCase())).flatMap(o => {
        const confirmation = confirmed.get(o.id), expectedOn = confirmation?.confirmedOn || o.expectedOn;
        const remaining = o.quantity - o.received, daysLate = expectedOn ? Math.max(0, Math.round((Date.parse(referenceDate + 'T00:00:00Z') - Date.parse(expectedOn + 'T00:00:00Z')) / 86400000)) : 0;
        const bucket = o.status === 'draft' ? 'draft' : !expectedOn ? 'unscheduled' : daysLate > 0 ? 'overdue' : expectedOn === referenceDate ? 'today' : 'upcoming';
        if (options.bucket && options.bucket !== bucket)
            return [];
        return [{ id: o.id, number: o.number, locationId: o.locationId, productName: o.productName, supplier: o.supplier, expectedOn, originalExpectedOn: o.expectedOn, scheduleBasis: confirmation ? 'supplier' : o.expectedOn ? 'estimate' : 'none', confirmationReference: confirmation?.reference, leadDays: o.leadDays, quantity: o.quantity, received: o.received, remaining, remainingValue: remaining * o.unitCost, daysLate, bucket }];
    }).sort((a, b) => deliveryBuckets.indexOf(a.bucket) - deliveryBuckets.indexOf(b.bucket) || b.daysLate - a.daysLate || (a.expectedOn || '').localeCompare(b.expectedOn || '') || a.id.localeCompare(b.id));
    const counts = { overdue: 0, today: 0, upcoming: 0, unscheduled: 0, draft: 0 };
    let remaining = 0, approvedValue = 0, overdueRemaining = 0, overdueValue = 0;
    for (const r of rows) {
        counts[r.bucket]++;
        remaining = sum(remaining, r.remaining);
        if (r.bucket !== 'draft')
            approvedValue = sum(approvedValue, r.remainingValue);
        if (r.bucket === 'overdue') {
            overdueRemaining = sum(overdueRemaining, r.remaining);
            overdueValue = sum(overdueValue, r.remainingValue);
        }
    }
    return { referenceDate, balanceBasis: 'current', currency: 'IDR', counts, remaining, approvedValue, overdueRemaining, overdueValue, rows };
}
export function deliveryCSV(report) { const rows = [['Tanggal penilaian', 'Basis saldo', 'PO', 'Pemasok', 'Lokasi ID', 'Barang', 'Jadwal dipakai WIB', 'Estimasi awal WIB', 'Dasar jadwal', 'Referensi konfirmasi', 'Lead hari kalender', 'Jumlah', 'Diterima terkini', 'Sisa terkini', 'Nilai sisa IDR', 'Hari terlambat', 'Kelompok'], ...report.rows.map(r => [report.referenceDate, 'Saldo terkini', r.number, r.supplier, r.locationId, r.productName, r.expectedOn || '', r.originalExpectedOn || '', r.scheduleBasis, r.confirmationReference || '', r.leadDays ?? '', r.quantity, r.received, r.remaining, r.remainingValue, r.daysLate, deliveryLabels[r.bucket]])]; return '\uFEFF' + rows.map(row => row.map(v => '"' + (typeof v === 'string' && /^[=+@\-\t\r]/.test(v) ? "'" + v : String(v)).replaceAll('"', '""') + '"').join(',')).join('\n'); }
