// Bind this project to the private score spreadsheet. Never publish Script Properties.
function props_(){return PropertiesService.getScriptProperties();}
function hex_(bytes){return bytes.map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function hash_(text){return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8));}
function random_(){return Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');}
function equal_(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
function reply_(status,body){return {status,body};}
function book_(){return SpreadsheetApp.openById(props_().getProperty('SPREADSHEET_ID'));}
function session_(token){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return false;return CacheService.getScriptCache().get('session:'+hash_(token))===hash_(props_().getProperty('PASSWORD_VERIFIER')||'');}
function login_(){const token=random_();CacheService.getScriptCache().put('session:'+hash_(token),hash_(props_().getProperty('PASSWORD_VERIFIER')),21600);return reply_(200,{authenticated:true,token});}
function doGet(e){
 const callback=e?.parameter?.callback||'';
 if(callback){
  if(!/^__classroom_[a-f0-9]{32}$/.test(callback))return ContentService.createTextOutput('/* invalid callback */').setMimeType(ContentService.MimeType.JAVASCRIPT);
  let reply;try{reply=classroomRpc(JSON.parse(e?.parameter?.payload||'{}'));}catch(error){reply=reply_(503,{error:'Google 試算表暫時無法使用，請重試原操作。'});}
  const data=JSON.stringify(reply).replace(/</g,'\\u003c');
  return ContentService.createTextOutput(callback+'('+data+');').setMimeType(ContentService.MimeType.JAVASCRIPT);
 }
 const origin=props_().getProperty('GITHUB_ORIGIN');const channel=e?.parameter?.channel||'';
 if(!/^https:\/\/[a-zA-Z0-9-]+\.github\.io$/.test(origin||'')||!/^[a-f0-9-]{36}$/.test(channel))return HtmlService.createHtmlOutput('班級獎勵簿：請由已設定的 GitHub 網址開啟。');
 const t=HtmlService.createTemplateFromFile('Bridge');t.channel=channel;t.allowedOrigin=origin;
 return t.evaluate().setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function doPost(e){
 const origin=props_().getProperty('GITHUB_ORIGIN'),channel=e?.parameter?.channel||'',id=e?.parameter?.id||'';
 if(!/^https:\/\/[a-zA-Z0-9-]+\.github\.io$/.test(origin||'')||!/^[a-f0-9-]{36}$/.test(channel)||!/^[a-f0-9-]{36}$/.test(id))return HtmlService.createHtmlOutput('無效的請求。');
 let reply;try{reply=classroomRpc(JSON.parse(e?.parameter?.payload||'{}'));}catch(error){reply=reply_(503,{error:'Google 試算表暫時無法使用，請重試原操作。'});}
 const message=JSON.stringify({type:'classroom-response',channel,id,reply}).replace(/</g,'\\u003c');
 return HtmlService.createHtmlOutput('<script>window.top.postMessage('+message+','+JSON.stringify(origin)+');<\/script>').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
// Only RPC is remotely callable. All privileged setup helpers end with an underscore.
function classroomRpc(req){
 if(!req||JSON.stringify(req).length>12000)return reply_(400,{error:'資料格式不正確。'});
 const lock=LockService.getScriptLock();if(!lock.tryLock(10000))return reply_(503,{error:'正在儲存其他操作，請稍後重試原操作。'});
 try{
  const p=props_(),cache=CacheService.getScriptCache();const encoded=p.getProperty('PASSWORD_VERIFIER');
  if(!/^[a-f0-9]{64}:[a-f0-9]{64}$/.test(encoded||''))return reply_(503,{error:'管理者尚未完成系統密碼設定。'});
  if(req.op==='status')return reply_(200,{authenticated:session_(req.token)});
  if(req.op==='challenge'){
   if(!['login','password'].includes(req.purpose))return reply_(400,{error:'不支援的操作。'});
   if(req.purpose==='password'&&!session_(req.token))return reply_(401,{error:'請重新登入。'});
   const window=Math.floor(Date.now()/900000),key='attempts:'+window;
   const attempts=Number(p.getProperty('LOGIN_ATTEMPTS')?.split(':')[0]===String(window)?p.getProperty('LOGIN_ATTEMPTS').split(':')[1]:0);
   if(attempts>=30)return reply_(429,{error:'登入嘗試過多，請於 15 分鐘後再試。'});
   p.setProperty('LOGIN_ATTEMPTS',window+':'+(attempts+1));
   const id=random_();cache.put('challenge:'+id,JSON.stringify({purpose:req.purpose,version:hash_(encoded)}),120);
   return reply_(200,{id,salt:encoded.split(':')[0]});
  }
  if(['login','password'].includes(req.op)){
   if(typeof req.id!=='string'||!/^[a-f0-9]{64}$/.test(req.id))return reply_(401,{error:'登入已逾時，請再試一次。'});
   const raw=cache.get('challenge:'+req.id);cache.remove('challenge:'+req.id);
   const challenge=raw?JSON.parse(raw):null;
   const next=req.newVerifier||'';
   const expected=hex_(Utilities.computeHmacSha256Signature(req.id+'|'+req.op+'|'+next,encoded.split(':')[1],Utilities.Charset.UTF_8));
   if(!challenge||challenge.purpose!==req.op||challenge.version!==hash_(encoded)||!equal_(expected,req.proof))return reply_(401,{error:'密碼不正確或登入已逾時。'});
   if(req.op==='password'){
    if(!session_(req.token))return reply_(401,{error:'請重新登入。'});
    if(!/^[a-f0-9]{64}:[a-f0-9]{64}$/.test(next))return reply_(400,{error:'新密碼格式不正確。'});
    p.setProperty('PASSWORD_VERIFIER',next);
   }
   return login_();
  }
  if(req.op==='logout'){if(typeof req.token==='string')cache.remove('session:'+hash_(req.token));return reply_(200,{authenticated:false});}
  if(!session_(req.token))return reply_(401,{error:'請先登入班級系統。'});
  if(!['read','write'].includes(req.op))return reply_(400,{error:'不支援的操作。'});
  const snapshot=read_();
  if(req.op==='write'){
   const cmd=req.command;
   if(!cmd||typeof cmd.id!=='string')return reply_(400,{error:'操作資料不正確。'});
   if(!snapshot.state.applied.includes(cmd.id)){
    if(req.revision!==snapshot.revision)return reply_(409,{...snapshot,error:'其他裝置已有更新，已重新載入，請再次操作。'});
    let next;try{next=model_().applyCommand(snapshot.state,cmd);}catch(e){return reply_(400,{error:e.message});}
    const at=new Date().toISOString();const a=next.actions.find(a=>a.id===cmd.id);if(a)a.time=at;
    // One complete journal row is the commit. A retry replays the row and deduplicates by ID.
    const journal=book_().getSheetByName('操作紀錄');
    journal.appendRow([snapshot.revision+1,cmd.id,cmd.date,cmd.type,at,JSON.stringify(cmd),JSON.stringify({reason:a?.reason||cmd.title||'',students:cmd.students||[]})]);
    SpreadsheetApp.flush();snapshot.state=next;snapshot.revision++;
   }
  }
  try{if(snapshot.revision>0&&snapshot.revision%25===0)checkpoint_(snapshot);summary_(snapshot);}catch(e){snapshot.warning='紀錄已保存；試算表總分顯示稍後重新讀取時更新。';}
  return reply_(200,snapshot);
 }catch(e){console.error('Classroom storage operation failed');return reply_(503,{error:'Google 試算表暫時無法讀寫，請重試原操作。'});}
 finally{lock.releaseLock();}
}
function read_(){
 const model=model_(),book=book_(),baseline=book.getSheetByName('移轉資料'),journal=book.getSheetByName('操作紀錄');
 if(!baseline||!journal)throw new Error('未初始化');
 const rows=baseline.getDataRange().getValues();let state=model.initialState();
 if(rows.length>1){const text=rows.slice(1).map(r=>JSON.parse(r[0])).join('');if(hash_(text)!==props_().getProperty('BASELINE_SHA256'))throw new Error('移轉資料不完整');state=JSON.parse(text);}
 let revision=0;const last=journal.getLastRow()-1;
 // Checkpoints are disposable accelerators. A torn/corrupt checkpoint falls back to the journal.
 const checkpoint=book.getSheetByName('讀取快照');
 if(checkpoint&&checkpoint.getLastRow()>1){try{const c=checkpoint.getDataRange().getValues(),text=c.slice(1).map(r=>JSON.parse(r[0])).join('');if(Number.isInteger(c[0][0])&&c[0][0]>0&&c[0][0]<=last&&hash_(text)===c[0][1]){state=JSON.parse(text);revision=c[0][0];}}catch(e){/* replay durable journal */}}
 const events=last>revision?journal.getRange(revision+2,1,last-revision,7).getValues():[];
 for(const row of events){if(row[0]!==revision+1)throw new Error('紀錄順序不完整');const cmd=JSON.parse(row[5]);if(cmd.id!==row[1]||state.applied.includes(cmd.id))throw new Error('紀錄編號重複');state=model.applyCommand(state,cmd);const a=state.actions.find(a=>a.id===cmd.id);if(a)a.time=row[4];revision++;}
 return {state,revision};
}
function checkpoint_(snapshot){
 const b=book_(),s=b.getSheetByName('讀取快照')||b.insertSheet('讀取快照');const text=JSON.stringify(snapshot.state),chunks=text.match(/[\s\S]{1,30000}/g)||[];
 const rows=[[snapshot.revision,hash_(text)],...chunks.map(t=>[JSON.stringify(t),''])];s.clearContents();s.getRange(1,1,rows.length,2).setValues(rows);
}
function summary_(snapshot){
 const s=book_().getSheetByName('累積總分'),m=model_();const total=m.scores(snapshot.state),task=m.scores(snapshot.state,undefined,'check'),reward=m.scores(snapshot.state,undefined,'reward'),redeemed=m.redeemedScores(snapshot.state),available=m.availableScores(snapshot.state),badges=m.redemptionCounts(snapshot.state);
 s.getRange(2,1,30,7).setValues(m.seats.map(n=>[n,task[n],reward[n],total[n],redeemed[n],available[n],badges[n]]));s.getRange('I1:J2').setValues([['紀錄版本','更新時間'],[snapshot.revision,new Date().toISOString()]]);
}
// Run once from the Apps Script editor after creating/importing the private workbook.
function initialize_(){
 const lock=LockService.getScriptLock();lock.waitLock(10000);
 try{const b=book_();for(const [name,headers] of [['累積總分',['座號','任務檢核','課堂獎勵','學期總分','已兌換','可用點數','獎勵章']],['操作紀錄',['版本','操作編號','日期','類型','儲存時間','原始操作（請勿修改）','內容']],['移轉資料',['移轉基底（請勿修改）']]]){
  const sheet=b.getSheetByName(name)||b.insertSheet(name);sheet.getRange(1,1,1,headers.length).setValues([headers]);sheet.setFrozenRows(1);
 }summary_(read_());}finally{lock.releaseLock();}
}

