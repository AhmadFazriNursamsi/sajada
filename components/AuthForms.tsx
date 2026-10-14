'use client';
import {useActionState} from 'react';
import {changePasswordAction,loginAction,type FormState} from '../app/actions/auth';

export function LoginForm(){
 const [state,action,pending]=useActionState<FormState,FormData>(loginAction,null);
 return <form action={action} className="authform">
  <label>Username<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus/></label>
  <label>Password<input name="password" type="password" autoComplete="current-password" required/></label>
  {state?.error&&<p className="formerror" role="alert">{state.error}</p>}
  <button className="primary full" disabled={pending}>{pending?'Memeriksa…':'Masuk'}</button>
 </form>;
}

export function PasswordForm({forced}:{forced:boolean}){
 const [state,action,pending]=useActionState<FormState,FormData>(changePasswordAction,null);
 return <form action={action} className="authform">
  <label>{forced?'Password sementara':'Password saat ini'}<input name="current" type="password" autoComplete="current-password" required autoFocus/></label>
  <label>Password baru<input name="next" type="password" autoComplete="new-password" minLength={8} required/></label>
  <label>Ulangi password baru<input name="confirm" type="password" autoComplete="new-password" minLength={8} required/></label>
  <p className="muted">Minimal 8 karakter. Gunakan password yang tidak dipakai di layanan lain.</p>
  {state?.error&&<p className="formerror" role="alert">{state.error}</p>}
  <button className="primary full" disabled={pending}>{pending?'Menyimpan…':'Simpan password'}</button>
 </form>;
}
