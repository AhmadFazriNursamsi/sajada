'use client';
import {useState} from 'react';
export default function CapitalWalletPayment({orderId,names,pay}:{orderId:string;names:string[];pay:(order:string,member:string)=>void}){const [member,setMember]=useState(names[0]||'');return <div><label>Anggota pembeli<select aria-label={'Pembeli saldo modal '+orderId} value={member} onChange={e=>setMember(e.target.value)}>{names.map(n=><option key={n}>{n}</option>)}</select></label><button className="textbutton" onClick={()=>pay(orderId,member)}>Bayar saldo belanja</button></div>;}
