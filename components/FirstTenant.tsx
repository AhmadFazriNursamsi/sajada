'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {createTenantAction} from '../app/actions/users';

// Shown to an admin while no koperasi exists yet.
export default function FirstTenant(){
 const router=useRouter();
 const [name,setName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <form className="authform" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');const r=await createTenantAction(name);setBusy(false);if(!r.ok){setError(r.error);return;}router.refresh();}}>
  <label>Nama koperasi<input value={name} onChange={e=>setName(e.target.value)} required minLength={3} maxLength={100} autoFocus placeholder="Nama koperasi Anda"/></label>
  {error&&<p className="formerror" role="alert">{error}</p>}
  <button className="primary full" disabled={busy}>{busy?'Membuat…':'Buat koperasi'}</button>
 </form>;
}
