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
const MIGRATIONS=['../../architecture/postgresql.sql','hardening','member-number','profit-sharing','profit-corrections','profit-approval','inventory','order-cancel','order-dispatch','order-receipt','replenishment','payables','suppliers','po-delivery','po-confirmation','po-inspection','po-replacement','po-replacement-reversal','capital-wallet','capital-wallet-refund','web-workspace'].map(f=>f.startsWith('.')?f:`../transaction/${f}.sql`);
const ACTOR='Admin demo';
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
const canon=v=>sorted(JSON.parse(JSON.stringify(v)));

async function setup(){
 const db=new PGlite({extensions:{pgcrypto}});
 for(const f of MIGRATIONS)await db.exec(await readFile(new URL(f,import.meta.url),'utf8'));
 await db.exec(`CREATE ROLE web_test_api NOSUPERUSER NOBYPASSRLS;GRANT USAGE ON SCHEMA sajada TO web_test_api;GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA sajada TO web_test_api;GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA sajada TO web_test_api;`);
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
