# RoBERTa 每日自動訓練

2026-10-15（Asia/Taipei），依使用者要求取代每日 MacBERT 工作；網站仍為3.1.0，不因本機訓練流程調整重新發布。

## 排程及入口

沿用 Codex heartbeat `relgt`，名稱改為「飲料網站 RelGT／RoBERTa／Qwen 每日訓練」，維持 ACTIVE、原聊天及每日台灣時間02:00。此次更新排程不代表今天02:00已執行新流程，也不補造過去的訓練紀錄。Mac與Codex須可執行排程。

```sh
.venv-training/bin/python scripts/run_daily_training.py --check
.venv-training/bin/python scripts/run_daily_training.py
```

順序仍為 RelGT、中文語意編碼器、Qwen；語意編碼器命令現在是：

```sh
.venv-training/bin/python scripts/train_macbert.py --model hfl/chinese-roberta-wwm-ext --device mps --epochs 1 --retrieval-eval
```

`train_macbert.py` 是為相容歷史而保留的共用程式名稱；上述參數實際下載並訓練官方 RoBERTa-WWM，報告使用 `roberta-wwm-contrastive` run ID，批次欄位名為 RoBERTa。保留手動 MacBERT 支援，日常命令已不再選它。

## 每次訓練與比較

使用當天目錄快照，按既有品名分組切成訓練／驗證文字。每輪從當次固定官方 revision 開始，記錄來源、套件、目錄hash、程式與Git版本、參數及步數，不是從線上checkpoint續訓。預設1 epoch、batch32、64 tokens、learning rate1e-5、temperature0.05、seed42、MPS；無價格或用戶資料目標。

`--retrieval-eval` 讓訓練入口自動在更新前、保存並重載候選後各跑一次 `benchmark_encoders.py --worker`：

- 同一套24個固定合成查詢、相同目錄欄位標籤與K=10，整個目錄按品牌／品名合併杯型。記錄目錄、查詢、標籤規則hash，若期間目錄改變或查詢不完整則失敗，不混用兩套測試。
- Precision@10、Recall@10、NDCG@10的前／後／差值，逐查詢排名與退步清單；保留查詢中位數、P95、索引耗時與記憶體等原始評估資料。兩次都在新子程序測量，下載不列入推論計時。
- 固定驗證文字的 dropout 對比loss仍保留，與排序代理指標分開呈現，不用loss宣稱推薦改善。
- 這是目錄欄位代理評估，曾見過目錄文字，並非未見目錄測試或人工口味／身心效果評分；小樣本改寫彼此相關，個別指標可能退步，報告如實保留。

每次Markdown／JSON報告與批次摘要寫入 `docs/training-runs/`，安全摘要追加 `daily.txt`。權重、前後評估中間檔僅存本機忽略的 `training_artifacts/`。訓練失敗仍寫真實optimizer步數與已完成測量；缺少後測時，後測與差值留空並說明原因，不以0或loss替代。前測就失敗時不能宣稱已更新權重。

## 發布及其他模型

批次程式只產生本機候選，未新增自動發布功能。排程保留原本的發布門檻：須再把當時正式checkpoint與候選用相同方法比較，核對重載、網站硬篩選／契約及回復設定；未完成或未通過則沿用線上模型。訓練前後的官方base對候選比較，不能冒充正式舊版對候選比較。

RelGT／Qwen訓練方式不改，各自原有前後比較報告仍保留。訓練／匯出失敗、需使用者處理或成功啟用新模型才通知；一般完成且無發布保持安靜。沒有改動3.1正式網站、推論服務、Qwen或RelGT權重，也沒有改動等待3.0的已停止追蹤。
