import {randomUUID} from 'node:crypto';
import {inventoryLock,readInventory,inventoryAction} from './inventory-service.mjs';
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status});};
export async function dispatchOrder(c,tenant,id,data,actor){
 const reference=typeof data.reference==='string'?data.reference.trim():'';
 if(!reference||reference.length>100)fail('Dispatch reference required (max 100)',400);
 if(typeof actor!=='string'||!actor.trim()||actor.length>200)fail('Authenticated actor required',403);
 await inventoryLock(c,tenant);
 const row=(await c.query('SELECT * FROM sajada.sales_order WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,id])).rows[0];
 if(!row)fail('Order not found',404);
 if(row.dispatched_at){if(row.dispatch_reference!==reference)fail('Dispatch reference conflicts');return {...row,replayed:true};}
 if(row.status!=='paid')fail('Only paid orders can be dispatched');
 if(!row.inventory_location_id)fail('Legacy order requires manual reconciliation');
 const items=(await c.query('SELECT product_id,quantity FROM sajada.order_item WHERE tenant_id=$1 AND order_id=$2 ORDER BY line_no',[tenant,id])).rows;
 const w=await readInventory(c,tenant),docs=w.documents.filter(d=>d.kind==='reserve'&&d.reference===id),expected=new Map(),found=new Map();
 if(!items.length)fail('Order has no items');
 for(const item of items)expected.set(item.product_id,(expected.get(item.product_id)||0)+Number(item.quantity));
 for(const d of docs){if(d.locationId!==row.inventory_location_id||d.status!=='reserved')fail('Reservation already processed or location mismatch');found.set(d.productId,(found.get(d.productId)||0)+d.quantity);}
 if(found.size!==expected.size||[...expected].some(([product,qty])=>found.get(product)!==qty))fail('Order reservation history incomplete');
 for(const d of docs)await inventoryAction(c,tenant,{id:randomUUID(),kind:'ship',sourceId:d.id,reference},actor);
 const result=(await c.query('UPDATE sajada.sales_order SET dispatched_at=now(),dispatched_by=$3,dispatch_reference=$4 WHERE tenant_id=$1 AND id=$2 RETURNING *',[tenant,id,actor,reference])).rows[0];
 await c.query("INSERT INTO sajada.outbox(tenant_id,aggregate_id,event_type,schema_version,payload) VALUES($1,$2,'order.dispatched',1,$3)",[tenant,id,JSON.stringify({order_id:id,reference,actor,location_id:row.inventory_location_id,items})]);
 return result;
}
