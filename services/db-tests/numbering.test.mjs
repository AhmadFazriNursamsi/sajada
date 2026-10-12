import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';

test('SQL migrations and numbering on embedded PostgreSQL',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await t.test('all three migrations execute unchanged',async()=>{
   for(const path of ['../../architecture/postgresql.sql','../transaction/hardening.sql','../transaction/member-number.sql'])await db.exec(await readFile(new URL(path,import.meta.url),'utf8'));
  });
  const tenantA=randomUUID(),tenantB=randomUUID(),memberA=randomUUID(),memberB=randomUUID(),memberC=randomUUID(),memberInvalid=randomUUID();
  await db.query('INSERT INTO sajada.tenant(id,name) VALUES($1,$2),($3,$4)',[tenantA,'Tenant A',tenantB,'Tenant B']);
  await db.exec("INSERT INTO sajada.region(id,parent_id,kind,name,local_code) VALUES('p',NULL,'province','Test province','01'),('k','p','regency','Test regency','02'),('c','k','district','Test district','03'),('v','c','village','Test village',NULL)");
  for(const [tenant,member,region]of [[tenantA,memberA,'v'],[tenantA,memberB,'v'],[tenantB,memberC,'v'],[tenantA,memberInvalid,null]])await db.query("INSERT INTO sajada.member(tenant_id,id,name,status,region_id) VALUES($1,$2,$3,'active',$4)",[tenant,member,member,region]);
  await db.exec(`CREATE ROLE sajada_test_api NOSUPERUSER NOBYPASSRLS;
  GRANT USAGE ON SCHEMA sajada TO sajada_test_api;
  GRANT SELECT ON sajada.region TO sajada_test_api;
  GRANT SELECT,UPDATE ON sajada.member TO sajada_test_api;
  GRANT SELECT,INSERT ON sajada.member_number TO sajada_test_api;
  GRANT SELECT,INSERT,UPDATE ON sajada.member_number_counter TO sajada_test_api;
  GRANT INSERT ON sajada.outbox TO sajada_test_api;
  GRANT EXECUTE ON FUNCTION sajada.issue_member_number(uuid,uuid,text) TO sajada_test_api;`);
  async function scoped(tenant,fn,{rollback=false}={}){await db.exec('BEGIN; SET LOCAL ROLE sajada_test_api;');try{await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);const value=await fn();await db.exec(rollback?'ROLLBACK':'COMMIT');return value;}catch(e){await db.exec('ROLLBACK');throw e;}}
  const issue=(tenant,member)=>db.query('SELECT * FROM sajada.issue_member_number($1,$2,$3)',[tenant,member,'oidc-test-user']).then(r=>r.rows[0]);
  let first;
  await t.test('non-owner role issues formatted number with actor and event',async()=>{first=await scoped(tenantA,()=>issue(tenantA,memberA));assert.match(first.number,/^010203\d{2}000001$/);assert.equal(first.issued_by,'oidc-test-user');assert.equal((await db.query("SELECT count(*)::int n FROM sajada.outbox WHERE tenant_id=$1 AND event_type='member.number.issued'",[tenantA])).rows[0].n,1);});
  await t.test('same member retry returns same number without extra counter/event',async()=>{const again=await scoped(tenantA,()=>issue(tenantA,memberA));assert.equal(again.number,first.number);assert.equal((await db.query('SELECT last_value FROM sajada.member_number_counter WHERE tenant_id=$1',[tenantA])).rows[0].last_value,1);assert.equal((await db.query('SELECT count(*)::int n FROM sajada.outbox WHERE tenant_id=$1',[tenantA])).rows[0].n,1);});
  await t.test('different tenant has independent counter',async()=>{const b=await scoped(tenantB,()=>issue(tenantB,memberC));assert.equal(b.sequence_no,1);});
  await t.test('RLS hides other tenant rows with non-bypass role',async()=>{await scoped(tenantA,async()=>{const role=(await db.query('SELECT current_user')).rows[0].current_user;assert.equal(role,'sajada_test_api');const rows=(await db.query('SELECT tenant_id FROM sajada.member_number')).rows;assert.ok(rows.length>0);assert.ok(rows.every(r=>r.tenant_id===tenantA));assert.equal((await db.query('SELECT * FROM sajada.member_number WHERE tenant_id=$1',[tenantB])).rows.length,0);});});
  await t.test('mismatched explicit tenant rejected by function',async()=>{await assert.rejects(()=>scoped(tenantA,()=>issue(tenantB,memberC)),e=>e.code==='42501');});
  await t.test('foreign member cannot be issued inside own tenant context',async()=>{await assert.rejects(()=>scoped(tenantA,()=>issue(tenantA,memberC)),e=>e.code==='P0002');});
  await t.test('missing region fails without consuming counter',async()=>{await assert.rejects(()=>scoped(tenantA,()=>issue(tenantA,memberInvalid)),e=>e.code==='22023');assert.equal((await db.query('SELECT last_value FROM sajada.member_number_counter WHERE tenant_id=$1',[tenantA])).rows[0].last_value,1);});
  await t.test('rollback restores counter, issued row and outbox',async()=>{const temp=await scoped(tenantA,()=>issue(tenantA,memberB),{rollback:true});assert.equal(temp.sequence_no,2);assert.equal((await db.query('SELECT * FROM sajada.member_number WHERE tenant_id=$1 AND member_id=$2',[tenantA,memberB])).rows.length,0);const actual=await scoped(tenantA,()=>issue(tenantA,memberB));assert.equal(actual.sequence_no,2);});
  await t.test('issued number immutable even for owner',async()=>{await assert.rejects(()=>db.query('UPDATE sajada.member_number SET number=number WHERE tenant_id=$1',[tenantA]),e=>e.code==='55000');});
  await t.test('counter cannot be decremented',async()=>{await assert.rejects(()=>db.query('UPDATE sajada.member_number_counter SET last_value=1 WHERE tenant_id=$1',[tenantA]));});
  await t.test('100 sequential distinct members have unique contiguous numbers',async()=>{const issued=[];for(let i=0;i<100;i++){const m=randomUUID();await db.query("INSERT INTO sajada.member(tenant_id,id,name,status,region_id) VALUES($1,$2,$3,'active','v')",[tenantA,m,'Test '+i]);issued.push(await scoped(tenantA,()=>issue(tenantA,m)));}assert.equal(new Set(issued.map(r=>r.number)).size,100);assert.deepEqual(issued.map(r=>r.sequence_no),Array.from({length:100},(_,i)=>i+3));});
  await t.test('balanced journal posts and posted lines cannot mutate',async()=>{const jid=randomUUID();await db.query("INSERT INTO sajada.journal(tenant_id,id,reference,effective_date,status) VALUES($1,$2,'TEST-J1',current_date,'draft')",[tenantA,jid]);await db.query("INSERT INTO sajada.journal_line(tenant_id,journal_id,line_no,account_code,debit_base,credit_base) VALUES($1,$2,1,'1100',100,0),($1,$2,2,'2200',0,100)",[tenantA,jid]);await db.query("UPDATE sajada.journal SET status='posted' WHERE tenant_id=$1 AND id=$2",[tenantA,jid]);await assert.rejects(()=>db.query('UPDATE sajada.journal_line SET debit_base=200 WHERE tenant_id=$1 AND journal_id=$2 AND line_no=1',[tenantA,jid]));});
  await t.test('unbalanced journal is rejected on posting',async()=>{const jid=randomUUID();await db.query("INSERT INTO sajada.journal(tenant_id,id,reference,effective_date,status) VALUES($1,$2,'TEST-J2',current_date,'draft')",[tenantA,jid]);await db.query("INSERT INTO sajada.journal_line(tenant_id,journal_id,line_no,account_code,debit_base,credit_base) VALUES($1,$2,1,'1100',100,0),($1,$2,2,'2200',0,99)",[tenantA,jid]);await assert.rejects(()=>db.query("UPDATE sajada.journal SET status='posted' WHERE tenant_id=$1 AND id=$2",[tenantA,jid]),/balanced/);});
  await t.test('counter exhaustion fails atomically at 999999',async()=>{const tenant=randomUUID(),m=randomUUID();await db.query('INSERT INTO sajada.tenant(id,name) VALUES($1,$2)',[tenant,'Exhausted']);await db.query("INSERT INTO sajada.member(tenant_id,id,name,status,region_id) VALUES($1,$2,'Last','active','v')",[tenant,m]);await db.query("INSERT INTO sajada.member_number_counter(tenant_id,issue_year,last_value) VALUES($1,extract(year FROM now() AT TIME ZONE 'Asia/Jakarta')::int,999999)",[tenant]);await assert.rejects(()=>scoped(tenant,()=>issue(tenant,m)),e=>e.code==='23514');assert.equal((await db.query('SELECT * FROM sajada.member_number WHERE tenant_id=$1',[tenant])).rows.length,0);});
 }finally{await db.close();}
});
