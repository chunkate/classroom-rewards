# 高老師的班級獎勵簿

適合國小課堂使用的 30 人班級獎勵與任務檢核網站。前端部署於 GitHub Pages，分數、任務、兌換及操作紀錄儲存在老師私人 Google 試算表中。

## 資料架構

- GitHub Pages：只放公開的網站程式與版面。
- Google Apps Script：驗證系統密碼，並處理網站與試算表之間的讀寫。
- Google 試算表：保留學生分數與操作紀錄，不放入 GitHub。

`public/config.json` 只記錄公開的 Apps Script 網頁應用程式網址，不得放入試算表 ID、密碼或任何學生資料。

## 本機檢查

```bash
npm ci
npm test
npm run check
npm run build
```

## 發布

推送至 `main` 分支後，`.github/workflows/pages.yml` 會自動測試、建置並發布 GitHub Pages。

Google Apps Script 的指令碼位於 `apps-script/`。部署時需在「指令碼屬性」中設定：

- `SPREADSHEET_ID`：私人 Google 試算表 ID
- `GITHUB_ORIGIN`：GitHub Pages 網站來源，例如 `https://帳號.github.io`
- `PASSWORD_VERIFIER`：由 `node scripts/password-verifier.mjs` 產生；不可提交至 GitHub

部署完成後，把 Apps Script 網頁應用程式網址填入 `public/config.json`，再推送更新。
