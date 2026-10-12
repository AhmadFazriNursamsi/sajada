export const LEVELS=['province','regency','district','village'] as const;
export type Region={id:string;name:string;level:typeof LEVELS[number];parentId:string|null;code?:string};
export type RegionData={regions:Region[];assignments:Record<string,string>};
export const LEVEL_LABELS:Record<string,string>={province:'Provinsi',regency:'Kabupaten / kota',district:'Kecamatan',village:'Kelurahan / desa'};
export const seedRegions=():Region[]=>[
{id:'demo-jb',name:'Jawa Barat',level:'province',parentId:null},
{id:'demo-bandung',name:'Kota Bandung',level:'regency',parentId:'demo-jb'},
{id:'demo-coblong',name:'Coblong',level:'district',parentId:'demo-bandung'},
{id:'demo-dago',name:'Dago',level:'village',parentId:'demo-coblong'},
{id:'demo-bogor',name:'Kota Bogor',level:'regency',parentId:'demo-jb'},
{id:'demo-bogortengah',name:'Bogor Tengah',level:'district',parentId:'demo-bogor'},
{id:'demo-pabaton',name:'Pabaton',level:'village',parentId:'demo-bogortengah'}];
export function validateRegions(regions:Region[]){const ids=new Set<string>();const codes=new Set<string>();const siblings=new Set<string>();for(const r of regions){if(!r.id||!r.name.trim()||!LEVELS.includes(r.level))throw Error('Data wilayah tidak lengkap.');if(ids.has(r.id))throw Error('ID wilayah berulang.');ids.add(r.id);if(r.code){if(!/^\d{2}$/.test(r.code))throw Error('Kode wilayah lokal wajib 2 digit.');const codeKey=JSON.stringify([r.parentId,r.code]);if(codes.has(codeKey))throw Error('Kode wilayah pada induk yang sama sudah digunakan.');codes.add(codeKey);}const key=JSON.stringify([r.parentId,r.name.trim().toLocaleLowerCase()]);if(siblings.has(key))throw Error('Nama wilayah pada induk yang sama sudah ada.');siblings.add(key);const rank=LEVELS.indexOf(r.level);if(rank===0){if(r.parentId!==null)throw Error('Provinsi tidak boleh memiliki induk.');}else{const p=regions.find(p=>p.id===r.parentId);if(!p||LEVELS.indexOf(p.level)!==rank-1)throw Error('Induk wilayah harus tepat satu tingkat di atas.');}}return regions;}
export function regionPath(regions:Region[],id:string){const result:Region[]=[];const seen=new Set<string>();let r=regions.find(r=>r.id===id);while(r){if(seen.has(r.id))throw Error('Siklus wilayah ditemukan.');seen.add(r.id);result.unshift(r);r=regions.find(p=>p.id===r!.parentId);}return result;}
export function assignRegion(data:RegionData,member:string,regionId:string,names:string[]){if(!names.includes(member))throw Error('Anggota tidak ditemukan dalam tenant.');if(!data.regions.some(r=>r.id===regionId&&r.level==='village'))throw Error('Penempatan anggota harus pada kelurahan/desa.');return {...data,assignments:{...data.assignments,[member]:regionId}};}
export function regionMembers(data:RegionData,regionId:string,names:string[]){return [...new Set(names)].filter(n=>data.assignments[n]&&regionPath(data.regions,data.assignments[n]).some(r=>r.id===regionId));}
export function removeRegion(data:RegionData,id:string){if(data.regions.some(r=>r.parentId===id))throw Error('Wilayah masih memiliki turunan.');if(Object.values(data.assignments).includes(id))throw Error('Wilayah masih digunakan anggota.');return {...data,regions:data.regions.filter(r=>r.id!==id)};}
