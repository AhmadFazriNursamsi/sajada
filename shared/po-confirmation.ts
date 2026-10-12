import {calendarDate} from './ap-aging.ts';
import type {PO,Replenishment} from './replenishment.ts';
export type POConfirmation={id:string;orderId:string;revision:number;confirmedOn:string;reference:string;contact:string;note:string;actor:string;at:string};
export type ConfirmationInput=Pick<POConfirmation,'id'|'orderId'|'confirmedOn'|'reference'|'contact'|'note'>;
function text(v:string,max:number){if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('Referensi, kontak, alasan dan petugas konfirmasi wajib diisi.');}
export function validateConfirmations(records:POConfirmation[],orders:PO[]){if(!Array.isArray(records))throw Error('Riwayat konfirmasi tidak valid.');const ids=new Set(),refs=new Set();const latest=new Map<string,POConfirmation>();for(const r of records.slice().sort((a,b)=>a.orderId.localeCompare(b.orderId)||a.revision-b.revision)){
 text(r.id,100);text(r.orderId,100);text(r.reference,100);text(r.contact,200);text(r.note,1000);text(r.actor,200);calendarDate(r.confirmedOn);if(ids.has(r.id))throw Error('ID konfirmasi berulang.');ids.add(r.id);const ref=JSON.stringify([r.orderId,r.reference.trim().toLowerCase()]);if(refs.has(ref))throw Error('Referensi konfirmasi sudah digunakan pada PO ini.');refs.add(ref);
 const o=orders.find(o=>o.id===r.orderId),previous=latest.get(r.orderId);if(!o||!['approved','closed'].includes(o.status)||!o.approvedAt||!Number.isFinite(Date.parse(o.approvedAt))||!Number.isFinite(Date.parse(r.at))||Date.parse(r.at)<Date.parse(o.approvedAt)||r.confirmedOn<new Date(Math.floor((Date.parse(o.approvedAt)+7*3600000)/86400000)*86400000).toISOString().slice(0,10))throw Error('Konfirmasi harus merujuk PO disetujui dan tanggal yang valid.');
 if(!Number.isInteger(r.revision)||r.revision!==(previous?.revision||0)+1||r.revision>1e6||previous&&Date.parse(r.at)<Date.parse(previous.at))throw Error('Urutan revisi konfirmasi tidak valid.');latest.set(r.orderId,r);
 }return latest;}
export function confirmPO(s:Replenishment,input:ConfirmationInput,actor:string,at:string):Replenishment{
 const records=s.confirmations||[],old=records.find(x=>x.id===input.id);if(old){if(['orderId','confirmedOn','reference','contact','note'].some(k=>old[k as keyof POConfirmation]!==input[k as keyof ConfirmationInput]))throw Error('ID konfirmasi dipakai untuk data berbeda.');return s;}
 const o=s.orders.find(o=>o.id===input.orderId);if(!o||o.status!=='approved'||o.received>=o.quantity)throw Error('Konfirmasi hanya untuk PO disetujui yang masih terbuka.');const revision=records.filter(x=>x.orderId===o.id).reduce((n,x)=>Math.max(n,x.revision),0)+1;
 const next=[...records,{...input,revision,actor,at}];validateConfirmations(next,s.orders);return {...s,confirmations:next};
}
