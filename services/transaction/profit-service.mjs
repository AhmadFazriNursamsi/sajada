import {createHash} from 'node:crypto';
import {allocateTiered,validateFunding,investorReceipts} from './profit-domain.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
function identifier(x){if(typeof x!=='string'||!uuid.test(x))fail(400,'Valid UUID required');return x.toLowerCase();}
function reference(x){if(typeof x!=='string'||!x.trim()||x.trim().length>128)fail(400,'Reference required (1-128 characters)');return x.trim();}
function actor(x){if(typeof x!=='string'||!x.trim())fail(403,'Authenticated actor required');return x;}
const state=a=>({remainingPrincipal:Number(a.remaining_principal),postRecoveryProfit:Number(a.post_recovery_profit)});
async function event(c,tenant,id,type,payload){await c.query('INSERT INTO sajada.outbox(tenant_id,aggregate_id,event_type,schema_version,payload) VALUES($1,$2,$3,1,$4)',[tenant,id,type,JSON.stringify(payload)]);}
async function account(c,tenant,member){const a=(await c.query('SELECT * FROM sajada.capital_account WHERE tenant_id=$1 AND member_id=$2 FOR UPDATE',[tenant,member])).rows[0];if(!a)fail(404,'Capital account not found');return a;}
export async function createInvestor(c,tenant,data,sub){actor(sub);const id=identifier(data.id);if(typeof data.name!=='string'||!data.name.trim()||data.name.trim().length>200)fail(400,'Investor name required');
 await c.query('INSERT INTO sajada.investor(tenant_id,id,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[tenant,id,data.name.trim()]);
 const row=(await c.query('SELECT * FROM sajada.investor WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];if(row.name!==data.name.trim())fail(409,'Investor ID already has another name');return row;
}
export async function openCapital(c,tenant,member,data,sub){member=identifier(member);actor(sub);const ref=reference(data.reference);
 if(!Array.isArray(data.funding)||data.funding.length>100)fail(400,'Funding rows required (maximum 100)');
 const rows=data.funding.map(r=>({investorId:identifier(r.investorId),amount:r.amount})).sort((a,b)=>a.investorId.localeCompare(b.investorId));
 const m=(await c.query('SELECT status FROM sajada.member WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,member])).rows[0];if(!m)fail(404,'Member not found');
 const old=(await c.query('SELECT * FROM sajada.capital_account WHERE tenant_id=$1 AND member_id=$2',[tenant,member])).rows[0];
 if(old){if(old.funding_reference!==ref||JSON.stringify(old.funding.map(r=>({investorId:r.investorId,amount:r.amount})))!==JSON.stringify(rows))fail(409,'Capital funding already recorded differently');return old;}
 if(m.status!=='active')fail(409,'Active member required');
 const investors=(await c.query('SELECT id,name FROM sajada.investor WHERE tenant_id=$1 AND id=ANY($2::uuid[])',[tenant,rows.map(r=>r.investorId)])).rows;
 const funding=validateFunding(rows,investors);
 const result=(await c.query('INSERT INTO sajada.capital_account(tenant_id,member_id,funding,funding_reference,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[tenant,member,JSON.stringify(funding),ref,sub])).rows[0];
 await event(c,tenant,member,'capital.recorded',{member_id:member,principal:12500000,currency:'IDR',reference:ref,actor:sub});return result;
}
export async function draftProfit(c,tenant,data,key,sub){const member=identifier(data.member_id);actor(sub);key=reference(key);
 if(typeof data.period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(data.period))fail(400,'Period must be YYYY-MM');
 for(const n of [data.revenue,data.cost])if(!Number.isSafeInteger(n)||n<0||n>1e12)fail(400,'Amounts must be nonnegative whole rupiah up to one trillion');
 if(data.cost>data.revenue)fail(400,'Loss policy not defined');
 const replaces=data.replaces_report_id==null?null:identifier(data.replaces_report_id);
 // Preserve v0.18 fingerprints for non-correction requests.
 const input=[member,data.period,data.revenue,data.cost];if(replaces)input.push(replaces);
 const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 // All draft and settlement operations serialize on the same member account.
 const a=await account(c,tenant,member);
 const old=(await c.query('SELECT * FROM sajada.profit_report WHERE tenant_id=$1 AND request_key=$2',[tenant,key])).rows[0];
 if(old){if(old.request_hash!==hash)fail(409,'Idempotency key reused with different request');return old;}
 if(replaces){
  const previous=(await c.query('SELECT member_id,period,status FROM sajada.profit_report WHERE tenant_id=$1 AND id=$2',[tenant,replaces])).rows[0];
  if(!previous||previous.member_id!==member||previous.period!==data.period||previous.status!=='cancelled')fail(409,'Replacement must reference cancelled report for same member and period');
  if((await c.query('SELECT id FROM sajada.profit_report WHERE tenant_id=$1 AND replaces_report_id=$2',[tenant,replaces])).rows.length)fail(409,'Report already has a replacement; follow correction chain');
 }else if((await c.query("SELECT id FROM sajada.profit_report WHERE tenant_id=$1 AND member_id=$2 AND period=$3 AND status='cancelled'",[tenant,member,data.period])).rows.length)fail(409,'Specify replaces_report_id for the cancelled report');
 if(a.last_period&&data.period<=a.last_period)fail(409,'Period must follow last settlement');
 if((await c.query("SELECT id FROM sajada.profit_report WHERE tenant_id=$1 AND member_id=$2 AND status='draft'",[tenant,member])).rows.length)fail(409,'Settle or cancel the outstanding draft first');
 const result=allocateTiered(data.revenue-data.cost,state(a));
 const history=(await c.query("SELECT id,member_id,period,result FROM sajada.profit_report WHERE tenant_id=$1 AND member_id=$2 AND status='settled' ORDER BY period",[tenant,member])).rows;
 // Replay history to cap each investor's returned principal, including rounding.
 const receipts=investorReceipts([...history.map(r=>({...r.result,id:r.id,member:r.member_id,period:r.period,status:'settled',funding:a.funding})),{...result,id:'current',member,period:data.period,status:'settled',funding:a.funding}]).filter(r=>r.reportId==='current');
 const calculated={...result,funding:a.funding,receipts};
 return (await c.query('INSERT INTO sajada.profit_report(tenant_id,member_id,period,revenue,cost,request_key,request_hash,result,created_by,replaces_report_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[tenant,member,data.period,data.revenue,data.cost,key,hash,JSON.stringify(calculated),sub,replaces])).rows[0];
}
export async function settleProfit(c,tenant,id,data,sub){id=identifier(id);actor(sub);const ref=reference(data.reference);
 const found=(await c.query('SELECT member_id FROM sajada.profit_report WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];if(!found)fail(404,'Profit report not found');
 const a=await account(c,tenant,found.member_id);
 const r=(await c.query('SELECT * FROM sajada.profit_report WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,id])).rows[0];
 if(r.status==='settled'){if(r.settlement_reference!==ref)fail(409,'Settlement reference differs');return r;}
 if(r.status!=='draft')fail(409,'Only draft reports can be settled');
 if(!r.approved_by)fail(409,'Independent approval required before settlement');
 if(Number(a.remaining_principal)!==r.result.before.remainingPrincipal||Number(a.post_recovery_profit)!==r.result.before.postRecoveryProfit||a.last_period&&r.period<=a.last_period)fail(409,'Calculation state no longer current');
 await c.query('UPDATE sajada.capital_account SET remaining_principal=$3,post_recovery_profit=$4,last_period=$5 WHERE tenant_id=$1 AND member_id=$2',[tenant,r.member_id,r.result.after.remainingPrincipal,r.result.after.postRecoveryProfit,r.period]);
 const settled=(await c.query("UPDATE sajada.profit_report SET status='settled',settled_by=$3,settled_at=now(),settlement_reference=$4 WHERE tenant_id=$1 AND id=$2 RETURNING *",[tenant,id,sub,ref])).rows[0];
 await event(c,tenant,id,'profit.entitlement.settled',{report_id:id,member_id:r.member_id,period:r.period,reference:ref,actor:sub,result:r.result});return settled;
}

export async function cancelProfit(c,tenant,id,data,sub){id=identifier(id);actor(sub);const ref=reference(data.reference);
 if(typeof data.reason!=='string'||!data.reason.trim()||data.reason.trim().length>1000)fail(400,'Cancellation reason required (1-1000 characters)');
 const reason=data.reason.trim();
 const found=(await c.query('SELECT member_id FROM sajada.profit_report WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];if(!found)fail(404,'Profit report not found');
 // Same lock order as draft/settlement: account then report.
 await account(c,tenant,found.member_id);
 const r=(await c.query('SELECT * FROM sajada.profit_report WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,id])).rows[0];
 if(r.status==='cancelled'){if(r.cancellation_reference!==ref||r.cancellation_reason!==reason)fail(409,'Cancellation request differs');return r;}
 if(r.status!=='draft')fail(409,'Only draft reports can be cancelled');
 const cancelled=(await c.query("UPDATE sajada.profit_report SET status='cancelled',cancelled_by=$3,cancelled_at=now(),cancellation_reference=$4,cancellation_reason=$5 WHERE tenant_id=$1 AND id=$2 RETURNING *",[tenant,id,sub,ref,reason])).rows[0];
 await event(c,tenant,id,'profit.draft.cancelled',{report_id:id,member_id:r.member_id,period:r.period,reference:ref,reason,actor:sub});
 return cancelled;
}

export async function approveProfit(c,tenant,id,data,sub){id=identifier(id);actor(sub);const ref=reference(data.reference);
 const found=(await c.query('SELECT member_id FROM sajada.profit_report WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];if(!found)fail(404,'Profit report not found');
 const a=await account(c,tenant,found.member_id);
 const r=(await c.query('SELECT * FROM sajada.profit_report WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,id])).rows[0];
 if(r.created_by===sub)fail(403,'Creator cannot approve own report');
 if(r.status==='cancelled')fail(409,'Cancelled reports cannot be approved');
 if(r.approved_by){if(r.approved_by!==sub||r.approval_reference!==ref)fail(409,'Approval already recorded differently');return r;}
 if(r.status!=='draft')fail(409,'Only draft reports can be approved');
 if(Number(a.remaining_principal)!==r.result.before.remainingPrincipal||Number(a.post_recovery_profit)!==r.result.before.postRecoveryProfit||a.last_period&&r.period<=a.last_period)fail(409,'Calculation state no longer current');
 const approved=(await c.query('UPDATE sajada.profit_report SET approved_by=$3,approved_at=now(),approval_reference=$4 WHERE tenant_id=$1 AND id=$2 RETURNING *',[tenant,id,sub,ref])).rows[0];
 await event(c,tenant,id,'profit.report.approved',{report_id:id,member_id:r.member_id,period:r.period,reference:ref,actor:sub,created_by:r.created_by});return approved;
}
