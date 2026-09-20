export type Task = { id: string; title: string; points: number; archived: boolean };
export type Entry = { student: number; amount: number };
export type CheckChange = { key: string; before: number | null; after: number | null };
export type Round = { id:string; number:number; students:number[]; confirmed:boolean };
export type Action = { id: string; date: string; time: string; kind: 'reward' | 'check' | 'redeem'; reason: string; entries: Entry[]; undone: boolean; check?: CheckChange; checks?: CheckChange[]; round?:{key:string;id:string}; balanceAfter?:number; redemptionNumber?:number };
export type State = { tasks: Task[]; checks: Record<string, number>; actions: Action[]; applied: string[]; rounds?:Record<string,Round> };
export type Command = { id: string; date: string; type: string; taskId?: string; title?: string; points?: number; students?: number[]; amount?: number; reason?: string; student?: number; completed?: boolean; actionId?: string; archived?: boolean; changes?: {student:number;completed:boolean}[]; roundId?:string };
export const seats = Array.from({ length: 30 }, (_, i) => i + 1);
export function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export function initialState(): State { return { tasks: [], checks: {}, actions: [], applied: [] }; }
export function checkKey(date: string, task: string, student: number) { return `${date}:${task}:${student}`; }
export function getRound(state:State,date:string,task:string):Round {const saved=state.rounds?.[`${date}:${task}`];if(saved)return saved;const students=seats.filter(n=>state.checks[checkKey(date,task,n)]!==undefined);return {id:'initial',number:1,students,confirmed:students.length>0};}
export function scores(state: State, date?: string, kind?: Action['kind']) {
 const result: Record<number, number> = Object.fromEntries(seats.map(n => [n, 0]));
 for (const a of state.actions) if (!a.undone && (!date || a.date === date) && (kind ? a.kind === kind : a.kind !== 'redeem')) for (const e of a.entries) result[e.student] += e.amount;
 return result;
}
export function redeemedScores(state:State,date?:string){const raw=scores(state,date,'redeem');return Object.fromEntries(seats.map(n=>[n,raw[n]===0?0:-raw[n]]));}
export function availableScores(state:State){const earned=scores(state),redeemed=redeemedScores(state);return Object.fromEntries(seats.map(n=>[n,earned[n]-redeemed[n]]));}
export function redemptionCounts(state:State,date?:string){const result:Record<number,number>=Object.fromEntries(seats.map(n=>[n,0]));for(const a of state.actions)if(!a.undone&&a.kind==='redeem'&&(!date||a.date===date))for(const e of a.entries)result[e.student]++;return result;}
export function weekRange(date:string){const start=new Date(`${date}T00:00:00Z`),offset=(start.getUTCDay()+6)%7;start.setUTCDate(start.getUTCDate()-offset);const end=new Date(start);end.setUTCDate(end.getUTCDate()+6);return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};}
export function scoresBetween(state:State,start:string,end:string,kind?:Action['kind']){const result:Record<number,number>=Object.fromEntries(seats.map(n=>[n,0]));for(const a of state.actions)if(!a.undone&&a.date>=start&&a.date<=end&&(kind?a.kind===kind:a.kind!=='redeem'))for(const e of a.entries)result[e.student]+=e.amount;return result;}
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
export function applyCommand(current: State, cmd: Command): State {
 assert(cmd && typeof cmd.id === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(cmd.id), '操作編號不正確');
 if (current.applied.includes(cmd.id)) return current;
 assert(typeof cmd.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cmd.date) && !Number.isNaN(Date.parse(cmd.date)) && new Date(cmd.date).toISOString().slice(0,10) === cmd.date && cmd.date <= today(), '請選擇有效日期，不可記錄未來日期');
 const s = structuredClone(current);
 const task = s.tasks.find(t => t.id === cmd.taskId);
 const action: Action = { id: cmd.id, date: cmd.date, time: new Date().toISOString(), kind: 'reward', reason: '', entries: [], undone: false };
 if (cmd.type === 'task') {
  assert(typeof cmd.title === 'string' && cmd.title.trim().length > 0 && cmd.title.trim().length <= 60, '請輸入 1～60 字的項目名稱');
  assert(Number.isInteger(cmd.points) && cmd.points! >= 0 && cmd.points! <= 100, '完成獎勵請設定 0～100 分');
  assert(!cmd.taskId || task, '找不到這個項目');
  if (task) { task.title = cmd.title.trim(); task.points = cmd.points!; }
  else s.tasks.push({id:cmd.id, title:cmd.title.trim(), points:cmd.points!, archived:false});
 } else if (cmd.type === 'archive') {
  assert(task && typeof cmd.archived === 'boolean', '找不到這個項目'); task.archived = cmd.archived;
 } else if (cmd.type === 'reward') {
  assert(Array.isArray(cmd.students) && cmd.students.length > 0 && cmd.students.length <= 30 && cmd.students.every(n => seats.includes(n)) && new Set(cmd.students).size === cmd.students.length, '座號不正確');
  assert(Number.isInteger(cmd.amount) && cmd.amount !== 0 && Math.abs(cmd.amount!) <= 100, '每次請加扣 1～100 分');
  assert(cmd.reason === undefined || (typeof cmd.reason === 'string' && cmd.reason.length <= 100), '原因最多 100 字');
  action.reason = cmd.reason?.trim() || '課堂表現'; action.entries = cmd.students.map(student => ({ student, amount:cmd.amount! })); s.actions.push(action);
 } else if(cmd.type==='redeem'){
  assert(seats.includes(cmd.student!),'請選擇有效座號');
  assert([10,20,30].includes(cmd.amount!),'每次可兌換 10、20 或 30 點');
  const balance=availableScores(s)[cmd.student!];
  assert(balance>=cmd.amount!,`${cmd.student} 號目前可用 ${balance} 點，不足以兌換 ${cmd.amount} 點`);
  action.kind='redeem';action.reason=`兌換 ${cmd.amount} 點獎勵章`;action.entries=[{student:cmd.student!,amount:-cmd.amount!}];action.balanceAfter=balance-cmd.amount!;action.redemptionNumber=redemptionCounts(s)[cmd.student!]+1;s.actions.push(action);
 } else if (cmd.type === 'check') {
  assert(!s.rounds?.[`${cmd.date}:${cmd.taskId}`], '檢核已更新為每輪計分，請重新整理頁面');
  assert(task && !task.archived && seats.includes(cmd.student!) && typeof cmd.completed === 'boolean', '檢核資料不正確');
  const key = checkKey(cmd.date, task.id, cmd.student!); const before = s.checks[key] ?? null;
  if ((before !== null) !== cmd.completed) {
   const after = cmd.completed ? task.points : null;
   action.kind = 'check'; action.reason = `${task.title}・${cmd.completed ? '完成' : '取消完成'}`;
   action.entries = [{ student:cmd.student!, amount: (after ?? 0) - (before ?? 0) }];
   action.check = { key, before, after };
   if (after === null) delete s.checks[key]; else s.checks[key] = after;
   s.actions.push(action);
  }
 } else if (cmd.type === 'checkBatch') {
  assert(!s.rounds?.[`${cmd.date}:${cmd.taskId}`], '檢核已更新為每輪計分，請重新整理頁面');
  assert(task && !task.archived, '找不到可檢核的項目');
  const changes=cmd.changes;
  assert(Array.isArray(changes) && changes.length>0 && changes.length<=30 && changes.every(c=>c && seats.includes(c.student) && typeof c.completed==='boolean') && new Set(changes.map(c=>c.student)).size===changes.length, '批次檢核資料不正確');
  action.kind='check'; action.reason=`${task.title}・批次確認`; action.checks=[];
  for(const change of changes){
   const key=checkKey(cmd.date,task.id,change.student),before=s.checks[key]??null;
   if((before!==null)===change.completed)continue;
   const after=change.completed?task.points:null;
   action.checks.push({key,before,after});
   action.entries.push({student:change.student,amount:(after??0)-(before??0)});
   if(after===null)delete s.checks[key];else s.checks[key]=after;
  }
  if(action.entries.length)s.actions.push(action);
 } else if(cmd.type==='confirmRound' || cmd.type==='clearRound'){
  assert(task && !task.archived,'找不到可檢核的項目');
  const key=`${cmd.date}:${task.id}`,round=getRound(s,cmd.date,task.id);
  assert(cmd.roundId===round.id,'這個項目已開始新一輪，請重新整理後操作');
  s.rounds??={};
  if(cmd.type==='clearRound')s.rounds[key]={id:cmd.id,number:round.number+1,students:[],confirmed:false};
  else{
   assert(Array.isArray(cmd.students)&&cmd.students.length>0&&cmd.students.length<=30&&cmd.students.every(n=>seats.includes(n))&&new Set(cmd.students).size===cmd.students.length,'請選擇有效座號');
   const selected=[...cmd.students].sort((a,b)=>a-b);
   if(round.confirmed)assert(JSON.stringify(selected)===JSON.stringify([...round.students].sort((a,b)=>a-b)),'本輪已確認，請按清除開始新一輪');
   else{
    s.rounds[key]={...round,students:selected,confirmed:true};
    action.kind='check';action.reason=`${task.title}・第 ${round.number} 輪`;action.round={key,id:round.id};
    action.entries=selected.map(student=>({student,amount:task.points}));s.actions.push(action);
   }
  }
 } else if (cmd.type === 'undo') {
  const a = [...s.actions].reverse().find(a => !a.undone);
  assert(a && a.id === cmd.actionId, '紀錄已有更新，請重新確認最後一筆操作');
  a.undone = true;
  if(a.round && s.rounds?.[a.round.key]?.id===a.round.id)s.rounds[a.round.key]={...s.rounds[a.round.key],students:[],confirmed:false};
  for(const check of a.checks ?? (a.check?[a.check]:[])){if(check.before===null)delete s.checks[check.key];else s.checks[check.key]=check.before;}
 } else throw new Error('不支援的操作');
 s.applied.push(cmd.id);
 return s;
}
