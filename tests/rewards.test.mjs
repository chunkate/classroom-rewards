import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyCommand, scores, redeemedScores, availableScores, redemptionCounts, scoresBetween, weekRange, checkKey, seats } from '../lib/rewards.ts';
let sequence=0;
const cmd=(type,extra={},date='2026-09-05')=>({id:`test-command-${++sequence}`,date,type,...extra});
test('daily rewards allow negatives and retain cumulative totals across days',()=>{
 let s=initialState();s=applyCommand(s,cmd('reward',{students:[1],amount:-2}));s=applyCommand(s,cmd('reward',{students:seats,amount:5},'2026-09-06'));
 assert.equal(scores(s,'2026-09-05')[1],-2);assert.equal(scores(s,'2026-09-06')[1],5);assert.equal(scores(s)[1],3);assert.equal(scores(s)[30],5);
});
test('retry and repeated completed status never award twice',()=>{
 let s=initialState();const t=cmd('task',{title:'交作業',points:2});s=applyCommand(s,t);
 const check=cmd('check',{taskId:t.id,student:1,completed:true});s=applyCommand(s,check);s=applyCommand(s,check);s=applyCommand(s,cmd('check',{taskId:t.id,student:1,completed:true}));assert.equal(scores(s)[1],2);
});
test('cancel completion reverses originally awarded amount after task edit; undo restores both',()=>{
 let s=initialState();const t=cmd('task',{title:'交作業',points:2});s=applyCommand(s,t);s=applyCommand(s,cmd('check',{taskId:t.id,student:1,completed:true}));s=applyCommand(s,cmd('task',{taskId:t.id,title:'交作業',points:5}));
 const cancel=cmd('check',{taskId:t.id,student:1,completed:false});s=applyCommand(s,cancel);assert.equal(scores(s)[1],0);
 s=applyCommand(s,cmd('undo',{actionId:cancel.id}));assert.equal(scores(s)[1],2);assert.equal(s.checks[checkKey('2026-09-05',t.id,1)],2);
});
test('same task has independent daily checklist, zero point tasks still track completion',()=>{
 let s=initialState();const t=cmd('task',{title:'聯絡簿',points:0});s=applyCommand(s,t);s=applyCommand(s,cmd('check',{taskId:t.id,student:30,completed:true}));assert.equal(s.checks[checkKey('2026-09-05',t.id,30)],0);assert.equal(s.checks[checkKey('2026-09-06',t.id,30)],undefined);assert.equal(scores(s)[30],0);
});
test('archive preserves scores and rejects new checks; invalid scores and dates rejected',()=>{
 let s=initialState();const t=cmd('task',{title:'打掃',points:1});s=applyCommand(s,t);s=applyCommand(s,cmd('check',{taskId:t.id,student:1,completed:true}));s=applyCommand(s,cmd('archive',{taskId:t.id,archived:true}));assert.equal(scores(s)[1],1);assert.throws(()=>applyCommand(s,cmd('check',{taskId:t.id,student:2,completed:true})));
 for(const amount of [0,0.5,101])assert.throws(()=>applyCommand(s,cmd('reward',{students:[1],amount})));
 assert.throws(()=>applyCommand(s,cmd('reward',{students:[1,1],amount:1})));
 assert.throws(()=>applyCommand(s,cmd('reward',{students:[1],amount:1},'2026-02-30')));
});
test('undo a full-class reward reverts all students and preserves audit record',()=>{
 let s=initialState();const r=cmd('reward',{students:seats,amount:5});s=applyCommand(s,r);s=applyCommand(s,cmd('undo',{actionId:r.id}));assert.ok(seats.every(n=>scores(s)[n]===0));assert.equal(s.actions[0].undone,true);assert.throws(()=>applyCommand(s,cmd('undo',{actionId:r.id})));
});
test('batch confirms 30 checks in one action; retry and identical submission never duplicate points',()=>{
 let s=initialState();const t=cmd('task',{title:'每日作業',points:2});s=applyCommand(s,t);
 const batch=cmd('checkBatch',{taskId:t.id,changes:seats.map(student=>({student,completed:true}))});
 assert.equal(s.actions.length,0);s=applyCommand(s,batch);assert.equal(s.actions.length,1);assert.equal(s.actions[0].entries.length,30);assert.ok(seats.every(n=>scores(s)[n]===2));
 s=applyCommand(s,batch);s=applyCommand(s,cmd('checkBatch',{taskId:t.id,changes:batch.changes}));assert.equal(s.actions.length,1);assert.ok(seats.every(n=>scores(s)[n]===2));
 s=applyCommand(s,cmd('undo',{actionId:batch.id}));assert.ok(seats.every(n=>scores(s)[n]===0));assert.equal(Object.keys(s.checks).length,0);
});
test('mixed batch changes only explicit seats; cancellation uses original award and undo restores all',()=>{
 let s=initialState();const t=cmd('task',{title:'每日作業',points:2});s=applyCommand(s,t);s=applyCommand(s,cmd('checkBatch',{taskId:t.id,changes:[{student:1,completed:true},{student:3,completed:true}]}));
 s=applyCommand(s,cmd('task',{taskId:t.id,title:'每日作業',points:5}));const batch=cmd('checkBatch',{taskId:t.id,changes:[{student:1,completed:false},{student:2,completed:true}]});
 s=applyCommand(s,batch);assert.equal(scores(s)[1],0);assert.equal(scores(s)[2],5);assert.equal(scores(s)[3],2);assert.deepEqual(s.actions.at(-1).entries,[{student:1,amount:-2},{student:2,amount:5}]);
 s=applyCommand(s,cmd('undo',{actionId:batch.id}));assert.equal(scores(s)[1],2);assert.equal(scores(s)[2],0);assert.equal(scores(s)[3],2);
});
test('the same task accepts a new daily batch while keeping yesterday and cumulative scores',()=>{
 let s=initialState();const t=cmd('task',{title:'每日閱讀',points:1});s=applyCommand(s,t);s=applyCommand(s,cmd('checkBatch',{taskId:t.id,changes:[{student:1,completed:true}]}));
 assert.equal(s.checks[checkKey('2026-09-06',t.id,1)],undefined);
 s=applyCommand(s,cmd('checkBatch',{taskId:t.id,changes:[{student:1,completed:true}]},'2026-09-06'));
 assert.equal(scores(s,'2026-09-05')[1],1);assert.equal(scores(s,'2026-09-06')[1],1);assert.equal(scores(s)[1],2);
});
test('invalid batch is rejected atomically without changing scores or check state',()=>{
 let s=initialState();const t=cmd('task',{title:'作業',points:1});s=applyCommand(s,t);const original=structuredClone(s);
 for(const changes of [[],[{student:1,completed:true},{student:31,completed:true}],[{student:1,completed:true},{student:1,completed:false}],[{student:1,completed:'true'}]])assert.throws(()=>applyCommand(s,cmd('checkBatch',{taskId:t.id,changes})));
 assert.deepEqual(s,original);
});
test('round confirm is idempotent, clear preserves scores, and the next round can award again',()=>{
 let s=initialState();const t=cmd('task',{title:'專心上課',points:2});s=applyCommand(s,t);
 const confirm=cmd('confirmRound',{taskId:t.id,roundId:'initial',students:[1,2]});s=applyCommand(s,confirm);s=applyCommand(s,confirm);s=applyCommand(s,cmd('confirmRound',{taskId:t.id,roundId:'initial',students:[2,1]}));assert.equal(scores(s)[1],2);assert.equal(s.actions.length,1);
 const clear=cmd('clearRound',{taskId:t.id,roundId:'initial'});s=applyCommand(s,clear);s=applyCommand(s,clear);assert.equal(scores(s)[1],2);assert.equal(s.rounds['2026-09-05:'+t.id].number,2);assert.deepEqual(s.rounds['2026-09-05:'+t.id].students,[]);
 s=applyCommand(s,cmd('confirmRound',{taskId:t.id,roundId:clear.id,students:[1]}));assert.equal(scores(s)[1],4);assert.equal(scores(s)[2],2);assert.equal(s.actions.length,2);
 s=applyCommand(s,cmd('confirmRound',{taskId:t.id,roundId:'initial',students:[1]},'2026-09-06'));assert.equal(scores(s)[1],6);assert.equal(scores(s,'2026-09-05')[1],4);
});
test('legacy daily checks remain credited after switching to rounds and clearing',()=>{
 let s=initialState();const t=cmd('task',{title:'作業',points:1});s=applyCommand(s,t);s=applyCommand(s,cmd('check',{taskId:t.id,student:1,completed:true}));const clear=cmd('clearRound',{taskId:t.id,roundId:'initial'});s=applyCommand(s,clear);assert.equal(scores(s)[1],1);
 s=applyCommand(s,cmd('confirmRound',{taskId:t.id,roundId:clear.id,students:[1]}));assert.equal(scores(s)[1],2);assert.throws(()=>applyCommand(s,cmd('checkBatch',{taskId:t.id,changes:[{student:1,completed:false}]})));
});
test('undo of previous round does not restore its marks into a cleared new round',()=>{
 let s=initialState();const t=cmd('task',{title:'閱讀',points:1});s=applyCommand(s,t);const saved=cmd('confirmRound',{taskId:t.id,roundId:'initial',students:[1]});s=applyCommand(s,saved);const clear=cmd('clearRound',{taskId:t.id,roundId:'initial'});s=applyCommand(s,clear);
 s=applyCommand(s,cmd('undo',{actionId:saved.id}));assert.equal(scores(s)[1],0);assert.deepEqual(s.rounds['2026-09-05:'+t.id],{id:clear.id,number:2,students:[],confirmed:false});
 assert.throws(()=>applyCommand(s,cmd('confirmRound',{taskId:t.id,roundId:'initial',students:[1]})));
 const next=cmd('confirmRound',{taskId:t.id,roundId:clear.id,students:[2]});s=applyCommand(s,next);s=applyCommand(s,cmd('undo',{actionId:next.id}));assert.equal(s.rounds['2026-09-05:'+t.id].confirmed,false);assert.equal(scores(s)[2],0);
});
test('redemption preserves gross semester points, records badge count, and can be undone',()=>{
 let s=initialState();s=applyCommand(s,cmd('reward',{students:[1],amount:35}));const redeem=cmd('redeem',{student:1,amount:20});s=applyCommand(s,redeem);s=applyCommand(s,redeem);
 assert.equal(scores(s)[1],35);assert.equal(redeemedScores(s)[1],20);assert.equal(availableScores(s)[1],15);assert.equal(redemptionCounts(s)[1],1);assert.equal(s.actions.at(-1).balanceAfter,15);assert.equal(s.actions.at(-1).redemptionNumber,1);
 assert.throws(()=>applyCommand(s,cmd('redeem',{student:1,amount:20})));assert.throws(()=>applyCommand(s,cmd('redeem',{student:1,amount:15})));
 s=applyCommand(s,cmd('undo',{actionId:redeem.id}));assert.equal(scores(s)[1],35);assert.equal(redeemedScores(s)[1],0);assert.equal(availableScores(s)[1],35);assert.equal(redemptionCounts(s)[1],0);
});
test('weekly totals use Monday through Sunday without deleting earlier scores',()=>{
 let s=initialState();for(const [date,amount] of [['2026-08-30',1],['2026-08-31',2],['2026-09-06',3],['2026-09-07',4]])s=applyCommand(s,cmd('reward',{students:[1],amount},date));
 assert.deepEqual(weekRange('2026-09-05'),{start:'2026-08-31',end:'2026-09-06'});assert.equal(scoresBetween(s,'2026-08-31','2026-09-06')[1],5);assert.equal(scores(s)[1],10);
});
