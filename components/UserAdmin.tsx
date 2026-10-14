'use client';
import {useEffect,useState} from 'react';
import {KeyRound,Pencil,Plus,X} from 'lucide-react';
import {createUserAction,listPeopleAction,listUsersAction,resetPasswordAction,updateUserAction} from '../app/actions/users';
import {ROLES,ROLE_LABELS,isStaff,type Role} from '../lib/roles';
import type {UserRow} from '../lib/server/users';

// Pengaturan → Pengguna & akses (admin only; the server checks again).
type Draft={id?:string;username:string;name:string;role:Role;tenants:string[];tenant:string;personId:string;active:boolean;password:string};
type People={members:{id:string;name:string}[];investors:{id:string;name:string}[]};

/** A temporary password the admin passes on; the user must replace it at first sign-in. */
function temporaryPassword(){const chars='abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=crypto.getRandomValues(new Uint8Array(12));return Array.from(bytes,b=>chars[b%chars.length]).join('');}

export default function UserAdmin({tenants,self,notify}:{tenants:string[];self:string;notify:(s:string)=>void}){
 const [users,setUsers]=useState<UserRow[]|null>(null),[draft,setDraft]=useState<Draft|null>(null),[people,setPeople]=useState<People|null>(null),[shown,setShown]=useState<{username:string;password:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function refresh(){const r=await listUsersAction();if(r.ok)setUsers(r.data);else setError(r.error);}
 useEffect(()=>{let live=true;listUsersAction().then(r=>{if(!live)return;if(r.ok)setUsers(r.data);else setError(r.error);});return()=>{live=false};},[]);
 const personal=draft&&!isStaff(draft.role);
 useEffect(()=>{if(!personal||!draft?.tenant)return;let live=true;listPeopleAction(draft.tenant).then(r=>{if(!live)return;if(r.ok)setPeople(r.data);else setError(r.error);});return()=>{live=false};},[personal,draft?.tenant]);
 function startNew(){setError('');setPeople(null);setDraft({username:'',name:'',role:'member_officer',tenants:tenants.slice(0,1),tenant:tenants[0],personId:'',active:true,password:temporaryPassword()});}
 function startEdit(u:UserRow){setError('');setPeople(null);setDraft({id:u.id,username:u.username,name:u.name,role:u.role,tenants:isStaff(u.role)?u.tenants:[],tenant:isStaff(u.role)?tenants[0]:u.tenants[0],personId:u.person?.id??'',active:u.active,password:''});}
 async function save(){if(!draft)return;setBusy(true);setError('');
  const input={username:draft.username,name:draft.name,role:draft.role,tenants:draft.tenants,tenant:draft.tenant,personId:draft.personId};
  const r=draft.id?await updateUserAction(draft.id,{...input,active:draft.active}):await createUserAction(input,draft.password);
  setBusy(false);if(!r.ok){setError(r.error);return;}
  if(!draft.id)setShown({username:draft.username.trim().toLowerCase(),password:draft.password});
  notify(draft.id?'Akun diperbarui.':'Akun dibuat.');setDraft(null);refresh();}
 async function reset(u:UserRow){if(!confirm(`Buat password sementara baru untuk ${u.username}? Sesi login akun ini akan diakhiri.`))return;const password=temporaryPassword();const r=await resetPasswordAction(u.id,password);if(!r.ok){notify(r.error);return;}setShown({username:u.username,password});refresh();}
 const status=(u:UserRow)=>!u.active?<span className="badge">Nonaktif</span>:u.lockedUntil?<span className="badge Bronze">Terkunci sementara</span>:u.mustChangePassword?<span className="badge Gold">Wajib ganti password</span>:<span className="badge Silver">Aktif</span>;
 const list=personal?(draft!.role==='member'?people?.members:people?.investors)??[]:[];
 return <section className="panel settings useradmin"><div className="sectiontools"><div><h2>Pengguna & akses</h2><p>Setiap orang login dengan akunnya sendiri. Peran menentukan menu yang boleh diubah; semua staf dapat melihat seluruh menu koperasi yang diizinkan. Anggota dan investor hanya melihat data miliknya di portal.</p></div><button className="primary" onClick={startNew}><Plus size={16}/>Tambah pengguna</button></div>
  {shown&&<div className="notice" role="status"><div><strong>Password sementara untuk {shown.username}</strong><p>Berikan secara langsung kepada pemilik akun. Password ini hanya ditampilkan sekarang dan wajib diganti saat login pertama.</p><code>{shown.password}</code></div><button className="iconbutton" aria-label="Tutup" onClick={()=>setShown(null)}><X size={18}/></button></div>}
  {error&&!draft&&<p className="formerror" role="alert">{error}</p>}
  {draft&&<form className="userform" onSubmit={e=>{e.preventDefault();save()}}>
   <h2>{draft.id?'Ubah akun '+draft.username:'Pengguna baru'}</h2>
   <div className="userfields">
    <label>Username<input value={draft.username} disabled={!!draft.id} required pattern="[a-z0-9._\-]{3,40}" title="3–40 karakter: huruf kecil, angka, titik, garis bawah, tanda hubung" onChange={e=>setDraft({...draft,username:e.target.value.toLowerCase()})} autoComplete="off"/></label>
    <label>Nama tampilan<input value={draft.name} required maxLength={100} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="Dicatat sebagai pelaksana transaksi"/></label>
    <label>Peran<select value={draft.role} onChange={e=>setDraft({...draft,role:e.target.value as Role,personId:''})}>{ROLES.map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></label>
    {draft.id&&<label className="check"><input type="checkbox" checked={draft.active} disabled={draft.id===self} onChange={e=>setDraft({...draft,active:e.target.checked})}/>Akun aktif</label>}
   </div>
   {isStaff(draft.role)&&(draft.role==='admin'?<p className="muted">Admin dapat membuka semua koperasi dan mengelola pengguna.</p>:<fieldset className="tenantpick"><legend>Koperasi yang boleh dibuka</legend>{tenants.map(t=><label key={t} className="check"><input type="checkbox" checked={draft.tenants.includes(t)} onChange={e=>setDraft({...draft,tenants:e.target.checked?[...draft.tenants,t]:draft.tenants.filter(x=>x!==t)})}/>{t}</label>)}</fieldset>)}
   {personal&&<div className="userfields"><label>Koperasi<select value={draft.tenant} onChange={e=>{setPeople(null);setDraft({...draft,tenant:e.target.value,personId:''})}}>{tenants.map(t=><option key={t}>{t}</option>)}</select></label>
    <label>{draft.role==='member'?'Anggota':'Investor'}<select value={draft.personId} required onChange={e=>setDraft({...draft,personId:e.target.value})}><option value="">{people?'Pilih…':'Memuat…'}</option>{list.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {people&&!list.length&&<p className="muted">{draft.role==='member'?'Belum ada anggota':'Belum ada investor terdaftar'} di koperasi ini.</p>}</div>}
   {!draft.id&&<p className="muted">Password sementara <code>{draft.password}</code> akan ditampilkan sekali setelah akun dibuat.</p>}
   {error&&<p className="formerror" role="alert">{error}</p>}
   <div className="formactions"><button type="button" className="secondary" onClick={()=>{setDraft(null);setError('')}}>Batal</button><button className="primary" disabled={busy}>{busy?'Menyimpan…':draft.id?'Simpan perubahan':'Buat akun'}</button></div>
  </form>}
  {!users?<p className="muted">Memuat pengguna…</p>:<table><thead><tr><th>USERNAME / NAMA</th><th>PERAN</th><th>KOPERASI / ORANG</th><th>STATUS</th><th></th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td><strong>{u.username}</strong><br/><small>{u.name}{u.id===self?' · Anda':''}</small></td><td>{ROLE_LABELS[u.role]}</td><td>{u.role==='admin'?'Semua koperasi':u.tenants.join(', ')||'—'}{u.person&&<><br/><small>{u.person.name}</small></>}</td><td>{status(u)}</td><td className="rowactions"><button className="iconbutton" title="Ubah" aria-label={'Ubah '+u.username} onClick={()=>startEdit(u)}><Pencil size={16}/></button><button className="iconbutton" title="Reset password" aria-label={'Reset password '+u.username} onClick={()=>reset(u)}><KeyRound size={16}/></button></td></tr>)}</tbody></table>}
 </section>;
}
