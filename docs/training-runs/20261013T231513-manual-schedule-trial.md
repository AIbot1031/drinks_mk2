# 三模型排程首次手動執行

這次依使用者要求立即執行相同排程工作，不是凌晨計時器自行觸發。RelGT、MacBERT、Qwen 依序實際訓練；Qwen 首次重載驗證失敗後修正並重試，保留失敗報告。

| 模型 | 實際更新步數 | 相同資料／方法的前後結果 | 發布 |
| --- | ---: | --- | --- |
| RelGT | 20 | 訓練集 sampled MRR 0.12346→0.51720；Hit@5 0.10→0.60。10 個真實目標、2 位用戶，無獨立時間驗證 | 否 |
| MacBERT | 75 | 214 筆固定品名留出文字之 dropout 對比 loss 2.35724→0.01092；不等同查詢排序改善 | 否 |
| Qwen 首次 | 10 | 合成驗證完整意圖 60%→20%；訓練完成但 bfloat16 轉換導致重載驗證失敗 | 否 |
| Qwen 重試 | 10 | 相同 10 筆合成驗證完整意圖 60%→80%；JSON/schema 皆 100%，保存重載 logits 誤差 0，基礎權重未變 | 否 |

合計真正執行 115 次 optimizer 更新，包含失敗候選的 10 步。Qwen 的品牌解除及澄清仍失敗，合成驗證也不能代表真實使用效果。前兩次 NumPy 批次排列未固定，不能把重試的指標差異歸因於 dtype 修正；之後已補 seed，不另訓第三次。

網站仍使用原有三個模型且 ready=true；未替換權重、未重建線上索引、未部署網站或推送 Git。每模型詳細版本、資料 hash、前後差值與 checkpoint 見以下報告。

- [20261013T231534-relgt-long-intent](20261013T231534-relgt-long-intent.md)
- [20261013T231557-macbert-contrastive](20261013T231557-macbert-contrastive.md)
- [20261013T231856-qwen-intent-qlora](20261013T231856-qwen-intent-qlora.md)
- [20261013T232109-qwen-intent-qlora](20261013T232109-qwen-intent-qlora.md)

後續每日 02:00（Asia/Taipei）由 Codex 回到本聊天呼叫 `scripts/run_daily_training.py`，使用實作好的三模型串行入口、鎖、防重疊與批次報告。Qwen 已有真實訓練入口，不再只是一條待實作指示。發布仍需線上舊新版本比較与獨立驗證；條件不足保留原版。Mac 和 Codex App 需持續運作。
