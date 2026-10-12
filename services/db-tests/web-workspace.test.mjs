import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readMain,saveMain} from '../../lib/server/workspace/main.ts';
import {validateWorkspace} from '../../lib/server/workspace/index.ts';
import {UserError} from '../../lib/server/db.ts';
import {tenantPeople,initialProducts} from '../../shared/demo-data.ts';
import {addLocation,applyStock,emptyWarehouses,totalAvailable,available} from '../../shared/warehouses.ts';
import {emptyReplenishment,setSupplier,setReorderPolicy,automaticPO,approvePO,cancelPO} from '../../shared/replenishment.ts';
import {confirmPO} from '../../shared/po-confirmation.ts';
import {inspectPO} from '../../shared/po-inspection.ts';
import {linkReplacement,reverseReplacement,rejectionCases} from '../../shared/po-replacement.ts';
import {consumeStock} from '../../shared/inventory.ts';
import {dispatchBrowserOrder} from '../../shared/order-dispatch.ts';
import {receiveBrowserOrder,RECEIPT_POLICY} from '../../shared/order-receipt.ts';
import {cancelBrowserOrder} from '../../shared/order-cancel.ts';

// Migrations in Docker Compose initialisation order (services/compose.yaml).
const MIGRATIONS=['../../architecture/postgresql.sql','hardening','member-number','profit-sharing','profit-corrections','profit-approval','inventory','order-cancel','order-dispatch','order-receipt','replenishment','payables','suppliers','po-delivery','po-confirmation','po-inspection','po-replacement','po-replacement-reversal','capital-wallet','capital-wallet-refund','web-workspace','web-sections','web-maintenance'].map(f=>f.startsWith('.')?f:`../transaction/${f}.sql`);
const ACTOR='Admin demo';
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
const canon=v=>sorted(JSON.parse(JSON.stringify(v)));

async function setup(){
 const db=new PGlite({extensions:{pgcrypto}});
 for(const f of MIGRATIONS)await db.exec(await readFile(new URL(f,import.meta.url),'utf8'));
 await db.exec(`CREATE ROLE web_test_api NOSUPERUSER NOBYPASSRLS;GRANT USAGE ON SCHEMA sajada TO web_test_api;GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA sajada TO web_test_api;GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA sajada TO web_test_api;`);
 await db.exec('GRANT EXECUTE ON FUNCTION sajada.web_clear_workspace(uuid,text) TO web_test_api');
 // Web-only section tables are rewritten as a whole, so the API role may delete their rows.
 await db.exec(`DO $$DECLARE t text;BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='sajada' AND tablename LIKE 'web\\_%' AND tablename<>'web_order_payment' LOOP EXECUTE format('GRANT DELETE ON sajada.%I TO web_test_api',t);END LOOP;END$$;`);
 return db;
}
async function tx(db,tenant,fn){await db.query('BEGIN');try{await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);const r=await fn(db);await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}}

// Seeds a tenant the way scripts/seed-demo.ts does.
async function seed(db,name){
 const t=randomUUID();await db.query('RESET ROLE');await db.query("INSERT INTO sajada.tenant(id,name) VALUES($1,$2)",[t,name]);await db.query('SET ROLE web_test_api');
 const at=new Date().toISOString(),products=initialProducts.map(p=>({...p,id:randomUUID()})),depot=randomUUID();
 let w=addLocation(emptyWarehouses(),{id:depot,name:'Depot provinsi • '+name,kind:'province',parentId:null,regionId:'Wilayah demo belum dipetakan',memberId:null});
 for(const p of products)w=applyStock(w,{id:randomUUID(),kind:'receive',locationId:depot,productId:p.id,quantity:p.stock,reference:'Migrasi saldo demo sebelumnya'},'Migrasi demo',at);
 const next={orders:[],members:tenantPeople(name).map(m=>[...m]),paid:[],products:products.map(p=>({...p,stock:totalAvailable(w,p.id)})),stockMoves:[],warehouses:w,replenishment:emptyReplenishment()};
 const before=await tx(db,t,c=>readMain(c,t,name));validateWorkspace(name,{'sajada-v2':next});await tx(db,t,c=>saveMain(c,t,before,next));
 return t;
}
// One web save: apply the change the way the UI does, save it, and read it back unchanged.
async function step(db,t,name,label,change){
 const before=await tx(db,t,c=>readMain(c,t,name));
 const next=change(structuredClone(before));
 for(const p of next.products)p.stock=totalAvailable(next.warehouses,p.id);
 validateWorkspace(name,{'sajada-v2':next});
 await tx(db,t,c=>saveMain(c,t,before,next));
 const after=await tx(db,t,c=>readMain(c,t,name));
 assert.deepEqual(canon(after),canon(next),label+': database round trip differs');
 return after;
}
const checkout=(s,name,seller,locationId,picks)=>{
 const sale=consumeStock(s.products.map(p=>({...p,stock:available(s.warehouses,locationId,p.id)})),picks);const id='SJ-'+randomUUID().slice(0,8).toUpperCase();
 for(const item of sale.items)s.warehouses=applyStock(s.warehouses,{id:randomUUID(),kind:'reserve',locationId,productId:item.product_id,quantity:item.quantity,reference:id},ACTOR,new Date().toISOString());
 s.orders=[{id,total:sale.total,tenant:name,date:'2026-10-12',items:sale.items,currency:'IDR',locationId,receiptPolicy:RECEIPT_POLICY,seller,upline:[],policy:'sajada-mlm-v1'},...s.orders];return id;
};

