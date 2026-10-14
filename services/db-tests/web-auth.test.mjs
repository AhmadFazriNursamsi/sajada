import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';

// web-auth.sql (sign-in tables) over every migration, in the order docker/db.Dockerfile installs them.
const root=new URL('../../',import.meta.url);
async function setup(){
 const dockerfile=await readFile(new URL('docker/db.Dockerfile',root),'utf8');
 const files=[...dockerfile.matchAll(/^COPY (\S+\.sql) \/docker-entrypoint-initdb\.d\/(\S+)$/gm)].sort((a,b)=>a[2].localeCompare(b[2])).map(m=>m[1]);
 assert.ok(files.length>=20,'migration list read from docker/db.Dockerfile');
 const db=new PGlite({extensions:{pgcrypto}});
 for(const f of files)await db.exec(await readFile(new URL(f,root),'utf8'));
 const auth=await readFile(new URL('services/transaction/web-auth.sql',root),'utf8');
 const registration=await readFile(new URL('services/transaction/web-registration.sql',root),'utf8');
 for(let i=0;i<2;i++){await db.exec(auth);await db.exec(registration);}// applied on every start, so it must be repeatable
 const tenant=(await db.query("INSERT INTO sajada.tenant(name) VALUES('Koperasi Uji') RETURNING id")).rows[0].id;
 const member=(await db.query("INSERT INTO sajada.member(tenant_id,name) VALUES($1,'Ani') RETURNING id",[tenant])).rows[0].id;
 return {db,tenant,member};
}
const user=(db,cols,vals)=>db.query(`INSERT INTO sajada.app_user(username,display_name,password_hash${cols?','+cols:''}) VALUES($1,'Uji','x'${vals.slice(1).map((_,i)=>',$'+(i+2)).join('')}) RETURNING id`,vals);

test('sign-in tables: repeatable install and account integrity',async t=>{
 const {db,tenant,member}=await setup();
 await t.test('staff and member accounts',async()=>{
  const staff=(await user(db,'role',['petugas','member_officer'])).rows[0].id;
  await db.query('INSERT INTO sajada.app_user_tenant(user_id,tenant_id) VALUES($1,$2)',[staff,tenant]);
  await user(db,'role,tenant_id,member_id',['ani','member',tenant,member]);
 });
 await t.test('username rules and uniqueness',async()=>{
  await assert.rejects(user(db,'role',['Bad Name','viewer']),/check constraint/);
  await assert.rejects(user(db,'role',['petugas','viewer']),/duplicate key/);
 });
 await t.test('member/investor accounts need their person, staff accounts must not have one',async()=>{
  await assert.rejects(user(db,'role,tenant_id',['anggota2','member',tenant]),/check constraint/);
  await assert.rejects(user(db,'role,tenant_id,member_id',['staf2','accountant',tenant,member]),/check constraint/);
  await assert.rejects(user(db,'role,tenant_id,member_id',['anggota3','member',tenant,'00000000-0000-0000-0000-000000000000']),/foreign key/);
  await assert.rejects(user(db,'role',['peran','superuser']),/check constraint/);
 });
 await t.test('sessions store a SHA-256 only and end with the account',async()=>{
  const id=(await user(db,'role',['sesi','viewer'])).rows[0].id;
  await assert.rejects(db.query("INSERT INTO sajada.app_session(token_hash,user_id,expires_at) VALUES('token-asli',$1,now())",[id]),/check constraint/);
  await db.query("INSERT INTO sajada.app_session(token_hash,user_id,expires_at) VALUES($1,$2,now())",['a'.repeat(64),id]);
  await db.query('DELETE FROM sajada.app_user WHERE id=$1',[id]);
  assert.equal((await db.query('SELECT count(*)::int n FROM sajada.app_session')).rows[0].n,0);
 });
});
