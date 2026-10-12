// Rebuilds database/postgresql-full-schema.sql, schema-dictionary.json and erd.mmd from the
// migrations listed in database/migrations.json. The combined SQL runs on PGlite (+pgcrypto) and
// the dictionary/ERD are read from that engine's catalog.
// Usage (from services/db-tests): node database-docs.mjs [--check]
import {readFile,writeFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';

const root=new URL('../../',import.meta.url),db=new URL('database/',root);
const order=JSON.parse(await readFile(new URL('migrations.json',db),'utf8'));
const parts=[];for(const m of order)parts.push(`-- === ${String(m.order).padStart(3,'0')} ${m.source} ===\n`+await readFile(new URL(m.source,root),'utf8')+'\n');
const schema='-- Sajada v0.42 complete PostgreSQL schema. NEW EMPTY DATABASE ONLY.\n-- Execute with psql -v ON_ERROR_STOP=1. No live data or passwords.\n\n'+parts.join('\n');

const pg=new PGlite({extensions:{pgcrypto}});await pg.exec(schema);
const q=async(sql)=>(await pg.query(sql)).rows;
const tables=(await q("SELECT table_name FROM information_schema.tables WHERE table_schema='sajada' AND table_type='BASE TABLE' ORDER BY table_name")).map(r=>r.table_name);
const columns=await q("SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default,ordinal_position FROM information_schema.columns WHERE table_schema='sajada' ORDER BY table_name,ordinal_position");
const constraints=await q("SELECT c.relname AS table_name,k.conname AS name,k.contype AS type,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sajada' ORDER BY c.relname,k.conname");
const indexes=await q("SELECT tablename AS table_name,indexname AS name,indexdef AS definition FROM pg_indexes WHERE schemaname='sajada' ORDER BY tablename,indexname");
const policies=await q("SELECT tablename AS table_name,policyname AS name,cmd,qual,with_check FROM pg_policies WHERE schemaname='sajada' ORDER BY tablename,policyname");
const triggers=await q("SELECT c.relname AS table_name,t.tgname AS name,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sajada' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname");
const fks=await q("SELECT c.relname AS table_name,r.relname AS ref,k.conname AS name FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_class r ON r.oid=k.confrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sajada' AND k.contype='f' ORDER BY c.relname,k.conname");
await pg.close();

const of=(rows,t)=>rows.filter(r=>r.table_name===t);
const dictionary={schema:'sajada',tables:tables.map(t=>({table_name:t,columns:of(columns,t),constraints:of(constraints,t),indexes:of(indexes,t),policies:of(policies,t),triggers:of(triggers,t)}))};
const erd=['erDiagram','  direction TB',...tables.flatMap(t=>[`  ${t} {`,...of(columns,t).map(c=>`    ${c.udt_name} ${c.column_name}`),'  }']),...fks.map(f=>`  ${f.ref} ||--o{ ${f.table_name} : "${f.name}"`)].join('\n')+'\n';

const outputs={'postgresql-full-schema.sql':schema,'schema-dictionary.json':JSON.stringify(dictionary,null,2)+'\n','erd.mmd':erd};
if(process.argv.includes('--check')){
 let stale=0;for(const [f,text] of Object.entries(outputs)){const same=(await readFile(new URL(f,db),'utf8'))===text;console.log(`${same?'up to date':'STALE     '}  database/${f}`);if(!same)stale++;}
 process.exit(stale?1:0);
}
for(const [f,text] of Object.entries(outputs))await writeFile(new URL(f,db),text);
console.log(`database/ rebuilt from ${order.length} migrations, ${tables.length} tables`);
