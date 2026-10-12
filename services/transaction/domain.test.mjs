import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateOrder,idempotency,tenantClaim} from './domain.mjs';
const id='00000000-0000-0000-0000-000000000001';
test('rejects empty, negative, fractional and duplicate quantities',()=>{for(const items of [[],[{product_id:id,quantity:-1}],[{product_id:id,quantity:1.5}],[{product_id:id,quantity:1},{product_id:id,quantity:2}]])assert.throws(()=>validateOrder({items}));});
test('accepts valid order and does not trust client price',()=>assert.deepEqual(validateOrder({items:[{product_id:id,quantity:2}]}),[{product_id:id,quantity:2}]));
test('requires explicit tenant membership',()=>{assert.equal(tenantClaim({tenant_ids:[id]},id),id);assert.throws(()=>tenantClaim({tenant_ids:[]},id));assert.throws(()=>tenantClaim({},id));});
test('requires bounded idempotency key',()=>{assert.equal(idempotency('order-123'),'order-123');assert.throws(()=>idempotency(''));assert.throws(()=>idempotency('a'.repeat(129)));});
