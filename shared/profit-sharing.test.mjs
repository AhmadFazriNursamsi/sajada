import {test} from 'node:test';import assert from 'node:assert/strict';import {shareProfit} from './profit-sharing.ts';
test('shares profit rather than capital or turnover',()=>{const r=shareProfit(10000000,6000000,70);assert.equal(r.profit,4000000);assert.equal(r.memberShare,2800000);assert.equal(r.investorShare,1200000);});
test('no positive distribution for loss or break even',()=>{assert.equal(shareProfit(100,200,70).distributable,0);assert.equal(shareProfit(100,100,70).memberShare,0);});
test('rounded shares sum exactly to distributable',()=>{const r=shareProfit(101,0,33.33);assert.equal(r.memberShare+r.investorShare,101);});
test('rejects missing/invalid ratios and negative costs',()=>{assert.throws(()=>shareProfit(100,0,NaN));assert.throws(()=>shareProfit(100,0,100));assert.throws(()=>shareProfit(100,-1,70));});
