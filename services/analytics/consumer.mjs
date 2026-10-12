import pg from 'pg';
for(const key of ['DATABASE_URL','CLICKHOUSE_URL','CLICKHOUSE_USER','CLICKHOUSE_PASSWORD','TENANT_IDS'])if(!process.env[key])throw Error(`${key} required`);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});
const tenants=process.env.TENANT_IDS.split(',').map(x=>x.trim());
const auth='Basic '+Buffer.from(process.env.CLICKHOUSE_USER+':'+process.env.CLICKHOUSE_PASSWORD).toString('base64');
async function processTenant(tenant){const c=await pool.connect();try{
 await c.query('BEGIN');await c.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
 const result=await c.query('SELECT * FROM sajada.outbox WHERE tenant_id=$1 AND published_at IS NULL ORDER BY occurred_at FOR UPDATE SKIP LOCKED LIMIT 100',[tenant]);
 if(result.rowCount){
  const rows=result.rows.map(r=>JSON.stringify({tenant_id:r.tenant_id,event_id:r.event_id,aggregate_id:r.aggregate_id,event_type:r.event_type,payload:JSON.stringify(r.payload),occurred_at:new Date(r.occurred_at).toISOString().replace('T',' ').replace('Z',''),version:1})).join('\n');
  const url=new URL(process.env.CLICKHOUSE_URL);url.searchParams.set('query','INSERT INTO sajada_analytics.domain_event FORMAT JSONEachRow');
  const response=await fetch(url,{method:'POST',headers:{authorization:auth,'content-type':'text/plain'},body:rows,signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`ClickHouse rejected batch: ${response.status}`);
  await c.query('UPDATE sajada.outbox SET published_at=now() WHERE tenant_id=$1 AND event_id=ANY($2::uuid[])',[tenant,result.rows.map(r=>r.event_id)]);
 }
 await c.query('COMMIT');return result.rowCount;
}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
// At-least-once transport. Deduplicate reads by event_id using FINAL.
async function run(){for(const tenant of tenants){try{await processTenant(tenant);}catch(e){console.error('Analytics batch failed:',e.message);}}setTimeout(run,5000);}
run();
