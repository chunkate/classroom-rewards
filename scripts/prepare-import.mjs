import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const input=process.argv[2];if(!input)throw new Error('請提供舊網站「下載完整紀錄」的 JSON 路徑。');
const parsed=JSON.parse(readFileSync(input,'utf8').replace(/^\uFEFF/,''));const s=parsed.state;
if(!s||!Array.isArray(s.actions)||!Array.isArray(s.tasks)||!Array.isArray(s.applied)||!s.checks)throw new Error('不是完整班級紀錄備份。');
for(const a of s.actions)if(!Array.isArray(a.entries)||a.entries.some(e=>!Number.isInteger(e.student)||e.student<1||e.student>30||!Number.isInteger(e.amount)))throw new Error('備份含有無效計分紀錄，已停止移轉。');
const text=JSON.stringify(s),hash=createHash('sha256').update(text).digest('hex');
const payload=Buffer.from(text).toString('base64');
const source=`// PRIVATE: contains classroom history. Never upload to GitHub.\nfunction importBaseline_(){\nconst lock=LockService.getScriptLock();lock.waitLock(10000);\ntry{const b=book_();if(b.getSheetByName('操作紀錄').getLastRow()>1||b.getSheetByName('移轉資料').getLastRow()>1)throw new Error('已有紀錄，拒絕覆蓋');\nconst text=Utilities.newBlob(Utilities.base64Decode(${JSON.stringify(payload)})).getDataAsString('UTF-8');\nif(hash_(text)!==${JSON.stringify(hash)})throw new Error('備份驗證失敗');\nconst chunks=text.match(/[\\s\\S]{1,30000}/g).map(t=>[JSON.stringify(t)]);\nb.getSheetByName('移轉資料').getRange(2,1,chunks.length,1).setValues(chunks);SpreadsheetApp.flush();props_().setProperty('BASELINE_SHA256',${JSON.stringify(hash)});summary_(read_());\n}finally{lock.releaseLock();}\n}\n`;
const dir=new URL('../private/',import.meta.url);mkdirSync(dir,{recursive:true});writeFileSync(new URL('Import.gs',dir),source);
console.log('已建立私密移轉檔：'+fileURLToPath(new URL('Import.gs',dir))+'。請只貼到私人 Apps Script 專案。');