test('web workspace round-trips every core change through the domain tables under RLS',async()=>{
 const db=await setup();try{
 await db.query('SET ROLE web_test_api');
 const name='Sajada Nasional',t=await seed(db,name);
 let s=await tx(db,t,c=>readMain(c,t,name));
 assert.equal(s.members.length,5);assert.equal(s.products.length,4);assert.equal(s.warehouses.movements.length,4);
 const depot=s.warehouses.locations[0].id,[p0,p1,p2]=s.products.map(p=>p.id);

 await step(db,t,name,'add member',s=>{s.members.push(['Uji Anggota','UA','Bandung','Bronze',0]);return s;});
 await step(db,t,name,'region assignment',s=>{s.members=s.members.map(m=>m[0]==='Uji Anggota'?[m[0],m[1],'Bogor',m[3],m[4]]:m);return s;});
 const newProduct=randomUUID();
 await step(db,t,name,'add product with opening stock',s=>{
  s.warehouses=applyStock(s.warehouses,{id:randomUUID(),kind:'receive',locationId:depot,productId:newProduct,quantity:10,reference:'Stok awal produk'},ACTOR,new Date().toISOString());
  s.products.push({id:newProduct,sku:'SJ-099',name:'Produk Uji',category:'Kerajinan',price:5000,emoji:'🧺',bg:'#e6edde',stock:10,active:true});
  s.stockMoves.push({id:randomUUID(),productId:newProduct,productName:'Produk Uji',delta:10,after:10,reference:'Stok awal',date:'12/10/2026'});return s;});
 await step(db,t,name,'edit product',s=>{s.products=s.products.map(p=>p.id===newProduct?{...p,price:6500,active:false}:p);return s;});

 const regency=randomUUID(),district=randomUUID(),memberPlace=randomUUID();
 await step(db,t,name,'add depots and member location',s=>{
  s.warehouses=addLocation(s.warehouses,{id:regency,name:'Depot Kota Bandung',kind:'regency',parentId:depot,regionId:'Kota Bandung',memberId:null});
  s.warehouses=addLocation(s.warehouses,{id:district,name:'Depot Coblong',kind:'district',parentId:regency,regionId:'Coblong',memberId:null});
  s.warehouses=addLocation(s.warehouses,{id:memberPlace,name:'Rumah Siti',kind:'member',parentId:district,regionId:'Dago',memberId:'Siti Rahmawati'});return s;});
 const transfer=randomUUID();
 await step(db,t,name,'stock receive, transfer, count, minimum',s=>{
  const at=new Date().toISOString();
  s.warehouses=applyStock(s.warehouses,{id:randomUUID(),kind:'receive',locationId:district,productId:p0,quantity:7,reference:'Terima pemasok'},ACTOR,at);
  s.warehouses=applyStock(s.warehouses,{id:transfer,kind:'transfer',locationId:depot,toId:regency,productId:p1,quantity:5,reference:'Kirim ke kota'},ACTOR,at);
  s.warehouses=applyStock(s.warehouses,{id:randomUUID(),kind:'count',locationId:district,productId:p0,quantity:6,reference:'Opname'},ACTOR,at);
  s.warehouses=applyStock(s.warehouses,{id:randomUUID(),kind:'minimum',locationId:depot,productId:p2,quantity:9,reference:'Batas minimum'},ACTOR,at);return s;});
 await step(db,t,name,'transfer accepted',s=>{s.warehouses=applyStock(s.warehouses,{id:randomUUID(),kind:'accept',sourceId:transfer,reference:'Diterima kota'},ACTOR,new Date().toISOString());return s;});

 let o1,o2;
 await step(db,t,name,'checkout reserves stock',s=>{o1=checkout(s,name,'Siti Rahmawati',depot,[0,0,1]);return s;});
 await step(db,t,name,'payment',s=>{s.paid.push(o1);s.orders=s.orders.map(o=>o.id===o1?{...o,paidDate:'12/10/2026'}:o);return s;});
 await step(db,t,name,'dispatch',s=>{const r=dispatchBrowserOrder(s.orders.find(o=>o.id===o1),s.paid,s.warehouses,'SURAT-1',ACTOR,new Date().toISOString(),randomUUID);s.orders=s.orders.map(o=>o.id===o1?r.order:o);s.warehouses=r.warehouses;return s;});
 await step(db,t,name,'receipt',s=>{const r=receiveBrowserOrder(s.orders.find(o=>o.id===o1),s.paid,s.warehouses,'BUKTI-1','Ibu Penerima',ACTOR,new Date().toISOString());s.orders=s.orders.map(o=>o.id===o1?r:o);return s;});
 await step(db,t,name,'return after shipment',s=>{const ship=s.warehouses.documents.find(d=>d.kind==='reserve'&&d.reference===o1);s.warehouses=applyStock(s.warehouses,{id:randomUUID(),kind:'return',sourceId:ship.id,quantity:1,reference:'Retur pelanggan'},ACTOR,new Date().toISOString());return s;});
 await step(db,t,name,'second checkout',s=>{o2=checkout(s,name,'Budi Santoso',depot,[2]);return s;});
 await step(db,t,name,'cancel releases reservation',s=>{const r=cancelBrowserOrder(s.orders.find(o=>o.id===o2),s.paid,s.warehouses,'Uji batal',ACTOR,new Date().toISOString(),randomUUID);s.orders=s.orders.map(o=>o.id===o2?r.order:o);s.warehouses=r.warehouses;return s;});

 const supplier=randomUUID();let po,po2;
 await step(db,t,name,'supplier and reorder policy create a draft PO',s=>{
  const at=new Date().toISOString();
  s.replenishment=setSupplier(s.replenishment,{id:supplier,name:'CV Uji Pemasok',address:'Bandung',contact:'Rina',phone:'0812',email:'uji@contoh.id',active:true,changedAt:at,changedBy:ACTOR});
  s.replenishment=setReorderPolicy(s.replenishment,{locationId:depot,productId:p2,safety:200,target:260,minimumOrder:1,multiple:1,supplierId:supplier,supplier:'CV Uji Pemasok',unitCost:60000,leadDays:3,enabled:true,changedAt:at,changedBy:ACTOR},s.warehouses,s.products);
  s.replenishment=automaticPO(s.replenishment,s.warehouses,s.products,ACTOR,at,randomUUID);po=s.replenishment.orders[0].id;return s;});
 await step(db,t,name,'PO approved',s=>{s.replenishment=approvePO(s.replenishment,po,ACTOR,new Date().toISOString());return s;});
 await step(db,t,name,'supplier confirmation',s=>{s.replenishment=confirmPO(s.replenishment,{id:randomUUID(),orderId:po,confirmedOn:'2026-10-12',reference:'KONF-1',contact:'Rina',note:'Siap kirim'},ACTOR,new Date().toISOString());return s;});
 await step(db,t,name,'inspection with rejected units',s=>{const r=inspectPO(s.replenishment,s.warehouses,{id:randomUUID(),orderId:po,accepted:3,rejected:2,reason:'Kemasan rusak'},ACTOR,new Date().toISOString());s.replenishment=r.state;s.warehouses=r.warehouses;return s;});
 await step(db,t,name,'replacement delivery inspected',s=>{const r=inspectPO(s.replenishment,s.warehouses,{id:randomUUID(),orderId:po,accepted:2,rejected:0,reason:''},ACTOR,new Date().toISOString());s.replenishment=r.state;s.warehouses=r.warehouses;return s;});
 let replacement;
 await step(db,t,name,'replacement linked',s=>{const c=rejectionCases(s.replenishment)[0];const receipt=s.replenishment.receipts.at(-1);replacement=randomUUID();s.replenishment=linkReplacement(s.replenishment,{id:replacement,inspectionId:c.inspection.id,receiptId:receipt.id,quantity:2,reference:'GANTI-1',note:'Pengganti'},ACTOR,new Date().toISOString());return s;});
 await step(db,t,name,'replacement reversed',s=>{s.replenishment=reverseReplacement(s.replenishment,{id:randomUUID(),replacementId:replacement,reason:'Salah alokasi'},ACTOR,new Date().toISOString());return s;});
 await step(db,t,name,'second PO cancelled',s=>{const at=new Date().toISOString();s.replenishment=setReorderPolicy(s.replenishment,{...s.replenishment.policies[0],locationId:district,productId:p1,safety:50,target:80,changedAt:at,enabled:true},s.warehouses,s.products);s.replenishment=automaticPO(s.replenishment,s.warehouses,s.products,ACTOR,at,randomUUID);po2=s.replenishment.orders.find(o=>o.status==='draft').id;s.replenishment=cancelPO(s.replenishment,po2,'Tidak jadi',ACTOR,at);return s;});

 s=await tx(db,t,c=>readMain(c,t,name));
 // Saved history cannot be rewritten or removed through the web workspace.
 await assert.rejects(tx(db,t,c=>saveMain(c,t,s,{...s,orders:s.orders.slice(1)})),e=>e instanceof UserError&&/Pesanan/.test(e.message));
 await assert.rejects(tx(db,t,c=>saveMain(c,t,s,{...s,warehouses:{...s.warehouses,movements:s.warehouses.movements.map((m,i)=>i?m:{...m,physical:m.physical+1})}})),e=>e instanceof UserError);
 await assert.rejects(tx(db,t,c=>saveMain(c,t,s,{...s,members:s.members.slice(1)})),e=>e instanceof UserError);
 // The /v1 API sees the same orders and stock.
 const api=(await tx(db,t,c=>c.query("SELECT status,count(*)::int n FROM sajada.sales_order WHERE tenant_id=$1 GROUP BY status ORDER BY status",[t]))).rows;
 assert.deepEqual(api,[{status:'cancelled',n:1},{status:'paid',n:1}]);
 }finally{await db.close();}
});

