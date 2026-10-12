export function isoDate(value:string):string{
 if(/^\d{4}-\d{2}-\d{2}/.test(value||''))return value.slice(0,10);
 const parts=(value||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);return parts?`${parts[3]}-${parts[2].padStart(2,'0')}-${parts[1].padStart(2,'0')}`:'';
}
export function summarize(orders:any[],tenant:string,month:string,paid:string[]){
 const scoped=[...new Map(orders.filter(o=>o.tenant===tenant&&!o.cancelledAt).map(o=>[o.id,o])).values()];
 const selected=scoped.filter(o=>isoDate(o.date).startsWith(month));
 const days=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate();
 const daily=Array.from({length:days},(_,i)=>({day:i+1,total:0}));
 const products:Record<string,{name:string;units:number;total:number}>={},members:Record<string,{name:string;orders:number;total:number}>={};
 for(const o of selected){const day=Number(isoDate(o.date).slice(8,10));if(daily[day-1])daily[day-1].total+=o.total;
  const seller=o.seller||'Tanpa atribusi';members[seller]??={name:seller,orders:0,total:0};members[seller].orders++;members[seller].total+=o.total;
  for(const item of o.items||[]){const quantity=item.quantity||1;products[item.name]??={name:item.name,units:0,total:0};products[item.name].units+=quantity;products[item.name].total+=item.price*quantity;}
 }
 const total=selected.reduce((s,o)=>s+o.total,0),receivables=scoped.filter(o=>!paid.includes(o.id)).reduce((s,o)=>s+o.total,0);
 return {selected,total,count:selected.length,average:selected.length?total/selected.length:0,receivables,daily,products:Object.values(products).sort((a,b)=>b.total-a.total),members:Object.values(members).sort((a,b)=>b.total-a.total),paidCount:selected.filter(o=>paid.includes(o.id)).length};
}
export function previousMonth(month:string){const [y,m]=month.split('-').map(Number);return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,'0')}`;}
