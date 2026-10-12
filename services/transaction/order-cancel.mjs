import {randomUUID} from 'node:crypto';
import {inventoryLock,inventoryEnabled,readInventory,inventoryAction} from './inventory-service.mjs';
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status});};
export async function cancelOrder(c,tenant,id,data,actor){
 const reason=typeof data.reason==='string'?data.reason.trim():'';
 if(!reason||reason.length>200)fail('Cancellation reason required (max 200)',400);
 if(typeof actor!=='string'||!actor.trim()||actor.length>200)fail('Authenticated actor required',403);
 await inventoryLock(c,tenant);
 const row=(await c.query('SELECT * FROM sajada.sales_order WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,id])).rows[0];
 if(!row)fail('Order not found',404);
 if(row.status==='cancelled'){if(row.cancel_reason!==reason)fail('Cancellation reason conflicts');return {...row,replayed:true};}
 if(row.status!=='pending')fail('Only unpaid pending orders can be cancelled');
 const items=(await c.query('SELECT product_id,quantity FROM sajada.order_item WHERE tenant_id=$1 AND order_id=$2 ORDER BY line_no',[tenant,id])).rows;
 if(!items.length)fail('Order has no items');
 if(row.inventory_location_id){
  const state=await readInventory(c,tenant),docs=state.documents.filter(d=>d.kind==='reserve'&&d.reference===id);
  const sums=new Map();for(const item of items)sums.set(item.product_id,(sums.get(item.product_id)||0)+Number(item.quantity));
  const found=new Map();for(const d of docs){if(d.locationId!==row.inventory_location_id||!['reserved','cancelled'].includes(d.status))fail('Order already shipped or reservation mismatch');found.set(d.productId,(found.get(d.productId)||0)+d.quantity);}
  if(found.size!==sums.size||[...sums].some(([product,qty])=>found.get(product)!==qty))fail('Order reservation history incomplete');
  for(const d of docs)if(d.status==='reserved')await inventoryAction(c,tenant,{id:randomUUID(),kind:'release',sourceId:d.id,reference:'Cancel '+id},actor);
 }else{
  if(await inventoryEnabled(c,tenant))fail('Legacy order needs manual reconciliation after inventory activation');
  for(const item of items)await c.query('UPDATE sajada.product SET stock=stock+$3 WHERE tenant_id=$1 AND id=$2',[tenant,item.product_id,item.quantity]);
 }
 const result=(await c.query("UPDATE sajada.sales_order SET status='cancelled',cancelled_at=now(),cancelled_by=$3,cancel_reason=$4 WHERE tenant_id=$1 AND id=$2 RETURNING *",[tenant,id,actor,reason])).rows[0];
 await c.query("INSERT INTO sajada.outbox(tenant_id,aggregate_id,event_type,schema_version,payload) VALUES($1,$2,'order.cancelled',1,$3)",[tenant,id,JSON.stringify({order_id:id,reason,actor})]);
 return result;
}
