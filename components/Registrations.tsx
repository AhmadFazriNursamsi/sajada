'use client';
import {useEffect,useState} from 'react';
import {Check,X} from 'lucide-react';
import {approveRegistrationAction,listRegistrationsAction,rejectRegistrationAction} from '../app/actions/registration';
import type {Registration} from '../lib/server/registration';

// Anggota koperasi → Pendaftaran anggota: requests from the public /daftar page.
const FAMILY:Record<string,string>={J:'Janda',D:'Duda',B:'Bapak',I:'Ibu',L:'Anak laki-laki',P:'Anak perempuan'};
type Lists={pending:Registration[];decided:Registration[]};

export default function Registrations({tenant,members,canDecide,notify,onChanged}:{tenant:string;members:string[];canDecide:boolean;notify:(s:string)=>void;onChanged:()=>void}){
 const [lists,setLists]=useState<Lists|null>(null),[error,setError]=useState(''),[open,setOpen]=useState<{id:string;mode:'approve'|'reject';name:string;sponsor:string;note:string}|null>(null),[busy,setBusy]=useState(false);
 async function refresh(){const r=await listRegistrationsAction(tenant);if(r.ok)setLists(r.data);else setError(r.error);}
 useEffect(()=>{let live=true;listRegistrationsAction(tenant).then(r=>{if(!live)return;if(r.ok)setLists(r.data);else setError(r.error);});return()=>{live=false};},[tenant]);
 function start(r:Registration,mode:'approve'|'reject'){setError('');setOpen({id:r.id,mode,name:r.name,sponsor:r.sponsorNote&&members.includes(r.sponsorNote)?r.sponsorNote:'',note:''});}
 async function decide(){if(!open)return;setBusy(true);setError('');
  const r=open.mode==='approve'?await approveRegistrationAction(tenant,open.id,{name:open.name,sponsor:open.sponsor||null}):await rejectRegistrationAction(tenant,open.id,open.note);
  setBusy(false);if(!r.ok){setError(r.error);return;}
  notify(open.mode==='approve'?'Pendaftaran disetujui. Anggota dan akun portalnya dibuat.':'Pendaftaran ditolak.');setOpen(null);refresh();if(open.mode==='approve')onChanged();}
 if(!lists)return error?<p className="formerror">{error}</p>:null;
 if(!lists.pending.length&&!lists.decided.length)return null;
 return <section className="panel settings registrations"><h2>Pendaftaran anggota{lists.pending.length?` · ${lists.pending.length} menunggu`:''}</h2><p className="muted">Dari halaman Daftar. Periksa data dan bukti di luar aplikasi bila perlu; setelah disetujui, pendaftar menjadi anggota dan dapat login ke portal dengan username serta password yang ia buat.</p>
  {error&&!open&&<p className="formerror" role="alert">{error}</p>}
  {lists.pending.length>0&&<table><thead><tr><th>PENDAFTAR</th><th>KONTAK</th><th>DAERAH</th><th>DIAJAK OLEH</th><th></th></tr></thead><tbody>{lists.pending.map(r=><tr key={r.id}><td><strong>{r.name}</strong><br/><small>{r.familyStatus} · {FAMILY[r.familyStatus]} · {r.username}</small><br/><small>{new Date(r.createdAt).toLocaleString('id-ID')}</small></td><td>{r.phone}{r.email&&<><br/><small>{r.email}</small></>}</td><td>{r.area}</td><td>{r.sponsorNote||'—'}</td><td className="rowactions">{canDecide&&<><button className="secondary" onClick={()=>start(r,'approve')}><Check size={15}/>Setujui</button> <button className="secondary" onClick={()=>start(r,'reject')}><X size={15}/>Tolak</button></>}</td></tr>)}</tbody></table>}
  {open&&<form className="userform" onSubmit={e=>{e.preventDefault();decide()}}>
   {open.mode==='approve'?<><h2>Setujui pendaftaran</h2><div className="userfields"><label>Nama anggota<input value={open.name} required minLength={3} maxLength={100} onChange={e=>setOpen({...open,name:e.target.value})}/></label><label>Sponsor<select value={open.sponsor} onChange={e=>setOpen({...open,sponsor:e.target.value})}><option value="">Tanpa sponsor</option>{members.map(m=><option key={m}>{m}</option>)}</select></label></div><p className="muted">Nama harus unik di koperasi. Sponsor menentukan jaringan MLM; pilih anggota yang benar-benar mengajak.</p></>
   :<><h2>Tolak pendaftaran</h2><div className="userfields"><label>Alasan (dilihat pendaftar)<input value={open.note} required minLength={3} maxLength={300} onChange={e=>setOpen({...open,note:e.target.value})}/></label></div></>}
   {error&&<p className="formerror" role="alert">{error}</p>}
   <div className="formactions"><button type="button" className="secondary" onClick={()=>{setOpen(null);setError('')}}>Batal</button><button className="primary" disabled={busy}>{busy?'Menyimpan…':open.mode==='approve'?'Setujui & buat akun':'Tolak'}</button></div></form>}
  {lists.decided.length>0&&<details><summary>Keputusan terakhir ({lists.decided.length})</summary><table><tbody>{lists.decided.map(r=><tr key={r.id}><td>{r.name}<br/><small>{r.username}</small></td><td><span className={'badge '+(r.status==='approved'?'Silver':'Bronze')}>{r.status==='approved'?'Disetujui':'Ditolak'}</span></td><td>{r.decisionNote||''}</td></tr>)}</tbody></table></details>}
 </section>;
}
