'use client';
import { apiFetch } from '@/lib/transport';
import { useCallback, useEffect, useState } from 'react';
import { LockKeyhole, LogOut, KeyRound, Star } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
export default function AuthGate({children}:{children:React.ReactNode}){
 const [status,setStatus]=useState<'loading'|'in'|'out'>('loading');
 const [password,setPassword]=useState(''),[newPassword,setNewPassword]=useState(''),[confirm,setConfirm]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[dialog,setDialog]=useState(false);
 const check=useCallback(async()=>{try{const r=await apiFetch('/api/auth',{cache:'no-store',signal:AbortSignal.timeout(15000)});const d=await r.json() as {authenticated?:boolean;error?:string};if(!r.ok)throw new Error(d.error);setStatus(d.authenticated?'in':'out');setError('');}catch{setStatus(previous=>previous==='in'?'in':'out');setError('無法連線，請確認網路後再試一次。');}},[]);
 useEffect(()=>{const initial=setTimeout(()=>void check(),0);const expired=()=>{setStatus('out');setPassword('');setDialog(false);setNotice('登入已結束，請重新輸入系統密碼。');};window.addEventListener('classroom-auth-expired',expired);const focus=()=>void check();window.addEventListener('focus',focus);return()=>{clearTimeout(initial);window.removeEventListener('classroom-auth-expired',expired);window.removeEventListener('focus',focus);};},[check]);
 async function submit(action:string,e?:React.SyntheticEvent<HTMLFormElement>){
  e?.preventDefault();if(busy)return;
  if(action==='password'&&newPassword!==confirm){setError('兩次輸入的新密碼不同。');return;}
  setBusy(true);setError('');
  try{
   const r=await apiFetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,password,newPassword}),signal:AbortSignal.timeout(15000)});
   const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error || '操作失敗，請再試一次。');
   setPassword('');setNewPassword('');setConfirm('');setDialog(false);
   setStatus(action==='logout'?'out':'in');setNotice(action==='password'?'密碼已更新，其他裝置已登出。':action==='logout'?'已登出班級系統。':'');
  }catch(e){setError((e as Error).name==='TimeoutError'?'連線逾時；若剛才修改密碼，請以新密碼重新登入確認。':(e as Error).message);}
  finally{setBusy(false);}
 }
 if(status==='loading')return <main className="login-shell"><div className="login-card"><LockKeyhole/><h1>正在開啟班級獎勵簿</h1><p>確認登入狀態中…</p></div></main>;
 if(status==='out')return <main className="login-shell"><section className="login-card"><div className="brand-mark"><Star/></div><p className="eyebrow">高老師的班級獎勵簿</p><h1>登入班級系統</h1><p>使用系統密碼即可登入，無需 ChatGPT 帳號。</p>{notice&&<output className="auth-notice">{notice}</output>}<form onSubmit={e=>void submit('login',e)}><label htmlFor="login-password">系統密碼</label><input id="login-password" type="password" autoComplete="current-password" value={password} required maxLength={128} onChange={e=>setPassword(e.target.value)}/>{error&&<p className="auth-error" role="alert">{error}</p>}<button className="action primary" disabled={busy} type="submit"><LockKeyhole size={17}/>{busy?'登入中…':'登入'}</button></form><p className="login-footnote">在學校公用電腦使用完畢後，請按「登出」。</p></section></main>;
 return <><div className="account-toolbar"><span><LockKeyhole size={14}/>班級系統已登入</span>{notice&&<output>{notice}</output>}<button className="text-button" onClick={()=>{setError('');setPassword('');setNewPassword('');setConfirm('');setDialog(true);}}><KeyRound size={15}/>修改密碼</button><button className="text-button" disabled={busy} onClick={()=>void submit('logout')}><LogOut size={15}/>登出</button></div>{error&&!dialog&&<p className="auth-error account-error" role="alert">{error}</p>}{children}<Dialog open={dialog} onOpenChange={v=>{if(!busy)setDialog(v);}}><DialogContent className="task-dialog"><DialogHeader><DialogTitle>修改系統密碼</DialogTitle><DialogDescription>修改後，其他電腦需要使用新密碼重新登入。</DialogDescription></DialogHeader><form onSubmit={e=>void submit('password',e)}><label htmlFor="old-password">目前密碼</label><input id="old-password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/><label htmlFor="new-password">新密碼（至少 12 個字元）</label><input id="new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={e=>setNewPassword(e.target.value)}/><label htmlFor="confirm-password">再次輸入新密碼</label><input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirm} onChange={e=>setConfirm(e.target.value)}/>{error&&<p className="auth-error" role="alert">{error}</p>}<button className="action primary" disabled={busy} type="submit">{busy?'儲存中…':'更新密碼'}</button></form></DialogContent></Dialog></>;
}



