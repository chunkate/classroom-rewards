import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash,createHmac,randomUUID,pbkdf2Sync} from 'node:crypto';
import ts from 'typescript';
function setup(){
 const props=new Map(),cache=new Map(),sheets=new Map();let flushFail=false,summaryFail=false;
 class Sheet{
  rows=[];constructor(name){this.name=name;}
  getLastRow(){return this.rows.length;}
  appendRow(row){this.rows.push([...row]);return this;}
  clearContents(){this.rows=[];return this;}
  setFrozenRows(){}
  getDataRange(){return {getValues:()=>this.rows.length?structuredClone(this.rows):[['']]};}
  getRange(r,c,n,m){
   if(typeof r==='string'){[r,c,n,m]=[1,9,2,2];}
   return {getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>this.rows[r+i-1]?.[c+j-1]??'')),setValues:values=>{
    if(summaryFail&&this.name==='累積總分')throw new Error('projection failed');
    for(let i=0;i<values.length;i++){this.rows[r+i-1]??=[];for(let j=0;j<values[i].length;j++)this.rows[r+i-1][c+j-1]=values[i][j];}
   }};
  }
 }
 const book={getSheetByName:n=>sheets.get(n),insertSheet:n=>{const s=new Sheet(n);sheets.set(n,s);return s;}};
 const ctx=vm.createContext({console:{error(){}},Date,Intl,JSON,Utilities:{getUuid:randomUUID,DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>[...createHash('sha256').update(s).digest()],computeHmacSha256Signature:(s,k)=>[...createHmac('sha256',k).update(s).digest()]},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)??null,setProperty:(k,v)=>props.set(k,v)})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k)??null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},LockService:{getScriptLock:()=>({tryLock:()=>true,waitLock(){},releaseLock(){}})},SpreadsheetApp:{openById:()=>book,flush:()=>{if(flushFail){flushFail=false;throw new Error('lost response');}}}});
 const source=readFileSync(new URL('../lib/rewards.ts',import.meta.url),'utf8').replace(/export /g,'').replace('structuredClone(current)','JSON.parse(JSON.stringify(current))');
 const model=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInContext('function model_(){'+model+';return {initialState,applyCommand,scores,redeemedScores,availableScores,redemptionCounts,seats};}',ctx);
 vm.runInContext(readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),ctx);
 const salt='a'.repeat(64),key=pbkdf2Sync('test-password-only',salt,100000,32,'sha256').toString('hex');props.set('PASSWORD_VERIFIER',salt+':'+key);ctx.initialize_();
 const rpc=r=>JSON.parse(JSON.stringify(ctx.classroomRpc(r)));
 const auth=(op='login',token='',next='')=>{const c=rpc({op:'challenge',purpose:op,token});assert.equal(c.status,200);return rpc({op,token,id:c.body.id,newVerifier:next,proof:createHmac('sha256',key).update(c.body.id+'|'+op+'|'+next).digest('hex')});};
 return {rpc,auth,props,cache,sheets,ctx,failFlush:()=>flushFail=true,failSummary:v=>summaryFail=v};
}
const command=(type,extra={})=>({id:randomUUID(),date:'2026-09-06',type,...extra});
test('GAS: authentication gates all classroom reads and writes; wrong proof and replay fail',()=>{
 const h=setup();assert.equal(h.rpc({op:'read'}).status,401);assert.equal(h.rpc({op:'write'}).status,401);
 const c=h.rpc({op:'challenge',purpose:'login'});const bad={op:'login',id:c.body.id,proof:'x'};assert.equal(h.rpc(bad).status,401);assert.equal(h.rpc(bad).status,401);
 const a=h.auth();assert.equal(a.status,200);assert.equal(h.rpc({op:'read',token:a.body.token}).status,200);
 h.rpc({op:'logout',token:a.body.token});assert.equal(h.rpc({op:'read',token:a.body.token}).status,401);
});
test('GAS: negative rewards, stale revision, retry, and durable replay',()=>{
 const h=setup(),token=h.auth().body.token,c=command('reward',{students:[1,30],amount:-2}),req={op:'write',token,revision:0,command:c};
 const first=h.rpc(req);assert.equal(first.status,200);assert.equal(first.body.revision,1);assert.equal(h.rpc(req).body.revision,1);
 assert.equal(h.rpc({...req,command:command('reward',{students:[1],amount:3})}).status,409);
 const saved=h.rpc({op:'read',token});assert.equal(saved.body.state.actions.length,1);assert.equal(h.sheets.get('累積總分').rows[1][3],-2);
});
test('GAS: lost response after append cannot double award on retry',()=>{
 const h=setup(),token=h.auth().body.token,req={op:'write',token,revision:0,command:command('reward',{students:[1],amount:5})};h.failFlush();assert.equal(h.rpc(req).status,503);const r=h.rpc(req);assert.equal(r.status,200);assert.equal(r.body.state.actions.length,1);assert.equal(h.sheets.get('累積總分').rows[1][3],5);
});
test('GAS: projection failure preserves journal and is repaired by read',()=>{
 const h=setup(),token=h.auth().body.token;h.failSummary(true);const r=h.rpc({op:'write',token,revision:0,command:command('reward',{students:[2],amount:2})});assert.equal(r.status,200);assert.ok(r.body.warning);h.failSummary(false);assert.equal(h.rpc({op:'read',token}).body.revision,1);assert.equal(h.sheets.get('累積總分').rows[2][3],2);
});
test('GAS: confirm, clear, reuse and undo preserve per-round accounting',()=>{
 const h=setup(),token=h.auth().body.token;let revision=0;const write=c=>{const r=h.rpc({op:'write',token,revision,command:c});assert.equal(r.status,200);revision=r.body.revision;return r.body;};
 const task=command('task',{title:'交作業',points:2});write(task);write(command('confirmRound',{taskId:task.id,roundId:'initial',students:[1,2]}));
 const clear=command('clearRound',{taskId:task.id,roundId:'initial'});write(clear);assert.equal(h.sheets.get('累積總分').rows[1][3],2);
 const next=command('confirmRound',{taskId:task.id,roundId:clear.id,students:[1]});write(next);assert.equal(h.sheets.get('累積總分').rows[1][3],4);
 write(command('undo',{actionId:next.id}));assert.equal(h.sheets.get('累積總分').rows[1][3],2);
});
test('GAS: redemption projects gross, redeemed, available, and badge count',()=>{
 const h=setup(),token=h.auth().body.token;let revision=0;const write=c=>{const r=h.rpc({op:'write',token,revision,command:c});assert.equal(r.status,200);revision=r.body.revision;return r.body;};
 write(command('reward',{students:[1],amount:35}));const redeem=command('redeem',{student:1,amount:20});write(redeem);let row=h.sheets.get('累積總分').rows[1];assert.deepEqual(row.slice(3,7),[35,20,15,1]);
 write(command('undo',{actionId:redeem.id}));row=h.sheets.get('累積總分').rows[1];assert.deepEqual(row.slice(3,7),[35,0,35,0]);
});
test('GAS: valid checkpoints accelerate reads; corrupt checkpoints replay journal',()=>{
 const h=setup(),token=h.auth().body.token;for(let i=0;i<26;i++)assert.equal(h.rpc({op:'write',token,revision:i,command:command('reward',{students:[1],amount:1})}).status,200);
 assert.equal(h.rpc({op:'read',token}).body.revision,26);assert.equal(h.sheets.get('讀取快照').rows[0][0],25);
 h.sheets.get('讀取快照').rows[1][0]='broken';const r=h.rpc({op:'read',token});assert.equal(r.status,200);assert.equal(r.body.state.actions.length,26);assert.equal(h.sheets.get('累積總分').rows[1][3],26);
});
test('GAS: changing password revokes old sessions and old challenges',()=>{
 const h=setup(),old=h.auth().body.token,next='b'.repeat(64)+':'+'c'.repeat(64);const r=h.auth('password',old,next);assert.equal(r.status,200);assert.equal(h.rpc({op:'read',token:old}).status,401);assert.equal(h.rpc({op:'read',token:r.body.token}).status,200);
});
test('GAS: login attempts are limited and malformed baseline fails closed',()=>{
 const h=setup(),token=h.auth().body.token;for(let i=0;i<29;i++)assert.equal(h.rpc({op:'challenge',purpose:'login'}).status,200);assert.equal(h.rpc({op:'challenge',purpose:'login'}).status,429);
 h.sheets.get('移轉資料').appendRow(['broken']);assert.equal(h.rpc({op:'read',token}).status,503);
});
