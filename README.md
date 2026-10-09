# 飲料智慧推薦系統

以提供的 Excel 飲料資料庫建立可操作的第一版網站：中文需求輸入、品牌與預算篩選、熱量／咖啡因限制、推薦換批、收藏、飲料圖鑑與特徵關係圖。部署使用 Cloudflare Workers + Static Assets。

- [線上飲料推薦](https://drinks-mk2.rtx941031.workers.dev/)
- [團隊推薦過程檢查](https://drinks-mk2.rtx941031.workers.dev/internal)：登入後看 A/B 榜單、權重計算與結果，並下載每筆 JSON。

## 開發範圍

- Agent A：先做中文規則解析，外部大模型供應商之後再決定。
- 路徑 A：網站使用 TF-IDF 文字向量與餘弦相似度基線；保留使用者提供的 Chroma Python 原型，尚未接入神經 embedding。
- 路徑 B：以飲料特徵圖與本機收藏做個人化隨機遊走，尚未接入正式 RelGT／LightGCN／Two-Tower 偏好模型；RelGT 目錄價格回歸已完成本機驗證。
- 融合：共同硬篩選、加權 RRF 排序與品牌多樣性，尚未訓練 Learning-to-Rank。
- 路徑 C（SASRec／BST 序列推薦）：目前不實作。
- Agent C（RAG／LLM 推薦解釋）：目前不實作。介面只顯示來源資料與固定規則依據。
- Cloudflare Workers AI：不使用。

詳細差異與進度見[系統架構與目前進度](docs/系統架構與目前進度.md)。

## 網站本機預覽

需要 Node.js 22 或更新的 LTS。

```bash
npm ci
npm run db:local
npm run dev
```

打開終端機顯示的本機網址（預設 `http://localhost:8787`）。訪客收藏儲存在瀏覽器 localStorage；登入後偏好保存到自己的 D1 帳號，可在「我的收藏」匯出／匯入 JSON。

團隊登入 ID 為 `team001`（wrangler.jsonc 的 REVIEW_ID），ID 至少 3 個英文字母或數字；密碼至少 6 位，只接受英文大小寫或數字。前後端皆驗證。團隊檢查密碼在本機 `.dev.vars`（不提交）及 Cloudflare secret `REVIEW_KEY`；團隊頁需先登入。每次有效推薦的過程存入 D1。線上部署前，新環境須執行 `npm run db:remote` 並設定 secret。

```bash
npm run check
npm test
npm run deploy:check
npm run deploy
```

前三個指令檢查程式；最後一個指令發布到 Cloudflare 的獨立 `drinks-mk2` Worker。部署前使用 `npx wrangler whoami` 確認帳戶。GitHub Actions 只做檢查，尚未啟用 Git 推送自動部署。

本機 Worker 開著時，使用 `TEST_BASE_URL=http://localhost:8787 npm test`，會額外跑 API 整合測試。

## 路徑 A 原型執行方式

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python src/route_a.py
```

建議使用 Python 3.11 或 3.12。Python 依賴尚未鎖定版本；此原型尚未完成實際向量建置與查詢驗證。首次執行可能需要網路下載 Chroma 預設 embedding 模型。此程式與網站版分開運作，不是網站部署入口。

程式會讀取 `data/飲料推薦系統_整理版.xlsx` 的「綜合飲料特徵」工作表，在本機 `chroma_db/` 建立向量資料，並執行程式內預設的查詢範例。每次執行會刪除並重建 `drink_menu_basic` 集合，請勿與正式資料共用。

更新 Excel 後，在有 `openpyxl` 的 Python 環境執行 `python scripts/import_data.py`，產生網站使用的 `data/catalog.json`。重新測試並部署後，網站才會取得新資料。

## 資料概況

目前主表有 1,178 筆具品項名稱的飲料，18 個品牌標籤。咖啡因欄位有 367 筆空白，另有 19 筆僅提供下界，合計 386 筆無法確認上界。熱量欄位有 239 筆空白。未知值不當成零，設定營養上限時會排除無法驗證的資料。

I 至 O 欄的七個過敏原表頭都叫 `allergen_egg`，需核對原始來源才可辨識各欄。「無」依資料說明僅代表文字未命中，不能據此保證不含過敏原。網站遇到過敏／忌口需求會停止推薦並提示；無奶篩選只驗證原表標記。原始 Python 原型的過敏範例仍只有語意查詢，未修成正式安全篩選。

價格中的「起」表示起價；熱量和咖啡因需要依容量、冷熱與甜度確認適用條件。參考程式以 200 kcal 和 100 mg 作為範例篩選門檻，尚非正式推薦規則。

## 文件

- [RelGT 本機訓練驗證操作](docs/RelGT本機訓練驗證操作.md)：官方模型的飲料價格回歸驗證入口，與正式推薦訓練分開。

- [每日工作紀錄](daily.txt)：依日期時間記錄工作、驗證、部署與待辦，已回補前期紀錄。
- [RelGT 訓練設計與更新報告](docs/RelGT訓練設計與更新報告.md)：已確認的夜間時段、預定流程與每次訓練報告格式；已完成目錄訓練驗證，正式用戶偏好模型尚未訓練。

- [檔案用途說明書](docs/檔案用途說明書.md)：逐一介紹所有納入版本控制的檔案。
- [GitHub 與 Cloudflare 新手操作](docs/GitHub與Cloudflare新手操作.md)：從看檔案、本機預覽到保存修改與部署。
- [系統架構與目前進度](docs/系統架構與目前進度.md)：已完成的第一版與尚待訓練的模型。
- [推薦過程與團隊檢查](docs/推薦過程與團隊檢查.md)：紀錄格式、融合計算、權重、線上檢查及 JSON 匯出。
- [RelGT 本機訓練規劃](docs/RelGT本機訓練規劃.md)：官方程式與論文參考、硬體需求及尚待定義的訓練任務。
- [原始架構圖](references/architecture.png)：作為整體架構參考，路徑 C 暫不實作。

後續新增或修改檔案時，同步更新用途說明書。

用戶可在消費者網站自行註冊與登入，ID 至少 3 個英文字母或數字，密碼至少 6 位英文大小寫或數字。登入後偏好保存到帳號；操作及限制見[用戶登入與收藏](docs/用戶登入與收藏.md)。
