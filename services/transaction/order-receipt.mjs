import {inventoryLock,readInventory} from './inventory-service.mjs';
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status});};
export async function receiveOrder(c,tenant,id,data,actor){
 const reference=typeof data.reference==='string'?data.reference.trim():'',receiver=typeof data.receiver==='string'?data.receiver.trim():'';
 if(!reference||reference.length>100||!receiver||receiver.length>100)fail('Receipt reference and receiver required (max 100)',400);
 if(typeof actor!=='string'||!actor.trim()||actor.length>200)fail('Authenticated actor required',403);
 await inventoryLock(c,tenant);
 const row=(await c.query('SELECT * FROM sajada.sales_order WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,id])).rows[0];
 if(!row)fail('Order not found',404);
 if(row.received_at){if(row.receipt_reference!==reference||row.receiver_name!==receiver)fail('Receipt proof conflicts');return {...row,replayed:true};}
 if(row.status!=='paid'||!row.dispatched_at||!row.inventory_location_id)fail('Paid dispatched order required');
 const items=(await c.query('SELECT product_id,quantity FROM sajada.order_item WHERE tenant_id=$1 AND order_id=$2 ORDER BY line_no',[tenant,id])).rows;
 const w=await readInventory(c,tenant),docs=w.documents.filter(d=>d.kind==='reserve'&&d.reference===id),expected=new Map(),found=new Map();
 if(!items.length)fail('Order has no items');
 for(const item of items)expected.set(item.product_id,(expected.get(item.product_id)||0)+Number(item.quantity));
 for(const d of docs){if(d.status!=='shipped'||d.locationId!==row.inventory_location_id||d.returned>0)fail('Incomplete shipment or return requires reconciliation');if(!w.documents.some(s=>s.kind==='ship'&&s.sourceId===d.id&&s.reference===row.dispatch_reference&&s.actor===row.dispatched_by))fail('Dispatch proof mismatch');found.set(d.productId,(found.get(d.productId)||0)+d.quantity);}
 if(found.size!==expected.size||[...expected].some(([product,qty])=>found.get(product)!==qty))fail('Order shipment history incomplete');
 const result=(await c.query('UPDATE sajada.sales_order SET received_at=now(),received_by=$3,receipt_reference=$4,receiver_name=$5 WHERE tenant_id=$1 AND id=$2 RETURNING *',[tenant,id,actor,reference,receiver])).rows[0];
 await c.query("INSERT INTO sajada.outbox(tenant_id,aggregate_id,event_type,schema_version,payload) VALUES($1,$2,'order.received',1,$3)",[tenant,id,JSON.stringify({order_id:id,reference,receiver,actor,dispatch_reference:row.dispatch_reference})]);
 return result;
}
