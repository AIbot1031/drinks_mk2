# MacBERT 上線與 TF-IDF 備援

路徑 A 優先呼叫 Mac 的已微調 MacBERT，B 仍為特徵圖。Worker 先做品牌／奶類／營養／預算／換批硬篩選，把候選 ID 與需求文字經私有 Durable Object 橋接送給 Mac；不送帳號密碼或 session。

## 目前啟用模型

- 起始模型：官方 hfl/chinese-macbert-base。
- 本機微調：20261013T143230，模型 SHA256 前綴 5754da458c249ff9。
- 線上顯示版本：`macbert-5754da458c249ff9`。
- 5,781 個版本向量，每個 768 維，attention-mask-aware mean pooling，排除 padding／CLS／SEP，L2 正規化，最多 64 token；品名／品牌／茶奶配料／風味文字，不平均杯型數值。
- 查詢與向量 cosine 排序，最多回傳 100 個候選；空文字是中性 0 分，收藏 B 仍可主導。
- 目錄 SHA256 驗證不一致時不混用。Worker 重新核對候選 ID、有限分數、重複 ID、分數範圍與版本，Mac 不能放寬硬篩選。

這次依使用者指示直接切換 A，沒有人工查詢相關性基準，因此不宣稱優於 TF-IDF。過敏与數值安全仍依既有硬篩選，模型不推測實際配方。

## 連線與常駐服務

Mac 主動建立 `wss://drinks-mk2.rtx941031.workers.dev/api/semantic/connect`；Cloudflare SQLite Durable Object 以單一 Mac agent 為協調單位。服務金鑰保存在 Worker secret／本機忽略檔，瀏覽器不拿到金鑰。無需新增網域或開啟家用路由器入站埠。這取代之前規劃的 Tunnel／固定 hostname。

Durable Object WebSocket 使用休眠 API，連線 metadata 由 attachment 恢復；正在等待的請求只有暫時記憶體狀態，若重啟或連線丟失，回到備援，不把未完成結果當成成功。最多 8 個等待請求，5 秒逾時。Mac 斷線會自動以 1–30 秒退避重連。

Mac 服務已安裝為登入使用者的 LaunchAgent：`local.drinks-mk2.macbert`。程式／Python／模型／向量／私有金鑰的獨立執行環境位於 `~/Library/Application Support/DrinksMk2`，避免直接依賴 Documents 裡的開發程序。重新開機後需登入該 macOS 使用者，才會啟動；Mac 睡眠、斷網或尚未登入時可用備援。

安裝或更新部署副本：

```sh
.venv-training/bin/python scripts/install_macbert_service.py
```

來源模型與向量仍保留在專案 `training_artifacts/`，不要提交大型權重／金鑰。模型或目錄變更時需重建一致索引並重新安裝服務。此 LaunchAgent 只有推論，不是凌晨 04:00 訓練排程。

## 備援與可檢查結果

Mac 失聯、未準備好、超時、索引版本不符或結果不合法時，當次改用 TF-IDF。下一次正常連線便使用 MacBERT。手動與對話畫面標示 MacBERT／備援；trace 保存實際方法、模型版本、推論耗時與備援原因，不能把備援顯示成 BERT。

`GET /api/semantic/status` 只顯示模型準備狀態／版本／裝置，不顯示帳號或金鑰。`/api/semantic/connect` 與只供訓練匯出的 `/api/training/events` 需要服務 Bearer key；一般瀏覽器不能讀出互動資料。

已實測：線上 A=macbert、6 張符合無奶的推薦卡、trace 保存；停止臨時 Mac 程式後 A=tf-idf；安裝常駐服務後 A 恢復 macbert。最終檢查與部署版本見 daily.txt。

來源：[Cloudflare WebSocket 休眠 API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)。
