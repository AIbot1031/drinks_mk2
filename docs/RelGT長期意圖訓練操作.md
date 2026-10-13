# RelGT 長期意圖訓練入口

已完成時間事件匯出、past-only 圖適配、官方 RelGT local/global 模型訓練、保存／重新載入、前後比較與工作日誌。收到使用者「訓練」指示時執行一次；少量資料可以訓練，不因沒有跨日驗證而略過首次實驗。

## 執行方式

```sh
node scripts/export_interactions.mjs
.venv-training/bin/python scripts/train_long_intent.py --snapshot internal_exports/上一步輸出的檔名.json
```

預設 10 epoch、batch 8、最近 8 個歷史事件、15 個候選對照、AdamW lr=0.0001、seed=42、CPU。`--epochs` 可明確指定輪數；「訓一次」指一次執行，不等於只跑一個 epoch。

雲端匯出使用受服務金鑰保護的 `/api/training/events`，不依賴先前失效的 Wrangler D1 雲端查詢授權。金鑰只在本機 `.semantic-key` 與 Worker secret；輸出將登入 ID 用本機 HMAC 轉成穩定代碼，快照保存為 600 權限，目錄忽略 Git。只匯出事件，不讀密碼、session、查詢文字或聯絡資訊。測試帳號排除。一次最多 200,000 事件，超過需要分頁實作，不能靜默截斷。

## 真正學習的目標

每一個真實 like／dislike 作下一個已觀察操作的排序目標，輸入包含候選飲料、用戶、此前的時間事件。取消操作只進入歷史，不直接標成不喜歡。對照候選是 sampled ranking 的其他選擇，不是用戶真的不喜歡，未操作資料不能當成明確負向偏好。

同時間事件都讀取該時間之前的歷史；不按 UUID／來源列假造先後順序，不將當次目標或未來事件放入輸入。相同品牌／品名的杯型聚成同一品項，並排除同時間已知正向品項及先前同方向活躍偏好作對照。價格、熱量、咖啡因沒有進入訓練特徵或目標。

節點有 candidate、user、history、padding 四種。候選與歷史節點含品名／品牌／茶／奶／配料／濃郁度／無奶特徵，用戶含匿名代碼、待預測操作類型、歷史事件數與跨度，時間編碼使用距目標的秒數。使用原樣固定來源官方 RelGT，32 channels、4 heads、8 global centroids。這是本專案的下一操作預訓練任務適配，不是官方論文現成飲料推薦 checkpoint。

至少 30 目標、3 個不同時間且各切分非空時，採全域時間群 80/10/10；同時間不能跨切分。否則真實目標全部訓練，明確標為 `trained_unvalidated_small_temporal_data`，不捏造驗證樣本。

## 每次報告與權重

每次成功、失敗、沒有有效目標都保存 Markdown／JSON 及 daily.txt。指標包含相同候選與相同評估 seed 的 sampled CE、MRR、Hit@5 前／後／差值。小樣本只報訓練集指標，沒有驗證集就寫未取得，不能把這些數值當成長期或全目錄品質證明。

checkpoint 位於 `training_artifacts/<run-id>/model.pt`，包含權重、optimizer、圖特徵與匿名事件；權限 600，絕不提交 Git。只信任自己生成的本機 checkpoint，不能載入不明 `.pt`。報告只有彙總，沒有逐人代碼或事件。重新載入會比較原始分數並保存 checksum。

本次實測見 [20261013T155618](training-runs/20261013T155618-relgt-long-intent.md)：1 位用戶、7 事件／目標、6 個有歷史樣本、1 個冷啟動樣本；10 次 optimizer 更新完成。只有單日資料，沒有長期驗證。

仍待完成：checkpoint 續訓 CLI、全目錄排序評估、雲端 B 榜單發布與自動 04:00 排程。目前每次入口從新的時間任務權重初始化；不偷偷接續不相容的舊價格模型。網站 B 仍是收藏特徵圖，圖形顯示按讚也不表示 B 已換成訓練模型。

來源：[官方 RelGT](https://github.com/snap-stanford/relgt)、[論文](https://arxiv.org/abs/2505.10960)。