test('web workspace rows stay inside their tenant',async()=>{
 const db=await setup();try{
 await db.query('SET ROLE web_test_api');
 const a=await seed(db,'Sajada Nasional'),b=await seed(db,'Sajada DKI Jakarta');
 const fromA=await tx(db,a,c=>readMain(c,b,'Sajada DKI Jakarta'));
 assert.equal(fromA.members.length,0,'tenant A session must not read tenant B members');
 assert.equal(fromA.products.length,0);
 const own=await tx(db,b,c=>readMain(c,b,'Sajada DKI Jakarta'));
 assert.deepEqual(own.members.map(m=>m[0]),['Budi Santoso']);
 }finally{await db.close();}
});

import {SECTION_STORES} from '../../lib/server/workspace/sections.ts';
import {seedRegions,assignRegion} from '../../shared/regions.ts';
import {issueNumber,emptyNumbers} from '../../shared/member-number.ts';
import {activateCapitalWallet,disburseCapital,payWithCapitalWallet} from '../../shared/member-capital.ts';
import {refundBrowserWalletOrder} from '../../shared/wallet-refund.ts';
import {allocateTiered,initialTierState,settleReport} from '../../shared/tiered-sharing.ts';
import {commissions,POLICY} from '../../shared/mlm.ts';
import {billAmount} from '../../shared/accounting.ts';
import {jakartaDay} from '../../shared/inventory-reports.ts';

