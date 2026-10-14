// Sample data for the tests only. The app itself starts empty and reads everything from the
// database; nothing here is imported by app/, components/ or lib/.
import {addLocation,applyStock,emptyWarehouses,type WarehouseState} from './warehouses.ts';
import type {Region} from './regions.ts';
import type {Product} from './inventory.ts';
// Demo starting data for each koperasi (tenant); the database seed uses the same values.
export const people:[string,string,string,string,number][]=[['Siti Rahmawati','SR','Bandung','Gold',12500000],['Budi Santoso','BS','Jakarta Selatan','Silver',8200000],['Dewi Lestari','DL','Bogor','Gold',10800000],['Ahmad Hidayat','AH','Bekasi','Bronze',4600000],['Rina Wulandari','RW','Bandung','Silver',6900000]];
export const tenantPeople=(tenant:string)=>tenant==='Sajada Jawa Barat'?people.filter(p=>p[2]!=='Jakarta Selatan'):tenant==='Sajada DKI Jakarta'?people.filter(p=>p[2]==='Jakarta Selatan'):people;
export const initialProducts:Product[]=[{name:'Kopi Arabika Nusantara',category:'Makanan & minuman',price:85000,emoji:'☕',bg:'#e9dfd1',stock:128},{name:'Tas Anyaman Lestari',category:'Kerajinan',price:175000,emoji:'👜',bg:'#ede8d9',stock:42},{name:'Madu Hutan Murni',category:'Kesehatan',price:125000,emoji:'🍯',bg:'#f7e9ce',stock:86},{name:'Paket Beras Organik 5 kg',category:'Kebutuhan pokok',price:95000,emoji:'🌾',bg:'#e3eadc',stock:215}].map((p,i)=>({...p,id:'SKU-'+(i+1),sku:'SJ-00'+(i+1),active:true}));
export const TENANTS=['Sajada Nasional','Sajada Jawa Barat','Sajada DKI Jakarta'] as const;
export function seedWarehouses(products:{id:string;stock:number}[],tenant:string):WarehouseState{
 let s=addLocation(emptyWarehouses(),{id:'depot-awal',name:'Depot provinsi • '+tenant,kind:'province',parentId:null,regionId:'Wilayah demo belum dipetakan',memberId:null});
 for(const p of products)if(p.stock>0)s=applyStock(s,{id:'opening-'+p.id,kind:'receive',locationId:'depot-awal',productId:p.id,quantity:p.stock,reference:'Migrasi saldo demo sebelumnya'},'Migrasi demo',new Date().toISOString());
 return s;
}
export const seedRegions=():Region[]=>[
{id:'demo-jb',name:'Jawa Barat',level:'province',parentId:null},
{id:'demo-bandung',name:'Kota Bandung',level:'regency',parentId:'demo-jb'},
{id:'demo-coblong',name:'Coblong',level:'district',parentId:'demo-bandung'},
{id:'demo-dago',name:'Dago',level:'village',parentId:'demo-coblong'},
{id:'demo-bogor',name:'Kota Bogor',level:'regency',parentId:'demo-jb'},
{id:'demo-bogortengah',name:'Bogor Tengah',level:'district',parentId:'demo-bogor'},
{id:'demo-pabaton',name:'Pabaton',level:'village',parentId:'demo-bogortengah'}];
