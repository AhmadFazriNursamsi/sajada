'use client';
import {useActionState,useEffect,useState} from 'react';
import Link from 'next/link';
import {registrationOptionsAction,submitRegistrationAction} from '../app/actions/registration';
import type {FormState} from '../app/actions/auth';

const FAMILY:[string,string][]=[['J','Janda'],['D','Duda'],['B','Bapak'],['I','Ibu'],['L','Anak laki-laki'],['P','Anak perempuan']];

export default function RegisterForm(){
 const [state,action,pending]=useActionState<FormState,FormData>(submitRegistrationAction,null);
 const [tenants,setTenants]=useState<string[]|null>(null),[tenant,setTenant]=useState(''),[regions,setRegions]=useState<{id:string;label:string}[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;registrationOptionsAction(null).then(r=>{if(!live)return;if(r.ok)setTenants(r.data.tenants);else setError(r.error);});return()=>{live=false};},[]);
 useEffect(()=>{if(!tenant)return;let live=true;registrationOptionsAction(tenant).then(r=>{if(!live)return;if(r.ok)setRegions(r.data.regions);else setError(r.error);});return()=>{live=false};},[tenant]);
 if(state?.done)return <div className="registerdone" role="status"><h2>Terima kasih</h2><p>{state.done}</p><p className="authback"><Link href="/login">Ke halaman login</Link></p></div>;
 if(tenants&&!tenants.length)return <p className="muted">Belum ada koperasi yang menerima pendaftaran.</p>;
 return <form action={action} className="authform">
  <label>Koperasi<select name="tenant" required value={tenant} onChange={e=>{setRegions(null);setTenant(e.target.value)}}><option value="" disabled>{tenants?'Pilih koperasi':'Memuat…'}</option>{tenants?.map(t=><option key={t}>{t}</option>)}</select></label>
  <label>Nama lengkap<input name="name" required minLength={3} maxLength={100} autoComplete="name"/></label>
  <label>Nomor HP<input name="phone" required inputMode="tel" autoComplete="tel" placeholder="08xxxxxxxxxx" pattern="\+?[0-9\s().\-]{8,20}"/></label>
  <label>Email (opsional)<input name="email" type="email" maxLength={200} autoComplete="email"/></label>
  <label>Status keluarga<select name="familyStatus" required defaultValue=""><option value="" disabled>Pilih status</option>{FAMILY.map(([k,v])=><option key={k} value={k}>{k} · {v}</option>)}</select></label>
  {tenant&&(regions===null?<p className="muted">Memuat daerah…</p>:regions.length?<label>Kelurahan / desa<select name="regionId" required defaultValue=""><option value="" disabled>Pilih kelurahan/desa</option>{regions.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></label>:<label>Daerah tempat tinggal<input name="area" required minLength={2} maxLength={100} placeholder="Kelurahan, kecamatan, kota"/></label>)}
  <label>Diajak oleh (opsional)<input name="sponsor" maxLength={100} placeholder="Nama anggota yang mengajak"/></label>
  <label>Username<input name="username" required pattern="[a-z0-9._\-]{3,40}" title="3–40 karakter: huruf kecil, angka, titik, garis bawah, tanda hubung" autoCapitalize="none" spellCheck={false} autoComplete="username"/></label>
  <label>Password<input name="password" type="password" required minLength={8} autoComplete="new-password"/></label>
  <label>Ulangi password<input name="confirm" type="password" required minLength={8} autoComplete="new-password"/></label>
  <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="trap"/>
  <p className="muted">Data diperiksa petugas koperasi sebelum akun aktif. Rekening BSI dicatat petugas setelah pendaftaran disetujui.</p>
  {(state?.error||error)&&<p className="formerror" role="alert">{state?.error||error}</p>}
  <button className="primary full" disabled={pending||!tenants?.length}>{pending?'Mengirim…':'Kirim pendaftaran'}</button>
 </form>;
}