async function readAll(db,t,name){return tx(db,t,async c=>{const data={'sajada-v2':await readMain(c,t,name)};for(const [k,s] of Object.entries(SECTION_STORES))data[k]=await s.read(c,t);return data;});}
// One save of a non-main section, validated against the whole workspace, then read back.
async function save(db,t,name,section,change){
 const before=await readAll(db,t,name);const value=change(structuredClone(before[section]),before);
 validateWorkspace(name,{...before,[section]:value});
 await tx(db,t,c=>section==='sajada-v2'?saveMain(c,t,before[section],value):SECTION_STORES[section].save(c,t,before[section],value));
 const after=await readAll(db,t,name);
 assert.deepEqual(canon(after[section]),canon(value),section+': database round trip differs');
 return after;
}

test('every other workspace section round-trips through PostgreSQL',async()=>{
 const db=await setup();try{
 await db.query('SET ROLE web_test_api');
 const name='Sajada Nasional',t=await seed(db,name),ACT='Admin demo';
 let all=await readAll(db,t,name);const names=all['sajada-v2'].members.map(m=>m[0]);
 for(const [k,v] of Object.entries(all))if(k!=='sajada-v2')assert.equal(v,null,k+' starts empty');

 // Regions and member numbers (member_number + counter on the domain tables).
 const codes={'demo-jb':'32','demo-bandung':'73','demo-coblong':'01','demo-bogor':'71','demo-bogortengah':'02'};
 all=await save(db,t,name,'sajada-regions',()=>{let g={regions:seedRegions().map(r=>codes[r.id]?{...r,code:codes[r.id]}:r),assignments:{}};g=assignRegion(g,'Siti Rahmawati','demo-dago',names);return assignRegion(g,'Dewi Lestari','demo-pabaton',names);});
 const geo=all['sajada-regions'];
 all=await save(db,t,name,'sajada-member-numbers',()=>issueNumber(emptyNumbers(),'Siti Rahmawati',names,geo,new Date().toISOString()).state);
 all=await save(db,t,name,'sajada-member-numbers',s=>issueNumber(s,'Dewi Lestari',names,geo,new Date().toISOString()).state);
 assert.equal(all['sajada-member-numbers'].issued[1].sequence,2);
 assert.match(all['sajada-member-numbers'].issued[0].number,/^327301\d{2}000001$/);
 await assert.rejects(tx(db,t,c=>SECTION_STORES['sajada-member-numbers'].save(c,t,all['sajada-member-numbers'],{...all['sajada-member-numbers'],issued:[]})),e=>e instanceof UserError);

 // MLM sponsor tree on member.sponsor_id.
 all=await save(db,t,name,'sajada-network',()=>({'Siti Rahmawati':null,'Budi Santoso':'Siti Rahmawati','Dewi Lestari':'Siti Rahmawati','Ahmad Hidayat':'Budi Santoso'}));
 all=await save(db,t,name,'sajada-network',g=>({...g,'Ahmad Hidayat':'Dewi Lestari'}));

 // Fee plan, capital records and wallet payment/refund on an order.
 const fees={memberDues:1000000,adminFee:500000,other:1000000,note:'Rincian uji'};
 all=await save(db,t,name,'sajada-capital-fees',()=>fees);
 all=await save(db,t,name,'sajada-member-capital',()=>activateCapitalWallet('Siti Rahmawati',names,{},fees,'AKT-1','2026-10-12',ACT,new Date().toISOString()));
 all=await save(db,t,name,'sajada-member-capital',r=>disburseCapital('Dewi Lestari',names,r,'CAIR-1','2026-10-12'));
 const depot=all['sajada-v2'].warehouses.locations[0].id;let paidOrder,refundOrder;
 all=await save(db,t,name,'sajada-v2',s=>{paidOrder=checkout(s,name,'Siti Rahmawati',depot,[0]);refundOrder=checkout(s,name,'Siti Rahmawati',depot,[3]);for(const p of s.products)p.stock=totalAvailable(s.warehouses,p.id);return s;});
 all=await save(db,t,name,'sajada-v2',(s,b)=>{for(const id of [paidOrder,refundOrder]){const r=payWithCapitalWallet(s.orders,s.paid,b['sajada-member-capital'],names,name,id,'Siti Rahmawati',ACT,new Date().toISOString());s.orders=r.orders;s.paid=r.paid;}return s;});
 all=await save(db,t,name,'sajada-v2',(s,b)=>{const r=refundBrowserWalletOrder(s.orders,s.paid,b['sajada-member-capital'],name,refundOrder,{id:randomUUID(),reference:'RF-1',reason:'Batal beli'},s.warehouses,ACT,new Date().toISOString(),randomUUID);s.orders=r.orders;s.paid=r.paid;s.warehouses=r.warehouses;for(const p of s.products)p.stock=totalAvailable(s.warehouses,p.id);return s;});
 assert.equal(all['sajada-v2'].orders.find(o=>o.id===refundOrder).walletRefund.reference,'RF-1');

 // Investors (domain investor table) and tiered profit sharing.
 const inv=[{id:randomUUID(),name:'Investor Satu',code:'INV-1'},{id:randomUUID(),name:'Investor Dua',code:'INV-2'}];
 all=await save(db,t,name,'sajada-funding',()=>({investors:inv,allocations:{'Dewi Lestari':[{investorId:inv[0].id,investorName:inv[0].name,amount:10000000},{investorId:inv[1].id,investorName:inv[1].name,amount:2500000}]}}));
 const result=allocateTiered(4000000,initialTierState()),rid=randomUUID();
 all=await save(db,t,name,'sajada-tiered-sharing',()=>[{funding:all['sajada-funding'].allocations['Dewi Lestari'],id:rid,member:'Dewi Lestari',period:'2026-10',reference:'LAP-1',revenue:9000000,cost:5000000,status:'pending',...result}]);
 all=await save(db,t,name,'sajada-tiered-sharing',r=>settleReport(r,rid,'BAYAR-1'));
 assert.equal(all['sajada-tiered-sharing'][0].status,'settled');
 all=await save(db,t,name,'sajada-profit-sharing',()=>[{id:'L-1',member:'Dewi Lestari',period:'2026-09',reference:'LAMA-1',revenue:1000,cost:400,profit:600,distributable:600,memberPercent:60,investorPercent:40,memberShare:360,investorShare:240,at:'2026-09-30'}]);

 // Commission review on the received wallet order.
 all=await save(db,t,name,'sajada-v2',s=>{const o=s.orders.find(x=>x.id===paidOrder);const d=dispatchBrowserOrder(o,s.paid,s.warehouses,'SJL-9',ACT,new Date().toISOString(),randomUUID);s.warehouses=d.warehouses;const r=receiveBrowserOrder(d.order,s.paid,s.warehouses,'TRM-9','Siti',ACT,new Date().toISOString());s.orders=s.orders.map(x=>x.id===paidOrder?r:x);for(const p of s.products)p.stock=totalAvailable(s.warehouses,p.id);return s;});
 const eligible=all['sajada-v2'].orders.filter(o=>o.receivedAt&&o.policy===POLICY);
 const ids=commissions(eligible).map(c=>c.id);
 all=await save(db,t,name,'sajada-commissions',()=>({delivered:[],statuses:Object.fromEntries(ids.map(id=>[id,'approved'])),audit:[{at:new Date().toISOString(),action:'Setujui komisi',reference:paidOrder,actor:ACT}]}));
 all=await save(db,t,name,'sajada-commissions',c=>({...c,correctionApprovals:{}}));

 // Supplier bills, payments and capital deposits.
 const at=new Date().toISOString();
 all=await save(db,t,name,'sajada-ledger',()=>({bills:[{id:'AP-UJI1',supplier:'PT Uji',reference:'INV-77',date:'2026-10-01',due:'2026-10-31',currency:'USD',amount:100.5,rate:15500,base:billAmount(100.5,15500),account:'5100'}],payments:[{id:'APPAY-1',billId:'AP-UJI1',amount:500000,date:jakartaDay(at),reference:'TRF-1',actor:ACT,at}],capital:[{id:'CAP-1',amount:20000000,date:'2026-10-01',note:'Setoran awal'}]}));

 // Removing sections clears their rows.
 all=await save(db,t,name,'sajada-ledger',()=>null);
 all=await save(db,t,name,'sajada-profit-sharing',()=>null);
 assert.equal(all['sajada-ledger'],null);
 }finally{await db.close();}
});

