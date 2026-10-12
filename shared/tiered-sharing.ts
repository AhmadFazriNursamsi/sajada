export const TIER_POLICY='sajada-tiered-v1';
export const INITIAL_PRINCIPAL=12500000;
export type TierState={remainingPrincipal:number;postRecoveryProfit:number};
export type Segment={label:string;profit:number;memberPercent:number;investorPercent:number;memberShare:number;investorShare:number;capitalReturned:number};
export const initialTierState=():TierState=>({remainingPrincipal:INITIAL_PRINCIPAL,postRecoveryProfit:0});
function amount(n:number){if(!Number.isSafeInteger(n)||n<0||n>1000000000000)throw Error('Nominal harus rupiah bulat antara 0 dan 1 triliun.');}
export function allocateTiered(profit:number,state:TierState){
 amount(profit);amount(state.remainingPrincipal);amount(state.postRecoveryProfit);
 if(state.remainingPrincipal>INITIAL_PRINCIPAL||(state.remainingPrincipal>0&&state.postRecoveryProfit>0))throw Error('Saldo tahapan tidak valid.');
 let left=profit,remaining=state.remainingPrincipal,cumulative=state.postRecoveryProfit;
 const segments:Segment[]=[];
 if(remaining>0&&left>0){
  const chunk=Math.min(left,Math.ceil(remaining*100/80));
  const investor=Math.min(remaining,Math.round(chunk*80/100));
  segments.push({label:'Pengembalian modal',profit:chunk,memberPercent:20,investorPercent:80,memberShare:chunk-investor,investorShare:investor,capitalReturned:investor});
  remaining-=investor;left-=chunk;
 }
 const bands=[{limit:10000000,rate:25,label:'Keuntungan setelah balik modal: 0–10 jt'},{limit:50000000,rate:30,label:'Keuntungan setelah balik modal: 10–50 jt'},{limit:100000000,rate:50,label:'Keuntungan setelah balik modal: 50–100 jt'},{limit:Infinity,rate:60,label:'Keuntungan setelah balik modal: di atas 100 jt'}];
 for(const band of bands){if(left===0)break;if(cumulative>=band.limit)continue;const chunk=Math.min(left,band.limit-cumulative);const member=Math.round(chunk*band.rate/100);segments.push({label:band.label,profit:chunk,memberPercent:band.rate,investorPercent:100-band.rate,memberShare:member,investorShare:chunk-member,capitalReturned:0});left-=chunk;cumulative+=chunk;}
 amount(cumulative);
 const memberShare=segments.reduce((s,r)=>s+r.memberShare,0),investorShare=segments.reduce((s,r)=>s+r.investorShare,0),capitalReturned=state.remainingPrincipal-remaining;
 return {policy:TIER_POLICY,profit,segments,memberShare,investorShare,capitalReturned,investorProfitShare:investorShare-capitalReturned,before:{...state},after:{remainingPrincipal:remaining,postRecoveryProfit:cumulative}};
}
export type TierReport=ReturnType<typeof allocateTiered>&{funding?:{investorId:string;investorName:string;amount:number}[];id:string;member:string;period:string;reference:string;revenue:number;cost:number;status:'pending'|'settled';settlementRef?:string};
export function stateFromReports(reports:TierReport[],member:string):TierState{const rows=reports.filter(r=>r.member===member&&r.status==='settled').sort((a,b)=>a.period.localeCompare(b.period));return rows.length?{...rows[rows.length-1].after}:initialTierState();}
export function validatePeriod(reports:TierReport[],member:string,period:string){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw Error('Periode tidak valid.');const own=reports.filter(r=>r.member===member);if(own.some(r=>r.status==='pending'))throw Error('Selesaikan atau hapus draf anggota ini terlebih dahulu.');if(own.some(r=>r.period>=period))throw Error('Periode harus lebih baru dari laporan anggota sebelumnya.');}
export function settleReport(reports:TierReport[],id:string,reference:string){if(!reference.trim())throw Error('Referensi pembagian demo wajib diisi.');const row=reports.find(r=>r.id===id);if(!row||row.status!=='pending')throw Error('Draf tidak ditemukan atau sudah diselesaikan.');return reports.map(r=>r.id===id?{...r,status:'settled' as const,settlementRef:reference.trim()}:r);}
