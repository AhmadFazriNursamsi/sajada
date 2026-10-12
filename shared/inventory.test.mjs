import {test} from 'node:test';import assert from 'node:assert/strict';import {validateProduct,consumeStock,adjustStock} from './inventory.ts';
const p={id:'1',sku:'COFFEE',name:'Kopi',price:85000,stock:2,active:true,category:'Minuman',emoji:'☕',bg:'#fff'};
test('duplicate cart items consume correct units once',()=>{const r=consumeStock([p],[0,0]);assert.equal(r.products[0].stock,0);assert.equal(r.items[0].quantity,2);assert.equal(r.total,170000);assert.equal(p.stock,2);});
test('overselling fails without mutating source',()=>{assert.throws(()=>consumeStock([p],[0,0,0]));assert.equal(p.stock,2);});
test('inactive, missing and empty cart are rejected',()=>{assert.throws(()=>consumeStock([{...p,active:false}],[0]));assert.throws(()=>consumeStock([p],[9]));assert.throws(()=>consumeStock([p],[]));});
test('SKU is unique ignoring case',()=>assert.throws(()=>validateProduct({...p,id:'2',sku:'coffee'},[p])));
test('invalid prices and stock are rejected',()=>{assert.throws(()=>validateProduct({...p,price:0},[]));assert.throws(()=>validateProduct({...p,stock:-1},[]));assert.throws(()=>validateProduct({...p,stock:1.5},[]));});
test('stock correction cannot make stock negative',()=>{assert.equal(adjustStock([p],'1',3)[0].stock,5);assert.throws(()=>adjustStock([p],'1',-3));assert.throws(()=>adjustStock([p],'1',0));});
