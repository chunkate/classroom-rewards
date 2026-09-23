import {applyCommand,type State,type Command} from './rewards';

type Reply={status:number;body:Record<string,unknown>};
let endpoint:Promise<string>|undefined;
let session=localStorage.getItem('classroom-session')??sessionStorage.getItem('classroom-session')??'';
const visualPreview=import.meta.env.DEV&&new URLSearchParams(location.search).has('preview');
const previewDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let previewSnapshot:{state:State;revision:number}|undefined;
function previewData(){
 if(previewSnapshot)return previewSnapshot;
 const date=previewDate();
 previewSnapshot={revision:0,state:{
  tasks:[{id:'preview-homework',title:'準時交作業',points:2,archived:false},{id:'preview-reading',title:'閱讀小達人',points:1,archived:false}],
  checks:{},rounds:{[date+':preview-homework']:{id:'preview-round',number:2,students:[],confirmed:false}},
  actions:[],applied:[]
 }};
 return previewSnapshot;
}
function previewReply(path:string,options:RequestInit){
 if(path==='/api/auth')return new Response(JSON.stringify({authenticated:true}),{status:200,headers:{'Content-Type':'application/json'}});
 if(options.method==='POST'){
  const payload=JSON.parse(String(options.body)) as {revision:number;command:Command};
  const current=previewData();
  if(!current.state.applied.includes(payload.command.id)&&payload.revision!==current.revision)return new Response(JSON.stringify({...current,error:'其他預覽操作已有更新，請再次操作。'}),{status:409,headers:{'Content-Type':'application/json'}});
  if(!current.state.applied.includes(payload.command.id)){previewSnapshot={state:applyCommand(current.state,payload.command),revision:current.revision+1};}
 }
 return new Response(JSON.stringify(previewData()),{status:200,headers:{'Content-Type':'application/json'}});
}
function keepSession(value:string,persistent=false){session=value;if(!value){sessionStorage.removeItem('classroom-session');localStorage.removeItem('classroom-session');}else if(persistent){localStorage.setItem('classroom-session',value);sessionStorage.removeItem('classroom-session');}else{sessionStorage.setItem('classroom-session',value);localStorage.removeItem('classroom-session');}}
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
async function getEndpoint(){
 if(!endpoint)endpoint=(async()=>{
  const config=await (await fetch(import.meta.env.BASE_URL+'config.json',{cache:'no-store'})).json();
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(config.appsScriptUrl??''))throw new Error('尚未連接 Google 試算表，請先完成網站設定。');
  return config.appsScriptUrl as string;
 })().catch(e=>{endpoint=undefined;throw e;});
 return endpoint;
}
async function rpc(payload:Record<string,unknown>):Promise<Reply>{
 const url=await getEndpoint(),callback=`__classroom_${crypto.randomUUID().replaceAll('-','')}`;
 return new Promise((resolve,reject)=>{
  const script=document.createElement('script'),scope=window as unknown as Record<string,unknown>;
  const finish=()=>{clearTimeout(timer);script.remove();delete scope[callback];};
  const timer=setTimeout(()=>{finish();reject(new Error('連線逾時，請按重試確認原操作。'));},45000);
  scope[callback]=(reply:Reply)=>{finish();resolve(reply);};script.onerror=()=>{finish();reject(new Error('Google 試算表連線失敗，請確認網路後重試。'));};
  script.src=`${url}?callback=${callback}&payload=${encodeURIComponent(JSON.stringify({...payload,token:session}))}`;document.head.appendChild(script);
 });
}
async function verifier(password:string,salt:string){const input=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:100000},input,256));}
export async function apiFetch(path:string,options:RequestInit={}):Promise<Response>{
 if(visualPreview)return previewReply(path,options);
 const body=options.body?JSON.parse(String(options.body)):{};let result:Reply;
 if(path==='/api/auth'&&options.method==='POST'&&['login','password'].includes(body.action)){
  const challenge=await rpc({op:'challenge',purpose:body.action});
  if(challenge.status!==200)result=challenge;
  else{
   const {salt,id}=challenge.body as {salt:string;id:string};
   const keyHex=await verifier(body.password,salt);let newVerifier='';
   if(body.action==='password'){
    if(typeof body.newPassword!=='string'||body.newPassword.length<12||body.newPassword.length>128)return new Response(JSON.stringify({error:'新密碼需要 12～128 個字元。'}),{status:400});
    const newSalt=hex(crypto.getRandomValues(new Uint8Array(32)).buffer);newVerifier=newSalt+':'+await verifier(body.newPassword,newSalt);
   }
   const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(keyHex),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const proof=hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${id}|${body.action}|${newVerifier}`)));
   result=await rpc({op:body.action,id,proof,newVerifier,remember:body.action==='login'&&body.remember===true});
  }
 }else result=await rpc({op:path==='/api/auth'?(body.action==='logout'?'logout':'status'):(options.method==='POST'?'write':'read'),...body});
 if(typeof result.body.token==='string')keepSession(result.body.token,result.body.remember===true);
 if(result.status===401||body.action==='logout')keepSession('');
 return new Response(JSON.stringify(result.body),{status:result.status,headers:{'Content-Type':'application/json'}});
}
