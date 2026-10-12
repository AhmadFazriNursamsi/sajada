import {applyStock,type WarehouseState} from './warehouses.ts';
export function orderReservations(order:any,w:WarehouseState,status:'reserved'|'shipped'){
 if(!order.locationId)throw Error('Pesanan lama memerlukan rekonsiliasi manual.');
 const docs=w.documents.filter(d=>d.kind==='reserve'&&d.reference===order.id),expected=new Map<string,number>(),found=new Map<string,number>();
 if(!order.items.length)throw Error('Pesanan tidak mempunyai item.');
 for(const i of order.items)expected.set(i.product_id,(expected.get(i.product_id)||0)+(i.quantity||1));
 for(const d of docs){if(d.locationId!==order.locationId||d.status!==status)throw Error('Reservasi sudah diproses atau lokasi tidak sesuai.');found.set(d.productId,(found.get(d.productId)||0)+d.quantity);}
 if(found.size!==expected.size||[...expected].some(([id,q])=>found.get(id)!==q))throw Error('Riwayat reservasi pesanan tidak lengkap.');
 return docs;
}
export function validateDispatch(order:any,paid:string[],w:WarehouseState){
 if(order.cancelledAt||!paid.includes(order.id))throw Error('Pengiriman hanya untuk pesanan lunas dan tidak dibatalkan.');
 if(!order.dispatchedAt||!order.dispatchedBy?.trim()||order.dispatchedBy.length>200||!order.dispatchReference?.trim()||order.dispatchReference.length>100)throw Error('Audit pengiriman tidak lengkap.');
 const docs=orderReservations(order,w,'shipped');
 for(const d of docs)if(!w.documents.some(ship=>ship.kind==='ship'&&ship.sourceId===d.id&&ship.reference===order.dispatchReference&&ship.actor===order.dispatchedBy))throw Error('Surat jalan berbeda dari kartu stok.');
}
export function dispatchBrowserOrder(order:any,paid:string[],w:WarehouseState,reference:string,actor:string,at:string,newId:()=>string){
 reference=reference.trim();if(!reference||reference.length>100)throw Error('Referensi surat jalan wajib diisi, maksimal 100 karakter.');
 if(order.dispatchedAt){if(order.dispatchReference!==reference)throw Error('Referensi pengiriman berbeda.');validateDispatch(order,paid,w);return {order,warehouses:w};}
 if(order.cancelledAt||!paid.includes(order.id))throw Error('Pesanan harus lunas sebelum dikirim.');
 const docs=orderReservations(order,w,'reserved');let next=w;
 for(const d of docs)next=applyStock(next,{id:newId(),kind:'ship',sourceId:d.id,reference},actor,at);
 const result={...order,dispatchedAt:at,dispatchedBy:actor,dispatchReference:reference};validateDispatch(result,paid,next);
 return {order:result,warehouses:next};
}
