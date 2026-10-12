// Generated from shared/inventory-reports.ts by build-inventory-domain.mjs.
import { stockAt } from './inventory-domain.mjs';
export function locationScope(w, options) {
    if (!options.locationId)
        return w.locations.map(l => l.id);
    if (!w.locations.some(l => l.id === options.locationId))
        throw Error('Lokasi tidak ditemukan pada tenant.');
    const ids = new Set([options.locationId]);
    if (options.includeChildren) {
        let changed = true;
        while (changed) {
            changed = false;
            for (const l of w.locations)
                if (l.parentId && ids.has(l.parentId) && !ids.has(l.id)) {
                    ids.add(l.id);
                    changed = true;
                }
        }
    }
    return [...ids];
}
export function jakartaDay(at) { const n = Date.parse(at); if (!Number.isFinite(n))
    throw Error('Waktu kartu stok tidak valid.'); return new Date(n + 7 * 3600000).toISOString().slice(0, 10); }
function day(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s + 'T00:00:00Z')) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s)
    throw Error('Tanggal laporan tidak valid.'); return Date.parse(s + 'T00:00:00Z'); }
export function inventoryPeriod(w, products, start, end, options = {}) {
    const first = day(start), last = day(end);
    if (first > last || last - first > 365 * 86400000)
        throw Error('Periode maksimal 366 hari dan tanggal akhir harus sesudah awal.');
    if (options.productId && !products.some(p => p.id === options.productId))
        throw Error('Produk tidak ditemukan pada tenant.');
    const ids = locationScope(w, options), selected = products.filter(p => !options.productId || p.id === options.productId);
    const movementDays = new Map(w.movements.map(m => [m.id, jakartaDay(m.at)]));
    const transfers = w.documents.filter(d => d.kind === 'transfer' && jakartaDay(d.at) <= end && !w.documents.some(a => a.kind === 'accept' && a.sourceId === d.id && jakartaDay(a.at) <= end));
    return ids.flatMap(locationId => selected.map(p => {
        let opening = 0, incoming = 0, outgoing = 0, reservedOpening = 0, reservedDelta = 0;
        for (const m of w.movements) {
            if (m.locationId !== locationId || m.productId !== p.id)
                continue;
            const date = movementDays.get(m.id);
            if (date < start) {
                opening += m.physical;
                reservedOpening += m.reserved;
            }
            else if (date <= end) {
                incoming += Math.max(m.physical, 0);
                outgoing += Math.max(-m.physical, 0);
                reservedDelta += m.reserved;
            }
        }
        const closing = opening + incoming - outgoing, reservedClosing = reservedOpening + reservedDelta;
        return { locationId, locationName: w.locations.find(l => l.id === locationId).name, productId: p.id, productName: p.name, sku: p.sku || '', opening, incoming, outgoing, closing, reservedOpening, reservedDelta, reservedClosing, availableClosing: closing - reservedClosing, transitIncoming: transfers.filter(d => d.toId === locationId && d.productId === p.id).reduce((s, d) => s + d.quantity, 0), transitOutgoing: transfers.filter(d => d.locationId === locationId && d.productId === p.id).reduce((s, d) => s + d.quantity, 0) };
    }));
}
export function restockPlan(w, products, buffer = 5, options = {}, orders = []) {
    if (!Number.isSafeInteger(buffer) || buffer < 0 || buffer > 1e9)
        throw Error('Buffer harus unit bulat 0 sampai 1 miliar.');
    if (options.productId && !products.some(p => p.id === options.productId))
        throw Error('Produk tidak ditemukan pada tenant.');
    const ids = locationScope(w, options), selected = products.filter(p => p.active !== false && (!options.productId || p.id === options.productId)), rows = [];
    for (const p of selected) {
        const supply = new Map(w.locations.map(l => { const b = stockAt(w, l.id, p.id); return [l.id, Math.max(0, b.onHand - b.reserved - b.minimum - buffer)]; }));
        const needs = ids.map(locationId => { const b = stockAt(w, locationId, p.id), available = b.onHand - b.reserved, transit = w.documents.filter(d => d.kind === 'transfer' && d.status === 'transit' && d.toId === locationId && d.productId === p.id).reduce((s, d) => s + d.quantity, 0); return { locationId, b, available, transit }; }).filter(r => r.available <= r.b.minimum).sort((a, b) => a.available - b.available || a.locationId.localeCompare(b.locationId));
        for (const n of needs) {
            const location = w.locations.find(l => l.id === n.locationId), target = Math.min(1e9 - n.b.reserved, n.b.minimum + buffer), onOrder = orders.filter(o => o.locationId === n.locationId && o.productId === p.id && ['draft', 'approved'].includes(o.status)).reduce((a, o) => a + o.quantity - o.received, 0), need = Math.max(0, target - n.available - n.transit - onOrder);
            let remaining = need;
            const transfers = [];
            const donors = w.locations.filter(l => l.id !== n.locationId && (supply.get(l.id) || 0) > 0).sort((a, b) => Number(b.id === location.parentId) - Number(a.id === location.parentId) || (supply.get(b.id) || 0) - (supply.get(a.id) || 0) || a.id.localeCompare(b.id));
            for (const donor of donors) {
                const quantity = Math.min(remaining, supply.get(donor.id) || 0);
                if (quantity > 0) {
                    transfers.push({ locationId: donor.id, locationName: donor.name, quantity });
                    supply.set(donor.id, supply.get(donor.id) - quantity);
                    remaining -= quantity;
                }
                if (remaining === 0)
                    break;
            }
            rows.push({ locationId: n.locationId, locationName: location.name, productId: p.id, productName: p.name, sku: p.sku || '', available: n.available, minimum: n.b.minimum, target, transit: n.transit, onOrder, need, transfers, purchase: remaining });
        }
    }
    return rows;
}
