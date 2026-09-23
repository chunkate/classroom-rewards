'use client';
import { apiFetch } from '@/lib/transport';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Star, ClipboardCheck, History, Plus, Undo2, Download, CloudCheck, RefreshCw, Archive, Pencil, BookOpen, Award } from 'lucide-react';
import { applyCommand, availableScores, getRound, initialState, redeemedScores, redemptionCounts, scores, scoresBetween, seats, today, weekRange, type Command, type State, type Task } from '@/lib/rewards';

type Snapshot = { state:State; revision:number; warning?:string };
type RewardJob = { revision:number; command:Command; message:string };
const signed = (n:number) => n > 0 ? `+${n}` : String(n);
function saveFile(name:string, text:string, type:string) { const url = URL.createObjectURL(new Blob([text], {type})); const a = document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
export default function Home() {
 const [snapshot,setSnapshot]=useState<Snapshot>({state:initialState(),revision:0});
 const [loaded,setLoaded]=useState(false), [busy,setBusy]=useState(false), [error,setError]=useState(''), [notice,setNotice]=useState('');
 const [date,setDate]=useState(''), [view,setView]=useState('rewards'), [reason,setReason]=useState(''), [step,setStep]=useState(1);
 const [selected,setSelected]=useState(''), [showArchived,setShowArchived]=useState(false);
 const [dialog,setDialog]=useState(false), [edit,setEdit]=useState<Task|null>(null), [title,setTitle]=useState(''), [points,setPoints]=useState(1);
 const [redeemDialog,setRedeemDialog]=useState(false),[redeemStudent,setRedeemStudent]=useState(1),[redeemPoints,setRedeemPoints]=useState(10);
 const [pending,setPending]=useState<{revision:number;command:Command}|null>(null);
 const [rewardSaving,setRewardSaving]=useState(0),[rewardPaused,setRewardPaused]=useState(false);
 const [drafts,setDrafts]=useState<Record<string,Record<number,boolean>>>({});
 const draftGroups=Object.entries(drafts).filter(([,values])=>Object.keys(values).length>0);
 useEffect(()=>{if(!draftGroups.length&&!rewardSaving)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[draftGroups.length,rewardSaving]);
 const lock=useRef(false),snapshotRef=useRef(snapshot),rewardJobs=useRef<RewardJob[]>([]),rewardFlushing=useRef(false); const current=snapshot.state;
 useEffect(()=>{snapshotRef.current=snapshot;},[snapshot]);
 const load=useCallback(async()=>{
  if(lock.current) return;
  try { const r=await apiFetch('/api/classroom',{cache:'no-store'}); const data=await r.json() as Snapshot & {error?:string}; if(r.status===401)window.dispatchEvent(new Event("classroom-auth-expired")); if(!r.ok) throw new Error(data.error); snapshotRef.current=data;setSnapshot(data);setLoaded(true);setError(''); }
  catch(e){setError((e as Error).message || '無法連線，請重試。');}
 },[]);
 useEffect(()=>{ let previous=today(); const start=setTimeout(()=>{setDate(previous);void load();},0); const timer=setInterval(()=>{const next=today();if(next!==previous){const old=previous;previous=next;setDate(d=>d===old?next:d);}},30000); return ()=>{clearTimeout(start);clearInterval(timer);}; },[load]);
 async function send(command:Omit<Command,'id'|'date'>, message:string, retry?:{revision:number;command:Command}) {
  if(lock.current || rewardJobs.current.length>0 || (!loaded && !retry)) return false;
  lock.current=true;setBusy(true);setError('');
  const payload=retry ?? {revision:snapshotRef.current.revision,command:{...command,id:crypto.randomUUID(),date}};
  let received=false;
  try {
   const r=await apiFetch('/api/classroom',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
   const data=await r.json() as Snapshot & {error?:string}; if(r.status===401)window.dispatchEvent(new Event("classroom-auth-expired"));
   received=true;
   if(!r.ok){if(data.state){snapshotRef.current=data;setSnapshot(data);setDrafts(previous=>Object.fromEntries(Object.entries(previous).filter(([key])=>{const [day,id,roundId]=key.split(':');return getRound(data.state,day,id).id===roundId;})));setPending(null);} else if(r.status>=500) setPending(payload); else setPending(null);throw new Error(data.error || '儲存失敗');}
   snapshotRef.current=data;setSnapshot(data);setPending(null);setNotice(data.warning?`${message} ${data.warning}`:message);
   if(payload.command.type==='confirmRound'||payload.command.type==='clearRound'){const key=`${payload.command.date}:${payload.command.taskId}:${payload.command.roundId}`;setDrafts(previous=>{const next={...previous};delete next[key];return next;});}
   return true;
  } catch(e){if(!received) setPending(payload);setError((e as Error).message || '連線中斷，請重試。');return false;}
  finally{lock.current=false;setBusy(false);}
 }
 async function flushRewards(){
  if(rewardFlushing.current||rewardJobs.current.length===0)return;
  rewardFlushing.current=true;setRewardPaused(false);setError('');
  try{
   while(rewardJobs.current.length){
    const job=rewardJobs.current[0];
    try{
     const r=await apiFetch('/api/classroom',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:job.revision,command:job.command}),signal:AbortSignal.timeout(20000)});
     const data=await r.json() as Snapshot & {error?:string};if(r.status===401)window.dispatchEvent(new Event('classroom-auth-expired'));
     if(r.status===409&&data.state){
      let optimistic:Snapshot={state:data.state,revision:data.revision,warning:data.warning};
      for(const queued of rewardJobs.current){queued.revision=optimistic.revision;optimistic={...optimistic,state:applyCommand(optimistic.state,queued.command),revision:optimistic.revision+1};}
      snapshotRef.current=optimistic;setSnapshot(optimistic);continue;
     }
     if(!r.ok)throw new Error(data.error||'背景儲存失敗');
     rewardJobs.current.shift();setRewardSaving(rewardJobs.current.length);setNotice(data.warning?`${job.message} ${data.warning}`:job.message);
     if(rewardJobs.current.length===0){snapshotRef.current=data;setSnapshot(data);}
    }catch(e){setRewardPaused(true);setError(`${(e as Error).message||'連線中斷'} 畫面分數已保留，請按「重試背景儲存」。`);break;}
   }
  }finally{rewardFlushing.current=false;}
 }
 const week=date?weekRange(date):{start:'',end:''};
 const {total,daily,weekly,taskScores,classScores,redeemed,available,badges}=useMemo(()=>({total:scores(current),daily:scores(current,date),weekly:date?scoresBetween(current,week.start,week.end):scores(current,date),taskScores:scores(current,date,'check'),classScores:scores(current,date,'reward'),redeemed:redeemedScores(current),available:availableScores(current),badges:redemptionCounts(current)}),[current,date,week.start,week.end]);
 const activeTasks=current.tasks.filter(t=>!t.archived), visibleTasks=current.tasks.filter(t=>showArchived || !t.archived);
 const task=visibleTasks.find(t=>t.id===selected) ?? activeTasks[0] ?? (showArchived?visibleTasks[0]:undefined);
 const taskTone=task?Math.max(0,current.tasks.findIndex(t=>t.id===task.id))%4:0;
 const round=task?getRound(current,date,task.id):{id:'initial',number:1,students:[],confirmed:false};
 const draftKey=task?`${date}:${task.id}:${round.id}`:'';
 const draft=drafts[draftKey]??{};
 const completed=round.confirmed?round.students:seats.filter(n=>draft[n]??false);
 const hasDraft=Object.keys(draft).length>0;
 function toggleCheck(student:number){if(rewardDisabled || !task || task.archived || round.confirmed)return;setDrafts(previous=>{const next={...previous[draftKey]};if(next[student])delete next[student];else next[student]=true;return {...previous,[draftKey]:next};});}
 function clearDraft(){
  if(!task)return;
  if(!round.confirmed){setDrafts(previous=>{const next={...previous};delete next[draftKey];return next;});setError('');setNotice('本輪尚未確定的座號已清除。');return;}
  queueBackground({type:'clearRound',taskId:task.id,roundId:round.id},'畫面已清除，可以開始新一輪。已儲存的分數與紀錄保留。');
 }
 const last=[...current.actions].reverse().find(a=>!a.undone);
 const actions=[...current.actions].reverse().filter(a=>a.date===date);
 const disabled=busy || rewardSaving>0 || !loaded || !!pending || !date;
 const rewardDisabled=busy || !loaded || !!pending || rewardPaused || !date;
 function openTask(t?:Task){setEdit(t??null);setTitle(t?.title??'');setPoints(t?.points??1);setDialog(true);}
 async function submitTask(e:React.SyntheticEvent<HTMLFormElement>){e.preventDefault();const ok=await send({type:'task',taskId:edit?.id,title,points},edit?'項目已更新；既有完成獎勵維持原分數。':'檢核項目已新增。');if(ok)setDialog(false);}
 function queueBackground(input:Omit<Command,'id'|'date'>,message:string){
  if(rewardDisabled)return;
  const command:Command={...input,id:crypto.randomUUID(),date};
  const base=snapshotRef.current;
  try{
   const optimistic:Snapshot={...base,state:applyCommand(base.state,command),revision:base.revision+1};
   snapshotRef.current=optimistic;setSnapshot(optimistic);rewardJobs.current.push({revision:base.revision,command,message});
   if(command.type==='confirmRound'||command.type==='clearRound'){const key=`${command.date}:${command.taskId}:${command.roundId}`;setDrafts(previous=>{const next={...previous};delete next[key];return next;});}
   setRewardSaving(rewardJobs.current.length);setNotice('畫面已立即更新，正在背景儲存…');setError('');void flushRewards();
  }catch(e){setError((e as Error).message||'操作資料不正確。');}
 }
 function reward(students:number[],amount:number){queueBackground({type:'reward',students,amount,reason},`${students.length===30?'全班':`${students[0]} 號`} ${signed(amount)} 分，已儲存。`);}
 async function redeem(e:React.SyntheticEvent<HTMLFormElement>){e.preventDefault();const ok=await send({type:'redeem',student:redeemStudent,amount:redeemPoints},`${redeemStudent} 號已兌換 ${redeemPoints} 點獎勵章。`);if(ok)setRedeemDialog(false);}
 function exportCSV(){
  const dates=[...new Set(current.actions.filter(a=>!a.undone).map(a=>a.date))].sort();
  const running:Record<number,number>=Object.fromEntries(seats.map(n=>[n,0]));
  const runningRedeemed:Record<number,number>=Object.fromEntries(seats.map(n=>[n,0])),runningBadges:Record<number,number>=Object.fromEntries(seats.map(n=>[n,0]));
  const rows=[['日期','座號','任務檢核','課堂獎勵','當日合計','截至當日學期累積','截至當日已兌換','截至當日可用點數','獎勵章']];
  for(const day of dates){const ts=scores(current,day,'check'),cs=scores(current,day,'reward'),rs=redeemedScores(current,day),rc=redemptionCounts(current,day);for(const n of seats){running[n]+=ts[n]+cs[n];runningRedeemed[n]+=rs[n];runningBadges[n]+=rc[n];rows.push([day,String(n),String(ts[n]),String(cs[n]),String(ts[n]+cs[n]),String(running[n]),String(runningRedeemed[n]),String(running[n]-runningRedeemed[n]),String(runningBadges[n])]);}}
  saveFile(`班級分數-${today()}.csv`,'\uFEFF'+rows.map(r=>r.join(',')).join('\r\n'),'text/csv;charset=utf-8');
 }
 return <main className={`classroom ${view==='rewards'?'reward-view':''}`}>
  <header className="masthead"><div className="brand-mark"><Star/></div><div><p className="eyebrow">每一天的努力，都值得記錄</p><h1>高老師的班級獎勵簿</h1></div><span className="class-chip">全班 30 人</span><div className={`save-status ${busy||rewardSaving>0?'saving':''} ${rewardPaused?'save-paused':''}`} aria-live="polite">{busy||rewardSaving>0?<RefreshCw size={16}/>:<CloudCheck size={16}/>} {rewardPaused?'等待重試':rewardSaving>0?`背景儲存 ${rewardSaving} 筆`:busy?'儲存中':loaded?'已連接雲端紀錄':'正在讀取'}</div></header>
  <Tabs value={view} onValueChange={v=>setView(String(v))}><div className="topbar"><TabsList className="main-tabs"><TabsTrigger value="rewards"><Star/>課堂獎勵</TabsTrigger><TabsTrigger value="tasks"><ClipboardCheck/>任務檢核</TabsTrigger><TabsTrigger value="history"><History/>每日紀錄</TabsTrigger></TabsList><div className="date-control"><label htmlFor="record-date">紀錄日期</label><input id="record-date" type="date" value={date} max={today()} disabled={busy || rewardSaving>0 || !!pending} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/>{date!==today()&&<button className="text-button" onClick={()=>setDate(today())} disabled={busy || rewardSaving>0}>回到今天</button>}</div></div>
  {date && date!==today()&&<div className="date-banner">目前查看 {date} 的紀錄；加扣分與檢核也會記在這一天。</div>}
  {error&&<div className="error-box" role="alert"><span>{error}</span><button className="action" disabled={busy} onClick={()=>rewardPaused?void flushRewards():pending?void send(pending.command,'原操作已確認儲存。',pending):void load()}><RefreshCw/>{rewardPaused?'重試背景儲存':`重試${pending?'原操作':'讀取'}`}</button></div>}
  <output className="status-line">{notice || '課堂加扣分自動儲存；任務檢核請按確定。每日分數持續累積。'}</output>
  {draftGroups.length>0&&<div className="draft-summary"><span>尚有 {draftGroups.length} 組檢核未確定：</span>{draftGroups.map(([key])=>{const [day,id]=key.split(':');return <button key={key} className="text-button" disabled={disabled} onClick={()=>{setDate(day);setSelected(id);setView('tasks');setShowArchived(true);}}>{day} · {current.tasks.find(t=>t.id===id)?.title??'檢核項目'}</button>;})}</div>}
  {!loaded?<section className="empty-panel"><BookOpen/><h2>{error?'暫時無法讀取班級紀錄':'正在開啟班級紀錄'}</h2><p>讀取完成後即可開始使用。</p></section>:<>
  <TabsContent value="rewards">
   <section className="section-heading"><div><p className="eyebrow">CLASSROOM REWARDS</p><h2>把好表現，變成一點鼓勵。</h2><p className="week-label">本週 {week.start.slice(5).replace('-','/')}～{week.end.slice(5).replace('-','/')}（星期一至星期日）</p></div><div className="summary-mini"><span>本週全班合計 <strong>{signed(seats.reduce((s,n)=>s+weekly[n],0))}</strong></span></div></section>
   <section className="reward-toolbar"><div className="reward-reason"><label htmlFor="reason">獎勵／扣分原因</label><input id="reason" placeholder="例如：專心聽講、主動協助" maxLength={100} value={reason} onChange={e=>setReason(e.target.value)}/></div><div className="batch-buttons"><span className="small-label">全班一起</span>{[1,2,5,-1,-2].map(n=><button key={n} className={`action ${n>0?'positive':'negative'}`} disabled={rewardDisabled} onClick={()=>reward(seats,n)}>{signed(n)}</button>)}</div><div className="step-control"><label htmlFor="step">個別每次分數</label><input id="step" type="number" min="1" max="100" step="1" value={step} onChange={e=>setStep(Number(e.target.value))}/></div></section>
   <div className="student-grid">{seats.map(n=><article className="student" key={n}><div className="student-head"><span className="seat">{String(n).padStart(2,'0')}</span><span>號</span></div><div className={`score weekly-score ${weekly[n]<0?'below-zero':''}`}>{signed(weekly[n])}<span>本週累計</span></div><div className="student-bottom weekly-only"><button aria-label={`${n} 號扣 ${step} 分`} disabled={rewardDisabled || !Number.isInteger(step) || step<1 || step>100} onClick={()=>reward([n],-step)}>−</button><button aria-label={`${n} 號加 ${step} 分`} disabled={rewardDisabled || !Number.isInteger(step) || step<1 || step>100} onClick={()=>reward([n],step)}>＋</button></div></article>)}</div>
  </TabsContent>
  <TabsContent value="tasks">
   <section className="section-heading"><div><p className="eyebrow">DAILY CHECKLIST</p><h2>一個項目，一眼掌握。</h2></div><button className="action primary" disabled={disabled} onClick={()=>openTask()}><Plus/>新增檢核項目</button></section>
   <div className="task-layout"><aside className="task-sidebar"><div className="sidebar-title">檢核項目 <span>{activeTasks.length}</span></div>{visibleTasks.length===0&&<p className="muted">尚未新增項目</p>}{visibleTasks.map(t=>{const taskRound=getRound(current,date,t.id);const count=taskRound.students.length;return <button className={`task-option ${task?.id===t.id?'selected':''}`} key={t.id} onClick={()=>setSelected(t.id)}><span>{t.title}{t.archived&&<small>已封存</small>}{Object.keys(drafts[`${date}:${t.id}:${taskRound.id}`]??{}).length>0&&<small className="draft-label">尚未確定</small>}</span><span className="task-count">{count}/30</span></button>;})}<label className="check-label" htmlFor="show-archived"><Checkbox id="show-archived" checked={showArchived} onCheckedChange={v=>setShowArchived(v)}/>顯示已封存項目</label></aside>
   <section className={`task-board task-tone-${taskTone}`}>{task?<>
    <div className="task-board-heading"><div><h3>{task.title}</h3><p>每人 +{task.points} 分 · 第 {round.number} 輪</p></div></div>
    <div className="round-toolbar"><div className="inline-actions"><button className="action primary" disabled={rewardDisabled || task.archived || round.confirmed || completed.length===0} onClick={()=>queueBackground({type:'confirmRound',taskId:task.id,roundId:round.id,students:completed},'本輪分數已存入總表。按清除即可開始下一輪。')}>確定</button><button className="action" disabled={rewardDisabled || task.archived} onClick={clearDraft}>清除</button></div><span>{round.confirmed?'本輪已儲存，請按清除開始下一輪。':'點選座號，再按確定儲存本輪分數。'}</span></div>
    {task.archived&&<p className="date-banner">這個項目已封存，恢復後即可繼續檢核。</p>}
    <div className="check-grid round-grid">{seats.map(n=><button key={n} aria-pressed={completed.includes(n)} aria-label={`${n} 號`} className={`check-card ${completed.includes(n)?'complete':''}`} disabled={rewardDisabled || task.archived || round.confirmed} onClick={()=>toggleCheck(n)}><span className="check-seat">{n}</span></button>)}</div>
    <p className="batch-note">確定前按清除會取消本輪選取；確定入帳後按清除會開始下一輪，已存入總表的分數會保留。隔天也會自動開始新的檢核。</p>
    <div className="inline-actions"><button className="icon-action" aria-label="編輯檢核項目" onClick={()=>openTask(task)} disabled={disabled || hasDraft}><Pencil size={18}/></button><button className="action" disabled={disabled || hasDraft} onClick={()=>void send({type:'archive',taskId:task.id,archived:!task.archived},task.archived?'項目已恢復。':'項目已封存，歷史分數仍保留。')}><Archive/>{task.archived?'恢復':'封存'}</button></div>
   </>:<div className="empty-panel"><ClipboardCheck/><h3>從今天的第一個任務開始</h3><p>新增一次，同一項目可每天、每節課重複使用。</p><button className="action primary" disabled={disabled} onClick={()=>openTask()}><Plus/>新增檢核項目</button></div>}</section></div>

  </TabsContent>
  <TabsContent value="history">
   <section className="section-heading"><div><p className="eyebrow">DAILY RECORDS</p><h2>每天的進步，都留得下來。</h2></div><div className="inline-actions"><button className="action primary" disabled={disabled} onClick={()=>setRedeemDialog(true)}><Award/>兌換獎勵章</button><button className="action" onClick={exportCSV}><Download/>匯出每日分數</button><button className="action" onClick={()=>saveFile(`班級完整紀錄-${today()}.json`,JSON.stringify(snapshot,null,2),'application/json')}><Download/>下載完整紀錄</button></div></section>
   <div className="history-layout"><section className="table-panel"><div className="panel-title"><h3>{date} 分數明細</h3><span>本週 {week.start.slice(5).replace('-','/')}～{week.end.slice(5).replace('-','/')}</span></div><div className="score-table-scroll"><Table><TableHeader><TableRow><TableHead>座號</TableHead><TableHead>任務</TableHead><TableHead>課堂</TableHead><TableHead>本日</TableHead><TableHead>本週</TableHead><TableHead>學期</TableHead><TableHead>已兌換</TableHead><TableHead>可用</TableHead><TableHead>獎勵章</TableHead></TableRow></TableHeader><TableBody>{seats.map(n=><TableRow key={n}><TableCell>{n} 號</TableCell><TableCell>{signed(taskScores[n])}</TableCell><TableCell>{signed(classScores[n])}</TableCell><TableCell>{signed(daily[n])}</TableCell><TableCell>{signed(weekly[n])}</TableCell><TableCell>{total[n]}</TableCell><TableCell>−{redeemed[n]}</TableCell><TableCell className="emphasis">{available[n]}</TableCell><TableCell><span className="badge-count"><Award/>{badges[n]}</span></TableCell></TableRow>)}</TableBody></Table></div></section><section className="activity-panel"><div className="panel-title"><h3>當日操作紀錄</h3><span>{actions.length} 筆</span></div>{actions.length===0?<div className="empty-activity"><History/><p>這一天還沒有操作紀錄。</p></div>:<div className="activity-list">{actions.map(a=><article className={`activity ${a.undone?'undone':''}`} key={a.id}><span className={`activity-icon ${a.kind==='check'?'teal':a.kind==='redeem'?'badge':''}`}>{a.kind==='check'?<ClipboardCheck size={17}/>:a.kind==='redeem'?<Award size={17}/>:<Star size={17}/>}</span><div><b>{a.reason}</b><p>{a.kind==='redeem'?<>{a.entries[0]?.student} 號 · 第 {a.redemptionNumber} 次兌換 · 兌換後可用 {a.balanceAfter} 點</>:(a.checks||a.round)?`${a.entries.length} 人 · 合計 ${signed(a.entries.reduce((sum,e)=>sum+e.amount,0))} 分`:<>{a.entries.length===30?'全班 30 人':`${a.entries[0]?.student} 號`} · {signed(a.entries[0]?.amount??0)} 分{a.entries.length===30?'／人':''}</>}</p>{(a.checks||a.round)&&<p className="batch-recipients">{a.entries.map(e=>`${e.student} 號 ${signed(e.amount)}`).join('、')}</p>}<small>{new Date(a.time).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit'})}{a.undone?' · 已撤銷':''}</small></div></article>)}</div>}</section></div>
  </TabsContent>
  <footer className="bottom-bar"><span><CloudCheck size={17}/>課堂即時儲存 · 檢核按確定 · 換日持續累積</span><button className="action" disabled={disabled || !last} onClick={()=>last&&void send({type:'undo',actionId:last.id},'上一筆操作已撤銷，分數與紀錄已復原。')} title={last?`${last.date} ${last.reason}`:'還沒有可撤銷的操作'}><Undo2/>撤銷上一筆</button></footer>
  </>} </Tabs><Dialog open={dialog} onOpenChange={setDialog}><DialogContent className="task-dialog"><DialogHeader><DialogTitle>{edit?'編輯檢核項目':'新增檢核項目'}</DialogTitle><DialogDescription>項目可每天使用，每天都有獨立的完成名單。</DialogDescription></DialogHeader><form onSubmit={submitTask}><label htmlFor="task-title">項目名稱</label><input id="task-title" required maxLength={60} placeholder="例如：繳交數學作業" value={title} onChange={e=>setTitle(e.target.value)}/><label htmlFor="task-points">完成獎勵分數</label><input id="task-points" type="number" min="0" max="100" step="1" required value={points} onChange={e=>setPoints(Number(e.target.value))}/><p className="muted">設為 0 分可只檢核。每輪只入帳一次；清除不會扣掉已存入的分數。{edit?'修改分數僅影響之後的新完成紀錄。':''}</p><button className="action primary" disabled={disabled} type="submit">{busy?'儲存中…':'儲存項目'}</button></form></DialogContent></Dialog><Dialog open={redeemDialog} onOpenChange={v=>{if(!busy)setRedeemDialog(v);}}><DialogContent className="task-dialog redeem-dialog"><DialogHeader><DialogTitle>兌換獎勵章</DialogTitle><DialogDescription>選擇學生與本次兌換點數。每次兌換會增加一枚獎勵章並保留紀錄。</DialogDescription></DialogHeader><form onSubmit={redeem}><label htmlFor="redeem-student">學生座號</label><input id="redeem-student" type="number" min="1" max="30" step="1" required value={redeemStudent} onChange={e=>setRedeemStudent(Number(e.target.value))}/><div className="redeem-balance"><span>學期總分 <b>{total[redeemStudent]??0}</b></span><span>已兌換 <b>{redeemed[redeemStudent]??0}</b></span><span>目前可用 <strong>{available[redeemStudent]??0}</strong></span><span>已有獎勵章 <b>{badges[redeemStudent]??0}</b></span></div><label>本次兌換點數</label><div className="redeem-options">{[10,20,30].map(value=><button type="button" key={value} aria-pressed={redeemPoints===value} className={redeemPoints===value?'selected':''} onClick={()=>setRedeemPoints(value)}>{value} 點</button>)}</div>{(available[redeemStudent]??0)<redeemPoints&&<p className="auth-error">可用點數不足，請改選較低點數或其他學生。</p>}<button className="action primary" disabled={disabled||(available[redeemStudent]??0)<redeemPoints||!seats.includes(redeemStudent)} type="submit">{busy?'兌換中…':`扣除 ${redeemPoints} 點並兌換`}</button></form></DialogContent></Dialog>
 </main>;
}









