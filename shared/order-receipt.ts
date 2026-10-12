import {validateDispatch,orderReservations} from './order-dispatch.ts';
import type {WarehouseState} from './warehouses.ts';
export const RECEIPT_POLICY='full-receipt-v1';
function proof(reference:string,receiver:string,actor:string){for(const [s,max]of [[reference,100],[receiver,100],[actor,200]] as const)if(typeof s!=='string'||!s.trim()||s.length>max)throw Error('Referensi, nama penerima dan aktor wajib diisi sesuai batas panjang.');}
export function validateReceipt(order:any,paid:string[],w:WarehouseState){
 validateDispatch(order,paid,w);proof(order.receiptReference,order.receiverName,order.receivedBy);
 const time=Date.parse(order.receivedAt),dispatch=Date.parse(order.dispatchedAt);if(!Number.isFinite(time)||!Number.isFinite(dispatch)||time<dispatch)throw Error('Waktu penerimaan tidak valid atau sebelum pengiriman.');
 const docs=orderReservations(order,w,'shipped');for(const d of docs)if(w.documents.some(r=>r.kind==='return'&&r.sourceId===d.id&&Date.parse(r.at)<time))throw Error('Retur sebelum penerimaan memerlukan rekonsiliasi.');
}
export function receiveBrowserOrder(order:any,paid:string[],w:WarehouseState,reference:string,receiver:string,actor:string,at:string){
 reference=reference.trim();receiver=receiver.trim();proof(reference,receiver,actor);
 if(order.receivedAt){if(order.receiptReference!==reference||order.receiverName!==receiver)throw Error('Bukti penerimaan berbeda.');validateReceipt(order,paid,w);return order;}
 validateDispatch(order,paid,w);if(orderReservations(order,w,'shipped').some(d=>d.returned>0))throw Error('Retur sebelum penerimaan memerlukan rekonsiliasi.');
 const result={...order,receivedAt:at,receivedBy:actor,receiptReference:reference,receiverName:receiver};validateReceipt(result,paid,w);return result;
}
// Legacy completed orders remain eligible; new orders require receipt evidence.
export function completedForCommission(order:any,legacyDelivered:string[]){return !order.cancelledAt&&Boolean(order.receivedAt||(!order.receiptPolicy&&legacyDelivered.includes(order.id)));}
