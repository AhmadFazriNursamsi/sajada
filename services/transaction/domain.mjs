export function validateOrder(body){
 if(!body || !Array.isArray(body.items) || body.items.length<1 || body.items.length>100) throw new Error('1–100 order items required');
 const seen=new Set();
 for(const item of body.items){
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(item.product_id||'') || !Number.isSafeInteger(item.quantity) || item.quantity<1 || item.quantity>10000 || seen.has(item.product_id)) throw new Error('Invalid or duplicate item');
  seen.add(item.product_id);
 }
 return body.items.slice().sort((a,b)=>a.product_id.localeCompare(b.product_id));
}
export function idempotency(value){if(typeof value!=='string'||!value.trim()||value.length>128)throw new Error('Idempotency-Key required (max 128 characters)');return value;}
export function tenantClaim(payload,requested){
 if(!Array.isArray(payload.tenant_ids)||!payload.tenant_ids.includes(requested))throw new Error('Tenant access denied');
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requested))throw new Error('Invalid tenant');
 return requested;
}
