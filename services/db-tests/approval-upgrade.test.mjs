import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {createInvestor,openCapital,draftProfit,approveProfit,settleProfit} from '../transaction/profit-service.mjs';
test('approval migration preserves existing v0.19 history and gates open drafts',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});
 try{
 for(const file of ['../../architecture/postgresql.sql','../transaction/hardening.sql','../transaction/member-number.sql','../transaction/profit-sharing.sql','../transaction/profit-corrections.sql'])await db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
 const tenant=randomUUID(),member=randomUUID(),investor=randomUUID();
 await db.query("INSERT INTO sajada.tenant(id,name) VALUES($1,'Upgrade fixture')",[tenant]);
 await db.query("INSERT INTO sajada.member(tenant_id,id,name,status) VALUES($1,$2,'Member','active')",[tenant,member]);
 async function tx(fn){await db.exec('BEGIN');try{await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);const r=await fn(db);await db.exec('COMMIT');return r;}catch(e){await db.exec('ROLLBACK');throw e;}}
 await tx(c=>createInvestor(c,tenant,{id:investor,name:'Investor'},'admin'));
 await tx(c=>openCapital(c,tenant,member,{reference:'FUND-001',funding:[{investorId:investor,amount:12500000}]},'admin'));
 const historical=await tx(c=>draftProfit(c,tenant,{member_id:member,period:'2026-01',revenue:10000000,cost:0},'old-001','maker'));
 // Seed the previous release's settled state before installing the new policy.
 await tx(async c=>{await c.query("UPDATE sajada.profit_report SET status='settled',settled_by='staff',settled_at=now(),settlement_reference='OLD-SET' WHERE tenant_id=$1 AND id=$2",[tenant,historical.id]);await c.query("UPDATE sajada.capital_account SET remaining_principal=$3,post_recovery_profit=$4,last_period='2026-01' WHERE tenant_id=$1 AND member_id=$2",[tenant,member,historical.result.after.remainingPrincipal,historical.result.after.postRecoveryProfit]);});
 const pending=await tx(c=>draftProfit(c,tenant,{member_id:member,period:'2026-02',revenue:1000000,cost:0},'old-002','maker'));
 const before=(await db.query('SELECT * FROM sajada.capital_account')).rows[0];
 await t.test('migration 006 applies over settled and pending records',async()=>{await db.exec(await readFile(new URL('../transaction/profit-approval.sql',import.meta.url),'utf8'));const old=(await db.query('SELECT * FROM sajada.profit_report WHERE id=$1',[historical.id])).rows[0];assert.equal(old.status,'settled');assert.equal(old.approved_by,null);assert.equal(old.approval_reference,null);assert.deepEqual((await db.query('SELECT * FROM sajada.capital_account')).rows[0],before);assert.equal((await tx(c=>settleProfit(c,tenant,historical.id,{reference:'OLD-SET'},'staff'))).id,historical.id);});
 await t.test('existing open draft requires a new independent approval',async()=>{await assert.rejects(()=>tx(c=>settleProfit(c,tenant,pending.id,{reference:'NEW-SET'},'staff')),e=>e.status===409);await tx(c=>approveProfit(c,tenant,pending.id,{reference:'APP-UPGRADE'},'reviewer'));const r=await tx(c=>settleProfit(c,tenant,pending.id,{reference:'NEW-SET'},'staff'));assert.equal(r.status,'settled');assert.equal(r.approved_by,'reviewer');});
 }finally{await db.close();}
});
