export function shareProfit(revenue:number,cost:number,memberPercent:number){
 for(const n of [revenue,cost])if(!Number.isSafeInteger(n)||n<0)throw Error('Pendapatan dan biaya harus rupiah bulat non-negatif.');
 if(!Number.isFinite(memberPercent)||memberPercent<=0||memberPercent>=100||Math.abs(Math.round(memberPercent*100)-memberPercent*100)>1e-8)throw Error('Porsi anggota harus lebih dari 0 dan kurang dari 100, maksimal dua desimal.');
 const profit=revenue-cost;const distributable=Math.max(profit,0);const memberShare=Math.round(distributable*memberPercent/100);return {revenue,cost,profit,distributable,memberPercent,investorPercent:100-memberPercent,memberShare,investorShare:distributable-memberShare};
}
