export type LocationKind='province'|'regency'|'district'|'member';
export type Location={id:string;name:string;kind:LocationKind;parentId:string|null;regionId:string;memberId:string|null};
export type Balance={locationId:string;productId:string;onHand:number;reserved:number;minimum:number};
export type InventoryDoc={id:string;kind:string;locationId:string;toId?:string;productId:string;quantity:number;reference:string;sourceId?:string;status:'posted'|'transit'|'received'|'reserved'|'shipped'|'cancelled';returned:number;actor:string;at:string};
export type Movement={id:string;documentId:string;locationId:string;productId:string;physical:number;reserved:number;after:number;reservedAfter:number;actor:string;at:string};
export type WarehouseState={version:1;locations:Location[];balances:Balance[];documents:InventoryDoc[];movements:Movement[];requests:{id:string;payload:string}[]};
export type StockAction={id:string;kind:'receive'|'transfer'|'accept'|'reserve'|'ship'|'release'|'return'|'count'|'minimum';locationId?:string;toId?:string;productId?:string;quantity?:number;reference:string;sourceId?:string};
export function emptyWarehouses():WarehouseState{return {version:1,locations:[],balances:[],documents:[],movements:[],requests:[]};}
function requireText(s:unknown,label:string){if(typeof s!=='string'||!s.trim()||s.length>200)throw Error(label+' wajib diisi (maks. 200 karakter).');}
function units(n:unknown,zero=false){if(typeof n!=='number'||!Number.isSafeInteger(n)||n<(zero?0:1)||n>1e9)throw Error('Jumlah harus unit bulat '+(zero?'non-negatif':'positif')+' dan maksimal 1 miliar.');}
export function addLocation(state:WarehouseState,location:Location):WarehouseState{
 requireText(location.id,'ID lokasi');requireText(location.name,'Nama lokasi');requireText(location.regionId,'Wilayah');
 if(state.locations.some(l=>l.id===location.id||l.name.toLowerCase()===location.name.toLowerCase()))throw Error('Lokasi sudah terdaftar.');
 const levels:LocationKind[]=['province','regency','district','member'];const rank=levels.indexOf(location.kind);if(rank<0)throw Error('Jenis lokasi tidak valid.');
 if(rank===0){if(location.parentId)throw Error('Depot provinsi tidak mempunyai induk.');}else{const parent=state.locations.find(l=>l.id===location.parentId);if(!parent||parent.kind!==levels[rank-1])throw Error('Pilih induk satu tingkat di atas lokasi.');}
 if(location.kind==='member'){requireText(location.memberId,'Anggota');if(state.locations.some(l=>l.memberId===location.memberId))throw Error('Anggota sudah mempunyai tempat stok.');}else if(location.memberId)throw Error('Depot bukan lokasi anggota.');
 return {...state,locations:[...state.locations,{...location}]};
}
export function stockAt(state:WarehouseState,locationId:string,productId:string):Balance{return state.balances.find(b=>b.locationId===locationId&&b.productId===productId)||{locationId,productId,onHand:0,reserved:0,minimum:5};}
export function available(state:WarehouseState,locationId:string,productId:string){const b=stockAt(state,locationId,productId);return b.onHand-b.reserved;}
export function totalAvailable(state:WarehouseState,productId:string){return state.balances.filter(b=>b.productId===productId).reduce((s,b)=>s+b.onHand-b.reserved,0);}
export function applyStock(original:WarehouseState,action:StockAction,actor:string,at:string):WarehouseState{
 requireText(actor,'Pelaksana');requireText(action.id,'ID operasi');requireText(action.reference,'Referensi atau alasan');
 const payload=JSON.stringify([action.kind,action.locationId||null,action.toId||null,action.productId||null,action.quantity??null,action.reference,action.sourceId||null]);
 const replay=original.requests.find(r=>r.id===action.id);if(replay){if(replay.payload!==payload)throw Error('ID operasi dipakai untuk data berbeda.');return original;}
 const s:WarehouseState=structuredClone(original);const known=(id?:string)=>{if(!s.locations.some(l=>l.id===id))throw Error('Lokasi tidak ditemukan pada tenant ini.');return id!;};
 function change(locationId:string,productId:string,physical:number,reserved:number){const b=stockAt(s,locationId,productId);const next={...b,onHand:b.onHand+physical,reserved:b.reserved+reserved};units(next.onHand,true);units(next.reserved,true);if(next.reserved>next.onHand)throw Error('Stok tersedia tidak cukup atau hasil opname di bawah reservasi.');const ix=s.balances.findIndex(x=>x.locationId===locationId&&x.productId===productId);if(ix<0)s.balances.push(next);else s.balances[ix]=next;s.movements.push({id:action.id+':'+s.movements.length,documentId:action.id,locationId,productId,physical,reserved,after:next.onHand,reservedAfter:next.reserved,actor,at});}
 let doc:InventoryDoc;
 if(['accept','ship','release','return'].includes(action.kind)){
  const source=s.documents.find(d=>d.id===action.sourceId);if(!source)throw Error('Dokumen asal tidak ditemukan.');
  if(action.kind==='accept'){if(source.kind!=='transfer'||source.status!=='transit')throw Error('Transfer tidak dalam perjalanan.');change(known(source.toId),source.productId,source.quantity,0);source.status='received';}
  if(action.kind==='ship'||action.kind==='release'){if(source.kind!=='reserve'||source.status!=='reserved')throw Error('Reservasi sudah diproses.');change(source.locationId,source.productId,action.kind==='ship'?-source.quantity:0,-source.quantity);source.status=action.kind==='ship'?'shipped':'cancelled';}
  if(action.kind==='return'){units(action.quantity);if(source.kind!=='reserve'||source.status!=='shipped'||source.returned+action.quantity!>source.quantity)throw Error('Retur melebihi pengiriman atau asal belum dikirim.');change(source.locationId,source.productId,action.quantity!,0);source.returned+=action.quantity!;}
  doc={id:action.id,kind:action.kind,locationId:action.kind==='accept'?source.toId!:source.locationId,productId:source.productId,quantity:action.kind==='return'?action.quantity!:source.quantity,reference:action.reference,sourceId:source.id,status:'posted',returned:0,actor,at};
 }else{
  const locationId=known(action.locationId);requireText(action.productId,'Produk');units(action.quantity,action.kind==='count'||action.kind==='minimum');
  const productId=action.productId!,q=action.quantity!;doc={id:action.id,kind:action.kind,locationId,productId,quantity:q,reference:action.reference,status:'posted',returned:0,actor,at};
  switch(action.kind){
   case 'receive':change(locationId,productId,q,0);break;
   case 'transfer':{const toId=known(action.toId);if(toId===locationId)throw Error('Asal dan tujuan transfer harus berbeda.');change(locationId,productId,-q,0);doc.toId=toId;doc.status='transit';break;}
   case 'reserve':change(locationId,productId,0,q);doc.status='reserved';break;
   case 'count':change(locationId,productId,q-stockAt(s,locationId,productId).onHand,0);break;
   case 'minimum':{const b=stockAt(s,locationId,productId);const ix=s.balances.findIndex(x=>x.locationId===locationId&&x.productId===productId);if(ix<0)s.balances.push({...b,minimum:q});else s.balances[ix]={...b,minimum:q};break;}
   default:throw Error('Operasi persediaan tidak dikenal.');
  }
 }
 s.documents.push(doc);s.requests.push({id:action.id,payload});return s;
}
export function validateWarehouses(value:unknown,products:{id:string;stock?:number}[],members:string[]){
 const s=value as WarehouseState;if(!s||s.version!==1||!['locations','balances','documents','movements','requests'].every(k=>Array.isArray((s as any)[k])))throw Error('Format inventori tidak valid.');
 let tree=emptyWarehouses();for(const l of s.locations){tree=addLocation(tree,l);if(l.kind==='member'&&!members.includes(l.memberId!))throw Error('Anggota lokasi tidak ditemukan.');}
 const keys=new Set<string>();for(const b of s.balances){const key=b.locationId+'|'+b.productId;if(keys.has(key))throw Error('Saldo lokasi berulang.');keys.add(key);if(!s.locations.some(l=>l.id===b.locationId)||!products.some(p=>p.id===b.productId))throw Error('Referensi saldo tidak valid.');units(b.onHand,true);units(b.reserved,true);units(b.minimum,true);if(b.reserved>b.onHand)throw Error('Reservasi melebihi stok.');}
 const ids=new Set<string>();for(const d of s.documents){if(ids.has(d.id))throw Error('Dokumen persediaan berulang.');ids.add(d.id);if(!products.some(p=>p.id===d.productId)||!s.locations.some(l=>l.id===d.locationId))throw Error('Referensi dokumen tidak valid.');units(d.quantity,true);units(d.returned,true);if(d.returned>d.quantity)throw Error('Retur berlebih.');}
 for(const b of s.balances){const moves=s.movements.filter(m=>m.locationId===b.locationId&&m.productId===b.productId);if(moves.reduce((n,m)=>n+m.physical,0)!==b.onHand||moves.reduce((n,m)=>n+m.reserved,0)!==b.reserved)throw Error('Kartu stok tidak cocok dengan saldo.');if(s.documents.filter(d=>d.kind==='reserve'&&d.status==='reserved'&&d.locationId===b.locationId&&d.productId===b.productId).reduce((n,d)=>n+d.quantity,0)!==b.reserved)throw Error('Reservasi tidak cocok dengan dokumen.');}
 for(const m of s.movements)if(!ids.has(m.documentId)||!keys.has(m.locationId+'|'+m.productId)||!Number.isSafeInteger(m.physical)||!Number.isSafeInteger(m.reserved))throw Error('Mutasi tidak valid.');
 const requestIds=new Set<string>();let replay:WarehouseState={...emptyWarehouses(),locations:structuredClone(s.locations)};
 for(const r of s.requests){requireText(r.id,'ID permintaan');if(requestIds.has(r.id))throw Error('Permintaan stok berulang.');requestIds.add(r.id);const doc=s.documents.find(d=>d.id===r.id);if(!doc)throw Error('Permintaan tanpa dokumen stok.');let fields:any;try{fields=JSON.parse(r.payload);}catch{throw Error('Payload stok tidak valid.');}if(!Array.isArray(fields)||fields.length!==7)throw Error('Payload stok tidak valid.');const [kind,locationId,toId,productId,quantity,reference,sourceId]=fields;const action:StockAction={id:r.id,kind,reference};if(locationId!==null)action.locationId=locationId;if(toId!==null)action.toId=toId;if(productId!==null)action.productId=productId;if(quantity!==null)action.quantity=quantity;if(sourceId!==null)action.sourceId=sourceId;if(!Number.isFinite(Date.parse(doc.at)))throw Error('Waktu stok tidak valid.');replay=applyStock(replay,action,doc.actor,doc.at);}
 if(requestIds.size!==s.documents.length)throw Error('Dokumen tanpa permintaan stok.');
 const canonical=(rows:any[],key:(x:any)=>string)=>JSON.stringify([...rows].sort((a,b)=>key(a).localeCompare(key(b))));
 if(canonical(replay.balances,b=>b.locationId+'|'+b.productId)!==canonical(s.balances,b=>b.locationId+'|'+b.productId)||canonical(replay.documents,d=>d.id)!==canonical(s.documents,d=>d.id)||canonical(replay.movements,m=>m.id)!==canonical(s.movements,m=>m.id))throw Error('Riwayat stok tidak cocok dengan pemutaran ulang dokumen.');
 return s;
}
