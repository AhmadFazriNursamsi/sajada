import {test} from 'node:test';import assert from 'node:assert/strict';
import http from 'node:http';import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {createApi} from '../transaction/server.mjs';
const {generateKeyPair,exportJWK,SignJWT}=createRequire(new URL('../transaction/package.json',import.meta.url))('jose');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
const close=server=>new Promise(resolve=>server.close(resolve));
test('HTTP API with signed JWT, local JWKS and embedded PostgreSQL',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});let jwksServer,api;
 try{
  for(const path of ['../../architecture/postgresql.sql','../transaction/hardening.sql','../transaction/member-number.sql'])await db.exec(await readFile(new URL(path,import.meta.url),'utf8'));
  const tenantA=randomUUID(),tenantB=randomUUID(),memberA=randomUUID(),memberB=randomUUID();
  await db.query('INSERT INTO sajada.tenant(id,name) VALUES($1,$2),($3,$4)',[tenantA,'A',tenantB,'B']);
  await db.exec("INSERT INTO sajada.region(id,parent_id,kind,name,local_code) VALUES('p',NULL,'province','Test','01'),('k','p','regency','Test','02'),('c','k','district','Test','03'),('v','c','village','Test',NULL)");
  for(const [tenant,member]of [[tenantA,memberA],[tenantB,memberB]])await db.query("INSERT INTO sajada.member(tenant_id,id,name,status,region_id) VALUES($1,$2,$3,'active','v')",[tenant,member,'Member '+member]);
  await db.exec(`CREATE ROLE http_test_api NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA sajada TO http_test_api;
  GRANT SELECT ON sajada.region,sajada.product TO http_test_api;GRANT SELECT,UPDATE ON sajada.member TO http_test_api;
  GRANT SELECT,INSERT ON sajada.member_number TO http_test_api;
  GRANT SELECT,INSERT,UPDATE ON sajada.member_number_counter TO http_test_api; GRANT INSERT ON sajada.outbox TO http_test_api;
  GRANT EXECUTE ON FUNCTION sajada.issue_member_number(uuid,uuid,text) TO http_test_api;`);
  // Serialized adapter is only for embedded tests, NOT a native concurrency test.
  let gate=Promise.resolve();const pool={async connect(){const previous=gate;let releaseGate;gate=new Promise(r=>releaseGate=r);await previous;await db.exec('SET ROLE http_test_api');return {query:(sql,args)=>db.query(sql,args).then(r=>({...r,rowCount:r.affectedRows??r.rows.length})),release(){db.exec('RESET ROLE').finally(releaseGate)}};}};
  const {publicKey,privateKey}=await generateKeyPair('RS256');const jwk={...await exportJWK(publicKey),kid:'sajada-test-key',use:'sig',alg:'RS256'};
  jwksServer=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({keys:[jwk]}));});const issuer=await listen(jwksServer),audience='sajada-test-api';
  api=createApi({pool,jwksUrl:issuer+'/jwks',issuer,audience,logger:{error(){}}});const base=await listen(api);
  const token=async(overrides={})=>new SignJWT({tenant_ids:[tenantA],roles:['tenant_admin'],...overrides}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setSubject('test-admin').setIssuedAt().setIssuer(issuer).setAudience(audience).setExpirationTime('5m').sign(privateKey);
  const admin=await token();const request=(path,auth=admin,tenant=tenantA,method='GET')=>fetch(base+path,{method,headers:{...(auth?{authorization:'Bearer '+auth}:{}),'x-tenant-id':tenant}});
  const path='/v1/members/'+memberA+'/number';
  await t.test('missing bearer token returns 401',async()=>assert.equal((await request('/v1/members','')).status,401));
  await t.test('raw JWT without Bearer scheme returns 401',async()=>assert.equal((await fetch(base+'/v1/members',{headers:{authorization:admin,'x-tenant-id':tenantA}})).status,401));
  await t.test('tampered signature returns 401',async()=>{const parts=admin.split('.');parts[2]=(parts[2][0]==='a'?'b':'a')+parts[2].slice(1);assert.equal((await request('/v1/members',parts.join('.'))).status,401);});
  await t.test('expired JWT returns 401',async()=>{const expired=await new SignJWT({tenant_ids:[tenantA],roles:['tenant_admin']}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setSubject('test-admin').setIssuer(issuer).setAudience(audience).setExpirationTime(Math.floor(Date.now()/1000)-60).sign(privateKey);assert.equal((await request('/v1/members',expired)).status,401);});
  await t.test('wrong audience returns 401',async()=>{const wrong=await new SignJWT({tenant_ids:[tenantA],roles:['tenant_admin']}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setSubject('test-admin').setIssuer(issuer).setAudience('other').setExpirationTime('5m').sign(privateKey);assert.equal((await request('/v1/members',wrong)).status,401);});
  await t.test('unlisted tenant header returns 403',async()=>assert.equal((await request('/v1/members',admin,tenantB)).status,403));
  await t.test('nonstaff cannot list members',async()=>assert.equal((await request('/v1/members',await token({roles:['member']}))).status,403));
  await t.test('accountant cannot issue number',async()=>assert.equal((await request(path,await token({roles:['accountant']}),tenantA,'POST')).status,403));
  await t.test('read before issuance returns 404',async()=>assert.equal((await request(path)).status,404));
  let issued;
  await t.test('administrator issues through HTTP with verified actor',async()=>{const r=await request(path,admin,tenantA,'POST');assert.equal(r.status,200);issued=await r.json();assert.match(issued.number,/^010203\d{2}000001$/);assert.equal(issued.issued_by,'test-admin');});
  await t.test('HTTP retry returns same immutable number',async()=>{const r=await request(path,admin,tenantA,'POST');assert.equal(r.status,200);assert.equal((await r.json()).number,issued.number);});
  await t.test('GET and member listing return number within tenant only',async()=>{const r=await request(path);assert.equal((await r.json()).number,issued.number);const members=await(await request('/v1/members')).json();assert.equal(members.length,1);assert.equal(members[0].id,memberA);assert.equal(members[0].number,issued.number);});
  await t.test('foreign member ID cannot be issued by own tenant administrator',async()=>assert.equal((await request('/v1/members/'+memberB+'/number',admin,tenantA,'POST')).status,404));
  await gate;
 }finally{if(api)await close(api);if(jwksServer)await close(jwksServer);await db.close();}
});
