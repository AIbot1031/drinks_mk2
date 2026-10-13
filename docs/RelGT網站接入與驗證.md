# RelGT 接入網站與驗證報告

核對時間：2026-10-13T20:19:37+08:00（Asia/Taipei）。此輪為接入推論，沒有執行訓練，optimizer 更新步數為 0。

## 更新前後

| 項目 | 接入前 | 接入後 |
| --- | --- | --- |
| 模型權重 | 20261013T155618-relgt-long-intent/model.pt | 相同 checkpoint，未改動 |
| 權重 SHA256 | 05757994850db8f691bccc134834b5fd1fdd898c1ef3be1090667257646dd241 | 相同 |
| 線上 B 路徑 | 收藏特徵圖 | 既有訓練帳號＋有效歷史使用 RelGT，其餘使用特徵圖 |
| 模型執行位置 | 本機離線訓練產物 | Mac CPU 常駐推論，經 WSS 提供給網站 |
| 雲端模型權重 | 無 | 無；權重仍在 Mac |
| A／B 融合 | A 0.65、B 0.35、RRF 常數 60 | 相同固定權重 |
| 品質指標 | 無獨立驗證集 | 未新增品質評估，不能宣稱改善 |
| 訓練步數／排程 | 本輪不適用 | 本輪 0 步，未啟用訓練排程 |

## 實作

- Mac RelGT 服務載入可信本機 manifest 指定的 checksum，沿用 checkpoint 的特徵統計、編碼順序、飲料索引與完整官方模型。以 like 作為下一次收藏意圖，不把預測分數當校準機率。
- Worker 使用與訓練匯出相同的 HMAC key 將登入 ID 轉為匿名代碼。只送該使用者最近 8 筆、嚴格早於請求時間的有效互動，沒有送密碼、cookie 或原始帳號 ID。
- 目前 checkpoint 僅包含 1 個已訓練匿名帳號。訪客、未知帳號、無歷史、版本不符、逾時或模型離線均退回特徵圖。
- 雲端先依硬條件、個人不喜歡與換批限制生成候選，再請 RelGT 排序；回覆再次檢查目錄版本、候選 ID、重複 ID、有限分數及歷史筆數。B 榜單以名次參與 RRF，不直接相加 logits。
- 官方模型 GNN 位置編碼在 eval 時仍取樣噪聲，因此推論使用固定 seed 並恢復 RNG；小批次大小 64，單候選補一份計算避免 upstream squeeze 移除 batch 維度，僅回傳一筆，沒有創造訓練資料。
- 舊事件 catalog_version=2.1.0 與目前目錄哈希均接受；舊事件飲料 ID 必須能對應目前目錄。新事件改保存目錄 SHA256，沒有回填或改寫雲端歷史。
- 新增獨立 RELGT_KEY，僅用於 relgt 角色；Qwen／MacBERT 金鑰不能替代 RelGT。匿名 HMAC key 為 Worker secret。前端顯示實際 B 模式，團隊 trace 顯示模型／歷史筆數／備援原因，不含匿名代碼或原始歷史內容。
- Mac LaunchAgent local.drinks-mk2.relgt 與監控已安裝；只負責推論，Mac 睡眠／關機時回到備援。

## 驗證與發布

- TypeScript 型別檢查通過；在真實本機 Worker runtime 執行 34 項 TypeScript 測試，全部通過、0 略過。
- 本機 Python 測試 10 項通過；時間資料處理測試另 5 項通過。
- 現有權重對 5,781 杯型紀錄（2,603 品牌／品名群組）推論回傳 100 筆，同一請求結果一致，state_dict 未改變；一次全目錄推論實測約 330 ms，不代表長期延遲保證。
- 獨立本機 D1 複製既有訓練帳號的 7 筆歷史，不建立雲端假用戶／假互動。完整登入推薦與換批均 B=relgt，品牌排除／100 元上限符合，換批重疊 0。匿名代碼不出現在 API 回應。
- 新用戶有收藏仍 B=feature-graph、原因 new_user；無歷史原因 no_history；訪客原因 guest；停止本機測試模型後仍有 6 筆結果，B=feature-graph，離線備援通過。
- Qwen 與 RelGT 角色金鑰不能呼叫其他角色或訓練匯出，合法角色無 WebSocket upgrade 回傳 426。
- npm run deploy:check 成功；npm run deploy 成功，Worker 版本 cfdeb8b6-a6e3-4f8f-9987-80cbe1439cc9。
- 線上 semantic/status 顯示 Qwen、MacBERT、RelGT 均 connected=true／ready=true；RelGT 版本 relgt-temporal-05757994850db8f6、device=cpu。
- 線上訪客推薦 HTTP 200、A=macbert、B=feature-graph、原因 guest，品牌排除符合。已訓練帳號登入後的完整 B 使用於獨立本機 runtime 驗證，未使用真實帳號密碼或接管線上登入工作階段。
- 區網監控 API 顯示 5 個程序，包括 RelGT 執行中與 connected 安全動作。

## 限制與操作

這是 7 筆單日事件訓練的初次模型，沒有獨立驗證集，不能宣稱比特徵圖更好。尚未訓練的使用者仍使用特徵圖；沒有新增用戶即時訓練、每日訓練、續訓或品質門檻。

歷史輸入最多 8 筆，與訓練 history_size 相同；目前以請求時間計算事件年齡，超出訓練單日分布時的效果未驗證。舊事件使用目前目錄特徵，未重建歷史目錄。padding 仍依官方 checkpoint 參與注意力。全目錄未見品項可使用既有未知類別編碼，品質未量測。

啟用檢查：[模型狀態](https://drinks-mk2.rtx941031.workers.dev/api/semantic/status)。已訓練帳號且有歷史的推薦回應 mode.routeB=relgt，頁面顯示個人化排序：RelGT。重新安裝為 `python3 scripts/install_relgt_service.py`；停止服務可用 `launchctl bootout gui/$(id -u)/local.drinks-mk2.relgt`，網站下一次請求自動走特徵圖。

原訓練報告的 published=false 描述訓練當時，保留不覆寫；本報告記錄後續接入結果。沒有提交或推送 Git。
