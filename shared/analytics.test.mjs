import {test} from 'node:test';import assert from 'node:assert/strict';import {isoDate,summarize,previousMonth} from './analytics.ts';
const order={id:'1',tenant:'A',date:'7/10/2026',seller:'Siti',total:170000,items:[{name:'Kopi',price:85000},{name:'Kopi',price:85000}]};
test('normalizes old and ISO dates',()=>{assert.equal(isoDate('7/10/2026'),'2026-10-07');assert.equal(isoDate('2026-10-07T12:00:00Z'),'2026-10-07');assert.equal(isoDate('bad'),'');});
test('isolates tenants and reporting month',()=>{const s=summarize([order,{...order,id:'2',tenant:'B'},{...order,id:'3',date:'2026-09-30'}],'A','2026-10',[]);assert.equal(s.total,170000);assert.equal(s.count,1);assert.equal(s.receivables,340000);});
test('deduplicates orders and sums product units',()=>{const s=summarize([order,order],'A','2026-10',['1']);assert.equal(s.products[0].units,2);assert.equal(s.members[0].total,170000);assert.equal(s.daily[6].total,170000);assert.equal(s.paidCount,1);assert.equal(s.receivables,0);});
test('empty period has zeros without invented growth',()=>{const s=summarize([],'A','2026-02',[]);assert.equal(s.total,0);assert.equal(s.average,0);assert.equal(s.daily.length,28);});
test('previous month crosses year boundary',()=>assert.equal(previousMonth('2026-01'),'2025-12'));
