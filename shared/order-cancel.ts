import {applyStock,type WarehouseState} from './warehouses.ts';
export function cancelBrowserOrder(order:any,paid:string[],w:WarehouseState,reason:string,actor:string,at:string,newId:()=>string){
 reason=reason.trim();if(!reason||reason.length>200)throw Error('Alasan pembatalan wajib diisi, maksimal 200 karakter.');
 if(order.cancelledAt){if(order.cancelReason!==reason)throw Error('Alasan pembatalan berbeda.');return {order,warehouses:w};}
 if(paid.includes(order.id))throw Error('Pesanan sudah dibayar; gunakan alur refund.');
 if(!order.locationId)throw Error('Pesanan lama memerlukan rekonsiliasi manual.');
 const docs=w.documents.filter(d=>d.kind==='reserve'&&d.reference===order.id),expected=new Map<string,number>(),found=new Map<string,number>();
 for(const i of order.items)expected.set(i.product_id,(expected.get(i.product_id)||0)+(i.quantity||1));
 for(const d of docs){if(d.locationId!==order.locationId||!['reserved','cancelled'].includes(d.status))throw Error('Pesanan sudah dikirim atau reservasi tidak sesuai.');found.set(d.productId,(found.get(d.productId)||0)+d.quantity);}
 if(found.size!==expected.size||[...expected].some(([id,q])=>found.get(id)!==q))throw Error('Riwayat reservasi pesanan tidak lengkap.');
 let next=w;for(const d of docs)if(d.status==='reserved')next=applyStock(next,{id:newId(),kind:'release',sourceId:d.id,reference:'Batal '+order.id},actor,at);
 return {order:{...order,cancelledAt:at,cancelReason:reason,cancelledBy:actor},warehouses:next};
}