import {resetIn,restoreIn} from '../../lib/server/workspace/index.ts';
import {withDatabaseIds} from '../../lib/server/workspace/legacy-ids.ts';
import {seedWarehouses} from '../../shared/warehouses.ts';

test('demo reset and backup restore replace workspace history safely',async()=>{
 const db=await setup();try{
 await db.query('SET ROLE web_test_api');
 const name='Sajada Nasional',t=await seed(db,name),ACT='Admin demo';
 let all=await readAll(db,t,name);const names=all['sajada-v2'].members.map(m=>m[0]);
 const codes={'demo-jb':'32','demo-bandung':'73','demo-coblong':'01','demo-bogor':'71','demo-bogortengah':'02'};
 all=await save(db,t,name,'sajada-regions',()=>assignRegion({regions:seedRegions().map(r=>codes[r.id]?{...r,code:codes[r.id]}:r),assignments:{}},'Siti Rahmawati','demo-dago',names));
 all=await save(db,t,name,'sajada-member-numbers',()=>issueNumber(emptyNumbers(),'Siti Rahmawati',names,all['sajada-regions'],new Date().toISOString()).state);
 const depot=all['sajada-v2'].warehouses.locations[0].id;let order;
 all=await save(db,t,name,'sajada-v2',s=>{order=checkout(s,name,'Siti Rahmawati',depot,[0,1]);for(const p of s.products)p.stock=totalAvailable(s.warehouses,p.id);return s;});
 all=await save(db,t,name,'sajada-v2',s=>{s.paid.push(order);return s;});
 all=await save(db,t,name,'sajada-v2',s=>{const r=dispatchBrowserOrder(s.orders[0],s.paid,s.warehouses,'SJL-1',ACT,new Date().toISOString(),randomUUID);s.orders=[r.order];s.warehouses=r.warehouses;for(const p of s.products)p.stock=totalAvailable(s.warehouses,p.id);return s;});
 all=await save(db,t,name,'sajada-capital-fees',()=>({memberDues:0,adminFee:0,other:2500000,note:'Uji'}));
 const backup=await readAll(db,t,name);

 // Reset: dispatched orders and stock history go, members, numbers and regions stay.
 await tx(db,t,c=>resetIn(c,t,name));
 all=await readAll(db,t,name);
 assert.equal(all['sajada-v2'].orders.length,0);assert.equal(all['sajada-v2'].paid.length,0);
 assert.deepEqual(all['sajada-v2'].products.map(p=>[p.sku,p.stock]),[['SJ-001',128],['SJ-002',42],['SJ-003',86],['SJ-004',215]]);
 assert.equal(all['sajada-v2'].warehouses.movements.length,4);
 assert.deepEqual(all['sajada-v2'].members,backup['sajada-v2'].members);
 assert.deepEqual(canon(all['sajada-member-numbers']),canon(backup['sajada-member-numbers']));
 assert.deepEqual(canon(all['sajada-regions']),canon(backup['sajada-regions']));
 assert.equal(all['sajada-capital-fees'],null);

 // Restore the backup taken before the reset: everything comes back exactly.
 await tx(db,t,c=>restoreIn(c,t,name,backup));
 assert.deepEqual(canon(await readAll(db,t,name)),canon(backup));

 // A backup that drops an issued member number is refused, and nothing changes.
 await assert.rejects(tx(db,t,c=>restoreIn(c,t,name,{...backup,'sajada-member-numbers':null})),/nomor anggota/);
 assert.deepEqual(canon(await readAll(db,t,name)),canon(backup));

 // Backups from the localStorage version use demo ids like "SKU-1" and "depot-awal".
 const legacyProducts=initialProducts,legacy={'sajada-v2':{orders:[],members:backup['sajada-v2'].members,paid:[],products:legacyProducts,stockMoves:[],warehouses:seedWarehouses(legacyProducts,name),replenishment:emptyReplenishment()},'sajada-regions':backup['sajada-regions'],'sajada-member-numbers':backup['sajada-member-numbers']};
 const converted={...legacy,'sajada-v2':withDatabaseIds(legacy['sajada-v2'])};
 validateWorkspace(name,converted);
 await tx(db,t,c=>restoreIn(c,t,name,converted));
 all=await readAll(db,t,name);
 assert.ok(all['sajada-v2'].products.every(p=>/^[0-9a-f-]{36}$/.test(p.id)));
 assert.equal(all['sajada-v2'].warehouses.locations[0].name,'Depot provinsi • '+name);
 assert.deepEqual(canon(all['sajada-v2']),canon(converted['sajada-v2']));

 // Once the accounting API has posted for the tenant, demo reset is refused.
 await db.query('RESET ROLE');await db.query("INSERT INTO sajada.journal(tenant_id,id,reference,effective_date,status) VALUES($1,gen_random_uuid(),'API-1',current_date,'draft')",[t]);await db.query('SET ROLE web_test_api');
 await assert.rejects(tx(db,t,c=>resetIn(c,t,name)),/catatan akuntansi/);
 }finally{await db.close();}
});
