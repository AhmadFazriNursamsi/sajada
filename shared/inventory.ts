export type Product={id:string;sku:string;name:string;category:string;price:number;emoji:string;bg:string;stock:number;active:boolean};
export type StockMove={id:string;productId:string;productName:string;delta:number;after:number;reference:string;date:string};
export function validateProduct(p:Product,existing:Product[]){
 if(!p.id||!p.sku.trim()||!p.name.trim())throw Error('SKU dan nama produk wajib diisi.');
 if(existing.some(e=>e.id!==p.id&&e.sku.toLowerCase()===p.sku.toLowerCase()))throw Error('SKU sudah digunakan di tenant ini.');
 if(!Number.isSafeInteger(p.price)||p.price<=0)throw Error('Harga harus rupiah bulat positif.');
 if(!Number.isSafeInteger(p.stock)||p.stock<0)throw Error('Stok harus bilangan bulat non-negatif.');
 return p;
}
export function adjustStock(products:Product[],productId:string,delta:number){if(!Number.isSafeInteger(delta)||delta===0)throw Error('Perubahan stok harus bilangan bulat, bukan nol.');const p=products.find(p=>p.id===productId);if(!p)throw Error('Produk tidak ditemukan.');const stock=p.stock+delta;if(!Number.isSafeInteger(stock)||stock<0)throw Error('Penyesuaian membuat stok negatif atau melebihi batas.');return products.map(p=>p.id===productId?{...p,stock}:p);}
export function consumeStock(products:Product[],cart:number[]){if(cart.length===0)throw Error('Keranjang kosong.');const count=new Map<number,number>();for(const i of cart){if(!Number.isInteger(i)||!products[i]||!products[i].active)throw Error('Produk tidak tersedia.');count.set(i,(count.get(i)||0)+1);}
 for(const [i,quantity]of count)if(quantity>products[i].stock)throw Error('Stok '+products[i].name+' tidak mencukupi.');
 const total=cart.reduce((s,i)=>s+products[i].price,0);if(!Number.isSafeInteger(total))throw Error('Nilai pesanan terlalu besar.');
 return {products:products.map((p,i)=>({...p,stock:p.stock-(count.get(i)||0)})),items:[...count].map(([i,quantity])=>({product_id:products[i].id,name:products[i].name,price:products[i].price,quantity})),total};
}
