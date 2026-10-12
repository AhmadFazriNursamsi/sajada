// Locale-independent money formatting. Intl.NumberFormat('id-ID') output differs between
// the server runtime (workerd ICU) and browsers ("Rp 0" vs "Rp0"), which breaks hydration.
const SYMBOL:Record<string,string>={IDR:'Rp',USD:'US$',SGD:'SGD'};
export function formatMoney(value:number,currency='IDR',fractionDigits=currency==='IDR'?0:2):string{
 const [int,frac]=Math.abs(value).toFixed(fractionDigits).split('.');
 const sign=value<0&&/[1-9]/.test(int+(frac||''))?'-':'';
 return sign+(SYMBOL[currency]??currency)+' '+int.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(frac?','+frac:'');
}
