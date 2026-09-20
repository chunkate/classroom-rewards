import {pbkdf2Sync,randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
// Input is intentionally taken from stdin, never a command argument or tracked configuration.
let password='';for await(const chunk of process.stdin)password+=chunk;password=password.trimEnd();
if(password.length<12||password.length>128)throw new Error('密碼需要 12～128 個字元。');
const salt=randomBytes(32).toString('hex'),value=salt+':'+pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex');
mkdirSync(new URL('../private/',import.meta.url),{recursive:true});writeFileSync(new URL('../private/password-verifier.txt',import.meta.url),value);
console.log('密碼驗證值已寫入 private/password-verifier.txt。僅供 Apps Script 的 PASSWORD_VERIFIER 設定，請勿公開。');
