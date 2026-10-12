import {syncReplenishment} from './replenishment-service.mjs';
import {randomUUID} from 'node:crypto';
import {emptyWarehouses,addLocation,applyStock} from './inventory-domain.mjs';
function fail(status,message){throw Object.assign(Error(message),{status});}
function uuid(v){if(typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))fail(400,'Valid UUID required');return v.toLowerCase();}
function actor(v){if(typeof v!=='string'||!v.trim()||v.length>200)fail(403,'Authenticated actor required');return v;}
export async function inventoryLock(c,tenant){await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[tenant+':inventory']);}
export async function inventoryEnabled(c,tenant){return !!(await c.query('SELECT tenant_id FROM sajada.inventory_config WHERE tenant_id=$1',[tenant])).rows[0];}
export async function readInventory(c,tenant){
 const s=emptyWarehouses();
 s.locations=(await c.query('SELECT id,name,kind,parent_id AS "parentId",region_id AS "regionId",member_id AS "memberId" FROM sajada.inventory_location WHERE tenant_id=$1 ORDER BY created_at,id',[tenant])).rows;
 s.balances=(await c.query('SELECT location_id AS "locationId",product_id AS "productId",on_hand AS "onHand",reserved,minimum FROM sajada.inventory_balance WHERE tenant_id=$1',[tenant])).rows.map(b=>({...b,onHand:Number(b.onHand),reserved:Number(b.reserved),minimum:Number(b.minimum)}));
 const docs=(await c.query('SELECT data,request_payload FROM sajada.inventory_document WHERE tenant_id=$1 ORDER BY (data->>\'at\')::timestamptz,id',[tenant])).rows;s.documents=docs.map(d=>d.data);s.requests=docs.map(d=>({id:d.data.id,payload:d.request_payload}));
 s.movements=(await c.query('SELECT id,document_id AS "documentId",location_id AS "locationId",product_id AS "productId",physical_delta AS physical,reserved_delta AS reserved,after_physical AS after,after_reserved AS "reservedAfter",actor,occurred_at AS at FROM sajada.inventory_movement WHERE tenant_id=$1 ORDER BY occurred_at,id',[tenant])).rows.map(m=>({...m,physical:Number(m.physical),reserved:Number(m.reserved),after:Number(m.after),reservedAfter:Number(m.reservedAfter),at:new Date(m.at).toISOString()}));
 return s;
}
export async function createInventoryLocation(c,tenant,data,sub){
 actor(sub);await inventoryLock(c,tenant);const location={id:uuid(data.id),name:data.name,kind:data.kind,parentId:data.parentId?uuid(data.parentId):null,regionId:data.regionId,memberId:data.memberId?uuid(data.memberId):null};
 const state=await readInventory(c,tenant);const existing=state.locations.find(l=>l.id===location.id);if(existing){if(JSON.stringify(existing)!==JSON.stringify(location))fail(409,'Location ID reused with different data');return existing;}
 try{addLocation(state,location);}catch(e){fail(400,e.message);}
 const region=(await c.query('SELECT * FROM sajada.region WHERE id=$1',[location.regionId])).rows[0];if(!region||region.kind!==(location.kind==='member'?'village':location.kind))fail(400,'Region kind does not match location');
 if(location.parentId){const parent=state.locations.find(l=>l.id===location.parentId);if(region.parent_id!==parent.regionId)fail(400,'Region must be under parent depot region');}
 if(location.memberId){const member=(await c.query('SELECT region_id,status FROM sajada.member WHERE tenant_id=$1 AND id=$2',[tenant,location.memberId])).rows[0];if(!member||member.status!=='active'||member.region_id!==location.regionId)fail(400,'Active member must belong to location village');}
 return (await c.query('INSERT INTO sajada.inventory_location(tenant_id,id,name,kind,parent_id,region_id,member_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,name,kind,parent_id AS "parentId",region_id AS "regionId",member_id AS "memberId"',[tenant,location.id,location.name,location.kind,location.parentId,location.regionId,location.memberId,sub])).rows[0];
}
async function persistAction(c,tenant,before,next,id){
 for(const b of next.balances){const old=before.balances.find(o=>o.locationId===b.locationId&&o.productId===b.productId);if(JSON.stringify(old)===JSON.stringify(b))continue;
 await c.query('INSERT INTO sajada.inventory_balance(tenant_id,location_id,product_id,on_hand,reserved,minimum) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,location_id,product_id) DO UPDATE SET on_hand=excluded.on_hand,reserved=excluded.reserved,minimum=excluded.minimum',[tenant,b.locationId,b.productId,b.onHand,b.reserved,b.minimum]);}
 for(const d of next.documents){const old=before.documents.find(o=>o.id===d.id);if(JSON.stringify(old)===JSON.stringify(d))continue;
 if(old)await c.query('UPDATE sajada.inventory_document SET data=$3 WHERE tenant_id=$1 AND id=$2',[tenant,d.id,JSON.stringify(d)]);
 else await c.query('INSERT INTO sajada.inventory_document(tenant_id,id,location_id,product_id,data,request_payload) VALUES($1,$2,$3,$4,$5,$6)',[tenant,d.id,d.locationId,d.productId,JSON.stringify(d),next.requests.find(r=>r.id===d.id).payload]);}
 for(const m of next.movements.slice(before.movements.length))await c.query('INSERT INTO sajada.inventory_movement(tenant_id,id,document_id,location_id,product_id,physical_delta,reserved_delta,after_physical,after_reserved,actor,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[tenant,m.id,m.documentId,m.locationId,m.productId,m.physical,m.reserved,m.after,m.reservedAfter,m.actor,m.at]);
 const doc=next.documents.find(d=>d.id===id);await c.query("INSERT INTO sajada.outbox(tenant_id,aggregate_id,event_type,schema_version,payload) VALUES($1,$2,'inventory.movement.recorded',1,$3)",[tenant,id,JSON.stringify(doc)]);return doc;
}
export async function inventoryAction(c,tenant,data,sub,{opening=false,skipReplenishment=false,at=new Date().toISOString()}={}){
 actor(sub);await inventoryLock(c,tenant);if(!opening&&!await inventoryEnabled(c,tenant))fail(409,'Activate location inventory first');
 const a={id:uuid(data.id),kind:data.kind,reference:data.reference};for(const k of ['locationId','toId','productId','sourceId'])if(data[k]!=null)a[k]=uuid(data[k]);if(data.quantity!=null)a.quantity=data.quantity;
 const before=await readInventory(c,tenant);if(a.productId&&!(await c.query('SELECT id FROM sajada.product WHERE tenant_id=$1 AND id=$2',[tenant,a.productId])).rows[0])fail(404,'Tenant product not found');
 let next;try{next=applyStock(before,a,sub,at);}catch(e){fail(409,e.message);}
 if(next===before)return before.documents.find(d=>d.id===a.id);
 const doc=await persistAction(c,tenant,before,next,a.id);if(!opening&&!skipReplenishment)await syncReplenishment(c,tenant,sub);return doc;
}
export async function activateInventory(c,tenant,data,sub){
 actor(sub);await inventoryLock(c,tenant);const id=uuid(data.locationId);const previous=(await c.query('SELECT opening_location_id FROM sajada.inventory_config WHERE tenant_id=$1',[tenant])).rows[0];if(previous){if(previous.opening_location_id!==id)fail(409,'Inventory already activated elsewhere');return {enabled:true,locationId:id,replayed:true};}
 const loc=(await c.query("SELECT id FROM sajada.inventory_location WHERE tenant_id=$1 AND id=$2 AND kind='province'",[tenant,id])).rows[0];if(!loc)fail(404,'Opening province depot not found');
 const products=(await c.query('SELECT id,stock FROM sajada.product WHERE tenant_id=$1 ORDER BY id FOR UPDATE',[tenant])).rows;
 for(const p of products){const q=Number(p.stock);if(!Number.isSafeInteger(q)||q<0||q>1e9)fail(409,'Opening stock must be whole units <= 1 billion');if(q>0)await inventoryAction(c,tenant,{id:randomUUID(),kind:'receive',locationId:id,productId:p.id,quantity:q,reference:'Opening legacy stock migration'},sub,{opening:true});}
 await c.query('INSERT INTO sajada.inventory_config(tenant_id,opening_location_id,activated_by) VALUES($1,$2,$3)',[tenant,id,sub]);return {enabled:true,locationId:id,replayed:false};
}
