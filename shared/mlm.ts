export type Graph = Record<string,string|null>;
export type Sale = {id:string;seller:string;total:number;upline:string[];policy:string};
export type Commission = {id:string;orderId:string;beneficiary:string;seller:string;level:number;rate:number;base:number;amount:number;policy:string};
export const POLICY='unilevel-demo-v1';
export const RATES=[5,3,2,1];
export function validateGraph(graph:Graph){
 for(const member of Object.keys(graph)){
  const seen=new Set<string>();let cursor:string|null=member;
  while(cursor!==null){if(!(cursor in graph))throw Error('Sponsor harus berasal dari tenant yang sama.');if(seen.has(cursor))throw Error('Hubungan sponsor tidak boleh membentuk siklus.');seen.add(cursor);cursor=graph[cursor];}
 }
 return graph;
}
export function ancestors(graph:Graph,member:string):string[]{validateGraph(graph);if(!(member in graph))throw Error('Anggota tidak ditemukan.');const list:string[]=[];let parent=graph[member];while(parent!==null){list.push(parent);parent=graph[parent];}return list;}
export function changeSponsor(graph:Graph,member:string,sponsor:string|null):Graph{if(!(member in graph))throw Error('Anggota tidak ditemukan.');return validateGraph({...graph,[member]:sponsor});}
export function descendants(graph:Graph,member:string){validateGraph(graph);return Object.keys(graph).filter(id=>id!==member&&ancestors(graph,id).includes(member));}
export function commissions(sales:Sale[]):Commission[]{const used=new Set<string>();const result:Commission[]=[];
 for(const sale of sales){
  if(used.has(sale.id))continue;used.add(sale.id);
  if(sale.policy!==POLICY)throw Error('Versi kebijakan komisi tidak dikenali.');
  if(!Number.isSafeInteger(sale.total)||sale.total<0)throw Error('Nilai transaksi harus rupiah bulat non-negatif.');
  const recipients=[sale.seller,...sale.upline.slice(0,3)];if(new Set(recipients).size!==recipients.length)throw Error('Snapshot sponsor tidak valid.');
  recipients.forEach((beneficiary,level)=>result.push({id:`${sale.id}:${beneficiary}:${level}`,orderId:sale.id,beneficiary,seller:sale.seller,level,rate:RATES[level],base:sale.total,amount:Math.round(sale.total*RATES[level]/100),policy:sale.policy}));
 }
 return result;
}
export function volume(sales:Sale[],member:string){const unique=[...new Map(sales.map(s=>[s.id,s])).values()];const personal=unique.filter(s=>s.seller===member).reduce((a,s)=>a+s.total,0);const downline=unique.filter(s=>s.seller!==member&&s.upline.includes(member)).reduce((a,s)=>a+s.total,0);return {personal,downline,group:personal+downline};}
export function transition(current:string,action:string){if(current==='pending'&&action==='approve')return 'approved';if(current==='approved'&&action==='pay')return 'paid';throw Error('Urutan status komisi tidak valid.');}
