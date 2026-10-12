import {commissions,type Commission} from './mlm.ts';
import type {WarehouseState} from './warehouses.ts';
export type ReturnCorrection=Commission & {returnId:string;returnReference:string;originalId:string;at:string};
export function returnCorrections(sales:any[],w:WarehouseState):ReturnCorrection[]{
 const rows:ReturnCorrection[]=[],seen=new Set<string>();
 for(const sale of sales){if(seen.has(sale.id))continue;seen.add(sale.id);
  const originals=commissions([sale]),sources=w.documents.filter(d=>d.kind==='reserve'&&d.reference===sale.id),sourceIds=new Set(sources.map(d=>d.id));
  const returns=w.documents.filter(d=>d.kind==='return'&&sourceIds.has(d.sourceId||''));if(!returns.length)continue;
  const prices=new Map<string,number>();let gross=0;
  for(const item of sale.items||[]){if(!item.product_id||!Number.isSafeInteger(item.price)||item.price<=0)throw Error('Retur memerlukan harga snapshot produk.');if(prices.has(item.product_id)&&prices.get(item.product_id)!==item.price)throw Error('Harga produk ganda berbeda; rekonsiliasi diperlukan.');prices.set(item.product_id,item.price);gross+=item.price*(item.quantity||1);}
  if(gross!==sale.total)throw Error('Nilai snapshot retur tidak cocok dengan pesanan.');
  let remaining=gross;const returned=new Map<string,number>();const used=new Set<string>();
  // Append order in the stock ledger determines stable cumulative rounding.
  for(const doc of returns){if(used.has(doc.id))throw Error('Dokumen retur berulang.');used.add(doc.id);const source=sources.find(d=>d.id===doc.sourceId)!;
   if(source.status!=='shipped'||source.productId!==doc.productId||source.locationId!==sale.locationId||doc.locationId!==source.locationId)throw Error('Dokumen retur tidak cocok dengan pengiriman.');
   const price=prices.get(doc.productId);if(price===undefined||!Number.isSafeInteger(doc.quantity)||doc.quantity<=0)throw Error('Produk/jumlah retur tidak valid.');
   const qty=(returned.get(source.id)||0)+doc.quantity;if(qty>source.quantity)throw Error('Retur melampaui pengiriman.');returned.set(source.id,qty);
   const amount=price*doc.quantity,next=remaining-amount;if(next<0)throw Error('Retur melampaui nilai pesanan.');
   for(const c of originals)rows.push({...c,id:'return:'+doc.id+':'+c.id,base:-amount,amount:Math.round(next*c.rate/100)-Math.round(remaining*c.rate/100),returnId:doc.id,returnReference:doc.reference,originalId:c.id,at:doc.at});remaining=next;
  }
  for(const d of sources)if((returned.get(d.id)||0)!==d.returned)throw Error('Jumlah retur berbeda dari kartu stok.');
 }
 return rows;
}
export function correctionPositions(originals:Commission[],corrections:ReturnCorrection[],statuses:Record<string,string>,approvals:Record<string,string>){
 return [...new Set(originals.map(c=>c.beneficiary))].map(beneficiary=>{const gross=originals.filter(c=>c.beneficiary===beneficiary).reduce((s,c)=>s+c.amount,0),paid=originals.filter(c=>c.beneficiary===beneficiary&&statuses[c.id]==='paid').reduce((s,c)=>s+c.amount,0),rows=corrections.filter(c=>c.beneficiary===beneficiary),approved=rows.filter(c=>approvals[c.id]==='approved').reduce((s,c)=>s+c.amount,0),pending=rows.filter(c=>approvals[c.id]!=='approved').reduce((s,c)=>s+c.amount,0),target=gross+approved+pending,balance=gross+approved-paid;return {beneficiary,gross,paid,approved,pending,target,balance,payable:Math.max(balance,0),recovery:Math.max(-balance,0)};});
}
export function assertCommissionPayable(id:string,corrections:ReturnCorrection[]){if(corrections.some(c=>c.originalId===id))throw Error('Komisi terkait retur ditahan untuk rekonsiliasi; pembayaran bruto diblokir.');}
