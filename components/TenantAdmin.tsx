'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {Pencil,Plus} from 'lucide-react';
import {createTenantAction,listTenantsAction,renameTenantAction} from '../app/actions/users';
import type {TenantRow} from '../lib/server/tenants';

// Pengaturan → Koperasi (admin only; the server checks again). A new koperasi starts empty.
export default function TenantAdmin({notify,onRenamed}:{notify:(s:string)=>void;onRenamed:(from:string,to:string)=>void}){
 const router=useRouter();
 const [rows,setRows]=useState<TenantRow[]|null>(null),[edit,setEdit]=useState<{id?:string;name:string;from?:string}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function refresh(){const r=await listTenantsAction();if(r.ok)setRows(r.data);else setError(r.error);}
 useEffect(()=>{let live=true;listTenantsAction().then(r=>{if(!live)return;if(r.ok)setRows(r.data);else setError(r.error);});return()=>{live=false};},[]);
 async function save(){if(!edit)return;setBusy(true);setError('');const r=edit.id?await renameTenantAction(edit.id,edit.name):await createTenantAction(edit.name);setBusy(false);
  if(!r.ok){setError(r.error);return;}
  const name=edit.name.trim().replace(/\s+/g,' ');if(edit.id&&edit.from)onRenamed(edit.from,name);
  notify(edit.id?'Nama koperasi diperbarui.':'Koperasi dibuat. Beri akses kepada pengguna di Pengguna & akses.');setEdit(null);refresh();router.refresh();}
 return <section className="panel settings useradmin"><div className="sectiontools"><div><h2>Koperasi</h2><p>Setiap koperasi menyimpan anggota, katalog, depot, transaksi dan akuntansinya sendiri. Koperasi baru dimulai kosong.</p></div><button className="primary" onClick={()=>{setError('');setEdit({name:''})}}><Plus size={16}/>Tambah koperasi</button></div>
  {edit&&<form className="userform" onSubmit={e=>{e.preventDefault();save()}}><h2>{edit.id?'Ganti nama koperasi':'Koperasi baru'}</h2><div className="userfields"><label>Nama koperasi<input value={edit.name} required minLength={3} maxLength={100} autoFocus onChange={e=>setEdit({...edit,name:e.target.value})}/></label></div>
   {error&&<p className="formerror" role="alert">{error}</p>}
   <div className="formactions"><button type="button" className="secondary" onClick={()=>{setEdit(null);setError('')}}>Batal</button><button className="primary" disabled={busy}>{busy?'Menyimpan…':edit.id?'Simpan nama':'Buat koperasi'}</button></div></form>}
  {error&&!edit&&<p className="formerror" role="alert">{error}</p>}
  {!rows?<p className="muted">Memuat koperasi…</p>:!rows.length?<p className="empty">Belum ada koperasi.</p>:<table><thead><tr><th>NAMA KOPERASI</th><th>MATA UANG</th><th></th></tr></thead><tbody>{rows.map(t=><tr key={t.id}><td><strong>{t.name}</strong></td><td>{t.currency}</td><td className="rowactions"><button className="iconbutton" title="Ganti nama" aria-label={'Ganti nama '+t.name} onClick={()=>{setError('');setEdit({id:t.id,name:t.name,from:t.name})}}><Pencil size={16}/></button></td></tr>)}</tbody></table>}
 </section>;
}
