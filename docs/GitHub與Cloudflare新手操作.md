# GitHub 與 Cloudflare 新手操作

## 先記住兩件事

GitHub 是專案的「檔案櫃與修改歷史」，Cloudflare 是網站的「公開服務」。修改本機檔案、提交到 GitHub、更新上線網站，是三個不同步驟。

| 名詞 | 可以怎麼理解 |
| --- | --- |
| Repository／倉庫 | 保存整個專案的資料夾。這個專案是 `AIbot1031/drinks_mk2`，目前為私人。 |
| Commit／提交 | 為一批修改拍一張可追溯的快照。 |
| Branch／分支 | 一條獨立修改線；`main` 是本專案主要版本。 |
| Push／推送 | 把本機提交傳到 GitHub。 |
| Pull／拉取 | 把 GitHub 上的新提交帶回本機。 |
| Pull request／PR | 請別人檢查一條分支，再合併到主要版本。 |
| Worker | Cloudflare 執行 API 與服務網站的程式。此專案叫 `drinks-mk2`。 |
| Deploy／部署 | 把程式發布成可從網址使用的網站。 |
| Wrangler | 此專案用來本機預覽與部署 Cloudflare 的工具。 |

## 怎麼看 GitHub 裡的檔案

1. 登入 GitHub，打開 [專案倉庫](https://github.com/AIbot1031/drinks_mk2)。
2. `Code` 分頁可看資料夾與檔案，首頁下方顯示 README。
3. 先看 `README.md`，再看 `docs/檔案用途說明書.md`。
4. 點上方的提交歷史，可看到每次修改的內容與日期。
5. `Actions` 分頁顯示自動檢查：綠色表示通過，紅色表示需要檢查錯誤。

目前 Actions 只測試，不會因為推送就自動改動正式網站。私人倉庫也不會讓已部署的網站變成私人。

## 在自己電腦預覽網站

先安裝 [Node.js](https://nodejs.org/)（建議 22 或更新的 LTS），在終端機進入本專案資料夾。以下指令一次執行一行：

```bash
cd /Users/ai/Documents/ChatGPT/drinks_mk2
npm ci
npm run db:local
npm run dev
```

終端機會顯示本機網址，例如 `http://localhost:8787`。打開它即可預覽。這不是網際網路公開網址；要停止預覽，在終端機按 `Control + C`。這台電腦的 `.dev.vars` 已經準備好。新下載的專案則可複製 `.dev.vars.example` 為 `.dev.vars`，換成自己的本機檢查密碼；不要覆蓋既有的秘密檔案。

編輯文字在 `public/index.html`，調整顏色與排版在 `public/styles.css`；推薦條件與排序在 `worker/`。改完後先測試：

```bash
npm run check
npm test
npm run deploy:check
```

## 把修改保存到 GitHub

```bash
git status
git diff
git add README.md public worker docs
git commit -m "說明這次改了什麼"
git push
```

`git status` 看修改的檔案，`git diff` 看文字差異。`git add` 請列出這次真正要保存的檔案或資料夾，不一定和範例相同。提交與推送後，可去 GitHub 的 `Actions` 確認檢查通過。

合作前可先執行 `git pull --ff-only`。如果提示衝突，先停下來看內容，不要直接使用強制推送或覆蓋原檔。

不想用終端機管理 Git 時，可以安裝 [GitHub Desktop](https://desktop.github.com/)，選擇這個本機倉庫，在 Changes 查看修改、填提交說明，再按 Commit 與 Push origin。[GitHub 官方新手文件](https://docs.github.com/en/get-started/start-your-journey/hello-world)有倉庫、分支與 PR 的圖解流程。

## 看 Cloudflare 上的網站

1. 登入 [Cloudflare 儀表板](https://dash.cloudflare.com/)。
2. 選擇本專案使用的帳戶。
3. 進入 `Workers & Pages`，選擇 `drinks-mk2`。
4. Overview 可找到網站網址；Deployments 可看發布紀錄；Observability 可看請求與錯誤。

介面名稱可能會隨 Cloudflare 更新，找不到時可對照 [Workers 官方文件](https://developers.cloudflare.com/workers/)。你的舊站 `drink-recommendation-relgt` 是另一個 Worker，不需要刪除。

## 手動更新上線網站

在本專案資料夾執行：

```bash
npx wrangler whoami
npm run check
npm test
npm run deploy:check
npm run deploy
```

`whoami` 確認帳戶，`deploy:check` 只驗證打包，`deploy` 才真正上線。未登入時使用 `npx wrangler login`，完成瀏覽器授權。登入後先再次確認帳戶，不要把程式部署到別人的帳戶。

部署成功時終端機會顯示網址與版本 ID。打開網址，試一次推薦，確認頁面與功能真的正常。此版不使用 AI；D1 保存每次推薦過程，Static Assets 保存網站檔案。資料表已完成初始化；新部署環境需先執行 `npm run db:remote` 並用 `npx wrangler secret put REVIEW_KEY` 設定團隊密碼。

團隊可以打開 [線上推薦過程檢查](https://drinks-mk2.rtx941031.workers.dev/internal)，使用負責人提供的 ID 與密碼，查看榜單與下載每次推薦 JSON。負責人本機的 `.review-access.txt` 保存密碼，不提交 GitHub。

## 如果你希望推送 GitHub 後自動部署

本專案尚未啟用自動部署。之後可以在 Cloudflare Worker 的 Builds／Build settings 連接 `AIbot1031/drinks_mk2`，讓 Cloudflare 取得這個私人倉庫的權限，選擇 `main` 分支、專案根目錄，並設定：

- Build command：`npm run build`
- Deploy command：`npx wrangler deploy`

先確認帳戶、Worker 名稱、分支與權限，再啟用。啟用後，推送 `main` 就可能改動上線網站，因此要先看測試是否通過。[Workers Builds 官方文件](https://developers.cloudflare.com/workers/ci-cd/builds/)說明 Git 連接與建置配置。

## 更新飲料 Excel

1. 保留原檔備份，更新 `data/飲料推薦系統_整理版.xlsx`。
2. 保留「綜合飲料特徵」工作表與既有欄位名稱。
3. 在有 `openpyxl` 的 Python 環境執行匯入腳本。若使用原先的路徑 A 虛擬環境：

```bash
source .venv/bin/activate
python scripts/import_data.py
```

4. 同時提交 Excel 和新生成的 `data/catalog.json`，再測試、部署。

網站讀取 `catalog.json`，只修改 Excel 而沒有重新匯入與部署，網站不會自動更新。修改資料後，測試中的原始筆數檢查也要依新資料更新。

## 收藏怎麼保留

這一版收藏保存在使用的瀏覽器，不是雲端帳號。可以在「我的收藏」按「匯出我的偏好」，保存 JSON；換電腦或瀏覽器後再「匯入偏好」。不同網址與本機預覽的收藏分開保存。匯入會合併，不覆蓋所有原本收藏。

## 發生問題時

| 現象 | 先看這裡 |
| --- | --- |
| 本機指令說找不到 npm | 確認已安裝 Node.js，重新打開終端機。 |
| 本機找不到套件 | 在專案根目錄執行 `npm ci`。 |
| 推送失敗 | 確認 GitHub 登入狀態與私人倉庫權限。 |
| 測試紅色 | 查看 Actions 或終端機的第一個錯誤，不要直接忽略後部署。 |
| Cloudflare 登入失敗 | 重新 `npx wrangler login`，再 `whoami` 確認帳戶。 |
| 網頁還是舊內容 | 確認部署是否成功、網址是否為新站，再重新整理。 |
| 沒有推薦 | 看條件是否太嚴格，或是否要求尚未核對的過敏／忌口條件。 |

Cloudflare 和 GitHub 的用量與方案限制可能更新；查看 [Cloudflare Workers 價格](https://developers.cloudflare.com/workers/platform/pricing/)及 [GitHub Actions 計費](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions)。本次沒有替你升級付費方案。
