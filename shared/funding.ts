export type Investor={id:string;name:string;code:string};
export type Funding={investorId:string;investorName:string;amount:number};
export function validateFunding(rows:Funding[],investors:Investor[]){if(!rows.length)throw Error('Alokasi investor belum diisi.');const seen=new Set();let sum=0;for(const row of rows){if(!investors.some(i=>i.id===row.investorId))throw Error('Investor tidak ditemukan dalam tenant ini.');if(seen.has(row.investorId))throw Error('Investor tidak boleh berulang dalam satu alokasi.');seen.add(row.investorId);if(!Number.isSafeInteger(row.amount)||row.amount<=0)throw Error('Nominal pendanaan harus rupiah bulat positif.');sum+=row.amount;}if(sum!==12500000)throw Error('Total alokasi wajib tepat Rp12.500.000 per anggota.');return rows.map(r=>({...r,investorName:investors.find(i=>i.id===r.investorId)!.name}));}
export function proportional(total:number,funding:Funding[]){if(!Number.isSafeInteger(total)||total<0)throw Error('Nilai pembagian tidak valid.');if(!funding.length)throw Error('Snapshot pendanaan tidak tersedia.');const weight=funding.reduce((s,f)=>s+f.amount,0);if(weight!==12500000||funding.some(f=>!Number.isSafeInteger(f.amount)||f.amount<=0)||new Set(funding.map(f=>f.investorId)).size!==funding.length)throw Error('Snapshot pendanaan tidak valid.');const denominator=BigInt(weight);const shares=funding.map(f=>{const raw=BigInt(total)*BigInt(f.amount);return {...f,share:Number(raw/denominator),remainder:raw%denominator};});let remaining=total-shares.reduce((s,f)=>s+f.share,0);const ranked=[...shares].sort((a,b)=>a.remainder===b.remainder?a.investorId.localeCompare(b.investorId):a.remainder>b.remainder?-1:1);for(const r of ranked){if(!remaining)break;r.share++;remaining--;}return shares.map(({remainder,...r})=>r);}
export function splitInvestorReceipt(capitalReturned:number,profitShare:number,funding:Funding[]){const capital=proportional(capitalReturned,funding),profit=proportional(profitShare,funding);return capital.map(c=>({investorId:c.investorId,investorName:c.investorName,funding:c.amount,capitalReturned:c.share,profitShare:profit.find(p=>p.investorId===c.investorId)!.share,total:c.share+profit.find(p=>p.investorId===c.investorId)!.share}));}
// Replay settled reports chronologically; cap each investor's returned principal.
export function investorReceipts(reports:any[]){
 const returned=new Map<string,number>(),snapshot=new Map<string,string>();const result:any[]=[];
 for(const report of reports.filter(r=>r.status==='settled'&&r.funding?.length).slice().sort((a,b)=>a.period.localeCompare(b.period)||a.id.localeCompare(b.id))){
  const fingerprint=JSON.stringify(report.funding.map((f:Funding)=>[f.investorId,f.amount]).sort((a:any,b:any)=>String(a[0]).localeCompare(String(b[0]))));
  if(snapshot.has(report.member)&&snapshot.get(report.member)!==fingerprint)throw Error('Snapshot pendanaan berubah dalam riwayat anggota.');snapshot.set(report.member,fingerprint);
  const rows=splitInvestorReceipt(report.capitalReturned,report.investorProfitShare,report.funding);
  let excess=0;
  for(const row of rows){const key=JSON.stringify([report.member,row.investorId]),available=row.funding-(returned.get(key)||0);if(row.capitalReturned>available){excess+=row.capitalReturned-available;row.capitalReturned=available;}}
  // Redistribute rounding overflow only to investors with remaining principal.
  for(const row of rows.slice().sort((a,b)=>a.investorId.localeCompare(b.investorId))){if(!excess)break;const key=JSON.stringify([report.member,row.investorId]),capacity=row.funding-(returned.get(key)||0)-row.capitalReturned;const delta=Math.min(capacity,excess);row.capitalReturned+=delta;excess-=delta;}
  if(excess)throw Error('Pengembalian modal investor melampaui kontribusi.');
  for(const row of rows){const key=JSON.stringify([report.member,row.investorId]);returned.set(key,(returned.get(key)||0)+row.capitalReturned);result.push({...row,total:row.capitalReturned+row.profitShare,member:report.member,period:report.period,reportId:report.id});}
 }
 return result;
}
