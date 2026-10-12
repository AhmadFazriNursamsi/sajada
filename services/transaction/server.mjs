import {walletSummary,activateWallet,payWalletOrder,refundWalletOrder} from './capital-wallet-service.mjs';
import {supplierPerformance} from './supplier-performance-domain.mjs';
import {poDelivery} from './po-delivery-domain.mjs';
import {poExpectedOn} from './replenishment-domain.mjs';
import {poDocument} from './po-document-domain.mjs';
import {listPayables,createPayable,payPayable,accountingReport,payableAging,payableStatement} from './payables-service.mjs';
import {readReplenishment,saveReplacementReversal,saveReplacement,saveInspection,saveConfirmation,saveSupplier,savePolicy,purchaseAction,syncReplenishment} from './replenishment-service.mjs';
import {restockPlan,inventoryPeriod} from './inventory-reports-domain.mjs';
import {receiveOrder} from './order-receipt.mjs';
import {dispatchOrder} from './order-dispatch.mjs';
import {cancelOrder} from './order-cancel.mjs';
import {randomUUID} from 'node:crypto';
import {inventoryLock,inventoryEnabled,readInventory,createInventoryLocation,inventoryAction,activateInventory} from './inventory-service.mjs';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {createInvestor,openCapital,draftProfit,settleProfit,cancelProfit,approveProfit} from './profit-service.mjs';
import {validateOrder,idempotency,tenantClaim} from './domain.mjs';
export function createHandler({pool,jwksUrl,issuer,audience,logger=console}){
const jwks=createRemoteJWKSet(new URL(jwksUrl));
function send(res,status,data){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let text='';for await(const c of req){text+=c;if(text.length>65536)throw Error('Request body too large');}return JSON.parse(text||'{}');}
async function tx(tenant,fn){const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
return async(req,res)=>{
 try{
  if(req.url==='/healthz')return send(res,200,{status:'ok',service:'sajada-transactions'});
  const token=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_.-]+)$/i)?.[1];if(!token)return send(res,401,{error:'Authentication required'});
  let claims;try{claims=(await jwtVerify(token,jwks,{issuer,audience,algorithms:['RS256']})).payload;}catch{return send(res,401,{error:'Invalid access token'});}
  let tenant;try{tenant=tenantClaim(claims,req.headers['x-tenant-id']);}catch{return send(res,403,{error:'Tenant access denied'});}
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&path==='/v1/products')return send(res,200,await tx(tenant,async c=>(await c.query('SELECT p.id,p.sku,p.name,p.currency,p.unit_price,CASE WHEN EXISTS(SELECT 1 FROM sajada.inventory_config cfg WHERE cfg.tenant_id=p.tenant_id) THEN coalesce((SELECT sum(b.on_hand-b.reserved) FROM sajada.inventory_balance b WHERE b.tenant_id=p.tenant_id AND b.product_id=p.id),0) ELSE p.stock END AS stock FROM sajada.product p WHERE p.tenant_id=$1 ORDER BY name',[tenant])).rows));
  if(!Array.isArray(claims.roles)||!claims.roles.some(r=>['tenant_admin','accountant'].includes(r)))return send(res,403,{error:'Staff role required'});
  if(req.method==='GET'&&path==='/v1/payables/statement'){const q=new URL(req.url,'http://localhost').searchParams;return send(res,200,await tx(tenant,c=>payableStatement(c,tenant,q.get('start')||'',q.get('end')||'',q.get('supplier')||'')));}
  if(req.method==='GET'&&path==='/v1/payables/aging'){const q=new URL(req.url,'http://localhost').searchParams;return send(res,200,await tx(tenant,c=>payableAging(c,tenant,q.get('as_of')||'',{supplier:q.get('supplier')||undefined,bucket:q.get('bucket')||undefined})));}
  if(req.method==='GET'&&path==='/v1/payables')return send(res,200,await tx(tenant,c=>listPayables(c,tenant)));
  if(req.method==='GET'&&path==='/v1/accounting/trial-balance')return send(res,200,await tx(tenant,c=>accountingReport(c,tenant)));
  if(req.method==='POST'&&path==='/v1/payables'){const data=await body(req);return send(res,200,await tx(tenant,c=>createPayable(c,tenant,data,claims.sub)));}
  const payableRoute=path.match(/^\/v1\/payables\/([0-9a-f-]{36})\/payments$/i);
  if(req.method==='POST'&&payableRoute){if(!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});const data=await body(req);return send(res,200,await tx(tenant,c=>payPayable(c,tenant,payableRoute[1],data,claims.sub)));}
  const reversalRoute=path.match(/^\/v1\/purchasing\/replacements\/([0-9a-f-]{36})\/reversals$/i);
  if(req.method==='POST'&&reversalRoute){if(!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});const data=await body(req);return send(res,200,await tx(tenant,c=>saveReplacementReversal(c,tenant,reversalRoute[1],data,claims.sub)));}
  const replacementRoute=path.match(/^\/v1\/purchasing\/inspections\/([0-9a-f-]{36})\/replacements$/i);
  if(req.method==='POST'&&replacementRoute){const data=await body(req);return send(res,200,await tx(tenant,c=>saveReplacement(c,tenant,replacementRoute[1],data,claims.sub)));}
  const inspectionRoute=path.match(/^\/v1\/purchasing\/([0-9a-f-]{36})\/inspections$/i);
  if(req.method==='POST'&&inspectionRoute){const data=await body(req);return send(res,200,await tx(tenant,c=>saveInspection(c,tenant,inspectionRoute[1],data,claims.sub)));}
  const confirmationRoute=path.match(/^\/v1\/purchasing\/([0-9a-f-]{36})\/confirmations$/i);
  if(req.method==='POST'&&confirmationRoute){if(!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});const data=await body(req);return send(res,200,await tx(tenant,c=>saveConfirmation(c,tenant,confirmationRoute[1],data,claims.sub)));}
  const poDocumentRoute=path.match(/^\/v1\/purchasing\/([0-9a-f-]{36})\/document$/i);
  if(req.method==='GET'&&poDocumentRoute){const html=await tx(tenant,async c=>{await inventoryLock(c,tenant);const s=await readReplenishment(c,tenant),o=s.orders.find(o=>o.id===poDocumentRoute[1].toLowerCase());if(!o)throw Object.assign(Error('PO not found'),{status:404});const w=await readInventory(c,tenant),l=w.locations.find(l=>l.id===o.locationId);if(!l)throw Object.assign(Error('PO location not found'),{status:409});return poDocument(o,s.receipts,{tenant:'Tenant '+tenant,locationId:l.id,locationName:l.name,regionId:l.regionId},s.confirmations,s.inspections,s.replacements,s.replacementReversals);});res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-disposition':'attachment; filename="sajada-po-'+poDocumentRoute[1].toLowerCase()+'.html"'});return res.end(html);}
  if(req.method==='POST'&&path==='/v1/purchasing/suppliers'){if(!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});const data=await body(req);return send(res,200,await tx(tenant,c=>saveSupplier(c,tenant,data,claims.sub)));}
  if(req.method==='GET'&&path==='/v1/purchasing/supplier-performance'){const q=new URL(req.url,'http://localhost').searchParams;return send(res,200,await tx(tenant,async c=>{await inventoryLock(c,tenant);const s=await readReplenishment(c,tenant),locationId=q.get('location_id')||undefined;if(locationId&&!(await readInventory(c,tenant)).locations.some(l=>l.id===locationId))throw Object.assign(Error('Location not found within tenant'),{status:404});try{if((q.get('end')||'')>poExpectedOn(new Date().toISOString(),0))throw Error('End date cannot be in the future');return supplierPerformance(s.orders,s.receipts,s.confirmations,q.get('start')||'',q.get('end')||'',{locationId,supplierKey:q.get('supplier_key')||undefined});}catch(e){throw Object.assign(e,{status:400});}}));}
  if(req.method==='GET'&&path==='/v1/purchasing/delivery-monitor'){const q=new URL(req.url,'http://localhost').searchParams;return send(res,200,await tx(tenant,async c=>{await inventoryLock(c,tenant);const s=await readReplenishment(c,tenant),locationId=q.get('location_id')||undefined;if(locationId&&!(await readInventory(c,tenant)).locations.some(l=>l.id===locationId))throw Object.assign(Error('Location not found within tenant'),{status:404});try{return poDelivery(s.orders,q.get('reference_date')??poExpectedOn(new Date().toISOString(),0),{locationId,supplier:q.get('supplier')||undefined,bucket:q.get('bucket')||undefined},s.confirmations);}catch(e){throw Object.assign(e,{status:400});}}));}
  if(req.method==='GET'&&path==='/v1/purchasing')return send(res,200,await tx(tenant,async c=>{await inventoryLock(c,tenant);return readReplenishment(c,tenant);}));
  if(req.method==='POST'&&path==='/v1/purchasing/policies'){if(!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});const data=await body(req);return send(res,200,await tx(tenant,c=>savePolicy(c,tenant,data,claims.sub)));}
  if(req.method==='POST'&&path==='/v1/purchasing/evaluate'){if(!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});return send(res,200,await tx(tenant,c=>syncReplenishment(c,tenant,claims.sub)));}
  const poRoute=path.match(/^\/v1\/purchasing\/([0-9a-f-]{36})\/(approve|cancel|receive)$/i);
  if(req.method==='POST'&&poRoute){if(poRoute[2]!=='receive'&&!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});const data=await body(req);return send(res,200,await tx(tenant,c=>purchaseAction(c,tenant,poRoute[1],poRoute[2],data,claims.sub)));}
  if(req.method==='GET'&&['/v1/inventory/restock','/v1/inventory/report'].includes(path)){
   const q=new URL(req.url,'http://localhost').searchParams,scope={locationId:q.get('location_id')||undefined,productId:q.get('product_id')||undefined,includeChildren:q.get('include_children')==='true'};
   if(q.has('include_children')&&!['true','false'].includes(q.get('include_children')))return send(res,400,{error:'include_children must be true or false'});
   if(q.has('buffer')&&!/^\d+$/.test(q.get('buffer')))return send(res,400,{error:'buffer must be whole units'});
   const result=await tx(tenant,async c=>{await inventoryLock(c,tenant);if(!await inventoryEnabled(c,tenant))throw Object.assign(Error('Activate inventory before reporting'),{status:409});const w=await readInventory(c,tenant),products=(await c.query('SELECT id,name,sku FROM sajada.product WHERE tenant_id=$1 ORDER BY id',[tenant])).rows;return path==='/v1/inventory/restock'?{buffer:Number(q.get('buffer')??5),rows:restockPlan(w,products,Number(q.get('buffer')??5),scope,(await readReplenishment(c,tenant)).orders)}:{start:q.get('start'),end:q.get('end'),timezone:'Asia/Jakarta',rows:inventoryPeriod(w,products,q.get('start')||'',q.get('end')||'',scope)};});return send(res,200,result);
  }
  if(req.method==='GET'&&path==='/v1/inventory')return send(res,200,await tx(tenant,async c=>{await inventoryLock(c,tenant);return {enabled:await inventoryEnabled(c,tenant),...await readInventory(c,tenant)};}));
  if(req.method==='POST'&&path==='/v1/inventory/locations'){if(!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});const data=await body(req);return send(res,200,await tx(tenant,c=>createInventoryLocation(c,tenant,data,claims.sub)));}
  if(req.method==='POST'&&path==='/v1/inventory/activate'){if(!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});const data=await body(req);return send(res,200,await tx(tenant,c=>activateInventory(c,tenant,data,claims.sub)));}
  if(req.method==='POST'&&path==='/v1/inventory/actions'){const data=await body(req);if(['count','minimum'].includes(data.kind)&&!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});return send(res,200,await tx(tenant,c=>inventoryAction(c,tenant,data,claims.sub)));}
  if(req.method==='GET'&&path==='/v1/investors')return send(res,200,await tx(tenant,async c=>(await c.query('SELECT id,name FROM sajada.investor WHERE tenant_id=$1 ORDER BY name',[tenant])).rows));
  if(req.method==='POST'&&path==='/v1/investors'){if(!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});const data=await body(req);return send(res,200,await tx(tenant,c=>createInvestor(c,tenant,data,claims.sub)));}
  const walletRoute=path.match(/^\/v1\/members\/([0-9a-f-]{36})\/capital-wallet(?:\/(activate))?$/i);
  if(walletRoute&&req.method==='GET'&&!walletRoute[2])return send(res,200,await tx(tenant,c=>walletSummary(c,tenant,walletRoute[1])));
  if(walletRoute&&req.method==='POST'&&walletRoute[2]){if(!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});const data=await body(req);return send(res,200,await tx(tenant,c=>activateWallet(c,tenant,walletRoute[1],data,claims.sub)));}
  const walletRefundRoute=path.match(/^\/v1\/orders\/([0-9a-f-]{36})\/capital-wallet-refunds$/i);
  if(walletRefundRoute&&req.method==='POST'){if(!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});const data=await body(req);return send(res,200,await tx(tenant,c=>refundWalletOrder(c,tenant,walletRefundRoute[1],data,claims.sub)));}
  const walletPayRoute=path.match(/^\/v1\/orders\/([0-9a-f-]{36})\/capital-wallet-payments$/i);
  if(walletPayRoute&&req.method==='POST'){if(!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});const data=await body(req);return send(res,200,await tx(tenant,c=>payWalletOrder(c,tenant,walletPayRoute[1],data,claims.sub)));}
  const capitalRoute=path.match(/^\/v1\/members\/([0-9a-f-]{36})\/capital$/i);
  if(capitalRoute&&req.method==='GET'){const row=await tx(tenant,async c=>(await c.query('SELECT * FROM sajada.capital_account WHERE tenant_id=$1 AND member_id=$2',[tenant,capitalRoute[1]])).rows[0]);return send(res,row?200:404,row||{error:'Capital account not found'});}
  if(capitalRoute&&req.method==='POST'){if(!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});const data=await body(req);return send(res,200,await tx(tenant,c=>openCapital(c,tenant,capitalRoute[1],data,claims.sub)));}
  if(req.method==='POST'&&path==='/v1/profit-reports'){const data=await body(req);return send(res,201,await tx(tenant,c=>draftProfit(c,tenant,data,req.headers['idempotency-key'],claims.sub)));}
  if(req.method==='GET'&&path==='/v1/profit-reports')return send(res,200,await tx(tenant,async c=>(await c.query('SELECT * FROM sajada.profit_report WHERE tenant_id=$1 ORDER BY created_at DESC,id LIMIT 100',[tenant])).rows));
  const approveRoute=path.match(/^\/v1\/profit-reports\/([0-9a-f-]{36})\/approve$/i);
  if(approveRoute&&req.method==='POST'){if(!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});const data=await body(req);return send(res,200,await tx(tenant,c=>approveProfit(c,tenant,approveRoute[1],data,claims.sub)));}
  const cancelRoute=path.match(/^\/v1\/profit-reports\/([0-9a-f-]{36})\/cancel$/i);
  if(cancelRoute&&req.method==='POST'){if(!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});const data=await body(req);return send(res,200,await tx(tenant,c=>cancelProfit(c,tenant,cancelRoute[1],data,claims.sub)));}
  const settlementRoute=path.match(/^\/v1\/profit-reports\/([0-9a-f-]{36})\/settle$/i);
  if(settlementRoute&&req.method==='POST'){const data=await body(req);return send(res,200,await tx(tenant,c=>settleProfit(c,tenant,settlementRoute[1],data,claims.sub)));}
  if(req.method==='GET'&&path==='/v1/members')return send(res,200,await tx(tenant,async c=>(await c.query('SELECT m.id,m.name,m.status,m.region_id,n.number,n.issued_at FROM sajada.member m LEFT JOIN sajada.member_number n ON n.tenant_id=m.tenant_id AND n.member_id=m.id WHERE m.tenant_id=$1 ORDER BY m.created_at,m.id LIMIT 100',[tenant])).rows));
  const numberRoute=path.match(/^\/v1\/members\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/number$/i);
  if(numberRoute&&req.method==='GET'){const row=await tx(tenant,async c=>(await c.query('SELECT number,issue_year,sequence_no,province_code,regency_code,district_code,issued_at FROM sajada.member_number WHERE tenant_id=$1 AND member_id=$2',[tenant,numberRoute[1]])).rows[0]);return send(res,row?200:404,row||{error:'Number not issued'});}
  if(numberRoute&&req.method==='POST'){
   if(!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});
   if(typeof claims.sub!=='string'||!claims.sub.trim())return send(res,403,{error:'Authenticated actor required'});
   const result=await tx(tenant,async c=>(await c.query('SELECT * FROM sajada.issue_member_number($1::uuid,$2::uuid,$3::text)',[tenant,numberRoute[1],claims.sub])).rows[0]);
   return send(res,200,result);
  }
  if(req.method==='GET'&&path==='/v1/orders')return send(res,200,await tx(tenant,async c=>(await c.query('SELECT id,total,currency,status,created_at,cancelled_at,cancelled_by,cancel_reason,inventory_location_id,dispatched_at,dispatched_by,dispatch_reference,received_at,received_by,receipt_reference,receiver_name FROM sajada.sales_order WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',[tenant])).rows));
  if(req.method==='POST'&&path==='/v1/orders'){
   const data=await body(req),items=validateOrder(data),key=idempotency(req.headers['idempotency-key']);
   const fingerprint=createHash('sha256').update(JSON.stringify({member_id:data.member_id,items:items.map(i=>({product_id:i.product_id,quantity:i.quantity})),...(data.location_id?{location_id:data.location_id}:{})})).digest('hex');
   const result=await tx(tenant,async c=>{
    await inventoryLock(c,tenant);const locationMode=await inventoryEnabled(c,tenant);
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[tenant+':'+key]);
    const prior=await c.query('SELECT id,total,currency,status,request_hash FROM sajada.sales_order WHERE tenant_id=$1 AND idempotency_key=$2',[tenant,key]);
    if(prior.rowCount){if(prior.rows[0].request_hash!==fingerprint)throw Error('Idempotency key reused with different request');return prior.rows[0];}
    if(locationMode&&!data.location_id)throw Object.assign(Error('Choose inventory location_id'),{status:409});if(!locationMode&&data.location_id)throw Object.assign(Error('Activate inventory before using a location'),{status:409});
    const member=await c.query('SELECT id FROM sajada.member WHERE tenant_id=$1 AND id=$2 AND status=$3',[tenant,data.member_id,'active']);if(!member.rowCount)throw Error('Active tenant member required');
    const o=await c.query("INSERT INTO sajada.sales_order(tenant_id,member_id,currency,base_currency,fx_rate,total,total_base,status,idempotency_key,request_hash) VALUES($1,$2,'IDR','IDR',1,0,0,'pending',$3,$4) RETURNING id",[tenant,data.member_id,key,fingerprint]);const id=o.rows[0].id;
    for(const [index,item]of items.entries()){
     const p=await c.query('SELECT unit_price,currency,stock FROM sajada.product WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,item.product_id]);
     if(!p.rowCount||p.rows[0].currency!=='IDR'||(!locationMode&&Number(p.rows[0].stock)<item.quantity))throw Error('Product unavailable, insufficient stock or unsupported currency');
     if(locationMode)await inventoryAction(c,tenant,{id:randomUUID(),kind:'reserve',locationId:data.location_id,productId:item.product_id,quantity:item.quantity,reference:id},claims.sub);else await c.query('UPDATE sajada.product SET stock=stock-$3 WHERE tenant_id=$1 AND id=$2',[tenant,item.product_id,item.quantity]);
     await c.query('INSERT INTO sajada.order_item(tenant_id,order_id,line_no,product_id,quantity,unit_price) VALUES($1,$2,$3,$4,$5,$6)',[tenant,id,index+1,item.product_id,item.quantity,p.rows[0].unit_price]);
    }
    if(locationMode)await c.query('UPDATE sajada.sales_order SET inventory_location_id=$3 WHERE tenant_id=$1 AND id=$2',[tenant,id,data.location_id]);
    const updated=await c.query('UPDATE sajada.sales_order SET total=(SELECT sum(quantity*unit_price) FROM sajada.order_item WHERE tenant_id=$1 AND order_id=$2), total_base=(SELECT sum(quantity*unit_price) FROM sajada.order_item WHERE tenant_id=$1 AND order_id=$2) WHERE tenant_id=$1 AND id=$2 RETURNING id,total,currency,status',[tenant,id]);
    await c.query("INSERT INTO sajada.outbox(tenant_id,aggregate_id,event_type,schema_version,payload) VALUES($1,$2,'order.created',1,$3)",[tenant,id,JSON.stringify(updated.rows[0])]);return updated.rows[0];
   });return send(res,201,result);
  }
  const receiptRoute=path.match(/^\/v1\/orders\/([0-9a-f-]{36})\/receive$/i);
  if(req.method==='POST'&&receiptRoute){const data=await body(req);return send(res,200,await tx(tenant,c=>receiveOrder(c,tenant,receiptRoute[1],data,claims.sub)));}
  const dispatchRoute=path.match(/^\/v1\/orders\/([0-9a-f-]{36})\/dispatch$/i);
  if(req.method==='POST'&&dispatchRoute){const data=await body(req);return send(res,200,await tx(tenant,c=>dispatchOrder(c,tenant,dispatchRoute[1],data,claims.sub)));}
  const cancelOrderRoute=path.match(/^\/v1\/orders\/([0-9a-f-]{36})\/cancel$/i);
  if(req.method==='POST'&&cancelOrderRoute){if(!claims.roles.includes('tenant_admin'))return send(res,403,{error:'Tenant administrator required'});const data=await body(req);return send(res,200,await tx(tenant,c=>cancelOrder(c,tenant,cancelOrderRoute[1],data,claims.sub)));}
  const pay=path.match(/^\/v1\/orders\/([0-9a-f-]{36})\/payments$/i);
  if(req.method==='POST'&&pay){
   const key=idempotency(req.headers['idempotency-key']);
   const result=await tx(tenant,async c=>{
    const row=await c.query('SELECT * FROM sajada.sales_order WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,pay[1]]);if(!row.rowCount)throw Error('Order not found');const order=row.rows[0];
    if((await c.query('SELECT 1 FROM sajada.capital_wallet_payment WHERE tenant_id=$1 AND order_id=$2',[tenant,order.id])).rows.length)throw Object.assign(Error('Order already paid with capital wallet'),{status:409});
    if(order.status==='paid')return {id:order.id,status:'paid',replayed:true};
    if(order.status!=='pending')throw Error('Order cannot be paid');
    // Manual staff-recorded full receipt. Production requires settlement reconciliation.
    const journal=await c.query("INSERT INTO sajada.journal(tenant_id,reference,effective_date,status) VALUES($1,$2,current_date,'draft') RETURNING id",[tenant,'PAY-'+order.id]);
    const jid=journal.rows[0].id;
    // Cash receipt against customer advance, not prematurely recognized revenue.
    await c.query("INSERT INTO sajada.journal_line(tenant_id,journal_id,line_no,account_code,debit_base,credit_base) VALUES($1,$2,1,'1100', $3,0),($1,$2,2,'2200',0,$3)",[tenant,jid,order.total_base]);
    await c.query("UPDATE sajada.journal SET status='posted' WHERE tenant_id=$1 AND id=$2",[tenant,jid]);
    await c.query("UPDATE sajada.sales_order SET status='paid' WHERE tenant_id=$1 AND id=$2",[tenant,order.id]);
    await c.query("INSERT INTO sajada.outbox(tenant_id,aggregate_id,event_type,schema_version,payload) VALUES($1,$2,'payment.recorded',1,$3)",[tenant,order.id,JSON.stringify({order_id:order.id,amount:order.total_base,currency:order.base_currency,member_id:order.member_id,idempotency_key:key})]);
    return {id:order.id,status:'paid',journal_id:jid};
   });return send(res,200,result);
  }
  return send(res,404,{error:'Route not found'});
 }catch(e){logger.error(e.message);if([400,403,404,409].includes(e.status))return send(res,e.status,{error:e.message});if(e.code==='P0002')return send(res,404,{error:'Member not found'});if(e.code==='42501')return send(res,403,{error:'Database scope or privilege denied'});if(['23505','23514','55000'].includes(e.code))return send(res,409,{error:'Record conflict, exhausted sequence, or immutable record'});return send(res,400,{error:'Request could not be processed. Check input, stock, membership and idempotency key.'});}
 };
}
export function createApi(options){return http.createServer(createHandler(options));}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 for(const key of ['DATABASE_URL','OIDC_JWKS_URL','OIDC_ISSUER','OIDC_AUDIENCE'])if(!process.env[key])throw Error(`${key} required`);
 const {default:pg}=await import('pg');
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:10});
 createApi({pool,jwksUrl:process.env.OIDC_JWKS_URL,issuer:process.env.OIDC_ISSUER,audience:process.env.OIDC_AUDIENCE}).listen(Number(process.env.PORT||8080),'0.0.0.0');
}

