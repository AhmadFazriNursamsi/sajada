import {INITIAL_PRINCIPAL,stateFromReports,type TierReport} from './tiered-sharing.ts';
export function investorSummary(names:string[],capital:Record<string,any>,reports:TierReport[],period=''){
 const unique=[...new Set(names)];const active=unique.filter(n=>capital[n]?.status==='disbursed');
 const settled=reports.filter(r=>r.status==='settled'&&active.includes(r.member)&&(!period||r.period===period));
 const members=unique.map(member=>{const funded=active.includes(member);const state=funded?stateFromReports(reports,member):{remainingPrincipal:0,postRecoveryProfit:0};const selected=settled.filter(r=>r.member===member);return {member,funded,allocation:INITIAL_PRINCIPAL,remaining:state.remainingPrincipal,returned:funded?INITIAL_PRINCIPAL-state.remainingPrincipal:0,cumulative:state.postRecoveryProfit,memberShare:selected.reduce((s,r)=>s+r.memberShare,0),investorShare:selected.reduce((s,r)=>s+r.investorShare,0),capitalReturned:selected.reduce((s,r)=>s+r.capitalReturned,0),investorProfit:selected.reduce((s,r)=>s+r.investorProfitShare,0)};});
 const total=(key:'remaining'|'returned'|'memberShare'|'investorShare'|'capitalReturned'|'investorProfit')=>members.reduce((s,m)=>s+m[key],0);
 return {members,settled,allocated:unique.length*INITIAL_PRINCIPAL,funded:active.length*INITIAL_PRINCIPAL,unfunded:(unique.length-active.length)*INITIAL_PRINCIPAL,remaining:total('remaining'),returned:total('returned'),memberShare:total('memberShare'),investorShare:total('investorShare'),capitalReturned:total('capitalReturned'),investorProfit:total('investorProfit')};
}
