# MacBERT 每日訓練

2026-10-23（Asia/Taipei）依使用者要求，以 MacBERT 取代每日 RoBERTa 工作。正式網站目前使用 MacBERT；本次調整訓練排程，不立即重訓或更換權重。

## 執行方式

沿用 automation `relgt`、目前聊天、ACTIVE 與每天台灣時間02:00。

```sh
.venv-training/bin/python scripts/run_daily_training.py --check
.venv-training/bin/python scripts/run_daily_training.py
```

每日編碼器實際命令：

```sh
.venv-training/bin/python scripts/train_macbert.py --model hfl/chinese-macbert-base --device mps --epochs 1 --retrieval-eval
```

RelGT 仍為10 epoch，Qwen保留原排程指定內容；這次不更動其他模型設定。本機存在的Qwen contract預設與排程legacy10步差異仍按既有處理，不藉此次編碼器調整暗改Qwen資料或步數。

## 評估、報告與發布

- 批次模型名 `MacBERT`，模型報告run ID為 `*-macbert-contrastive`，不能繼續標成RoBERTa。舊RoBERTa資料保留真實名稱與原始報告，未重命名歷史結果。
- MPS、1 epoch、固定當次官方revision的新初始化；不是從目前線上checkpoint續訓。資料仍依品名分組切分，沒有跨杯型洩漏到文字驗證。
- 訓練前後以相同24個固定人工合成查詢、同目錄與同標籤規則記Precision@10、Recall@10、NDCG@10、差值、退步題與查詢中位數／P95、索引耗時；記目錄／查詢／標籤hash與權重版本。不是人工口味滿意度、未見目錄測試，不能把對比loss當作排序改善。
- 保存權重與重載檢查、Markdown／JSON及daily.txt；失敗時記真實步數，未知後測留空。一模型失敗仍繼續其他模型，保留防重疊鎖與真實匿名事件匯出。
- 安全摘要產生器、API白名單與後台篩選支援MacBERT，舊RoBERTa保留為歷史選項。後台只收安全彙總，不上傳原始互動、cookie或權重。
- 新候選只留本機；只有與當時正式checkpoint在相同獨立驗證、無退步、重載與網站契約均通過時才可發布。原有正式MacBERT模型不因改排程而改動。

## 本次驗證範圍

入口 `--check`、MacBERT命令選擇、匯出失敗仍繼續MacBERT／Qwen、模型run ID辨識、代理評估範圍、摘要API白名單與舊RoBERTa相容性均需驗證。測試fixture不是真實訓練；這次0 optimizer步，沒有生成新模型。
