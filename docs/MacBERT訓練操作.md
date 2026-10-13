# MacBERT 飲料文字微調

本次依使用者要求立即進行初次實驗，從官方 `hfl/chinese-macbert-base` 開始，解析並固定下載時的 Git revision；不是從零重做 MacBERT 官方預訓練，也不是用戶長期意圖訓練。

## 資料與目標

使用新版 5,781 筆飲料資料，按品牌／品名去除杯型與地區重複，建立品名、品牌、茶種、奶類、配料及最前 120 字風味文字。來源有奶類矛盾的版本不提供奶類特徵。不讀價格、熱量、咖啡因欄位作為目標；文字數字移除。沒有用戶個資、收藏或人工編造的查詢相關性標籤。

同一文字在開啟 dropout 的模型中通過兩次，作為正對；批次其他文字作負對，使用對稱 InfoNCE 交叉熵。attention-mask-aware mean pooling 排除 padding、CLS、SEP，之後 L2 正規化。這是無監督 SimCSE 類型實驗，沒有重現官方 MacBERT 的同義詞修正、WWM 或 SOP 預訓練流程。

固定 seed=42；品名 hash 分 90% 訓練、10% 驗證，同名跨品牌／杯型／地區不能跨切分。實際筆數由報告記錄。第一輪一個 epoch、batch 32、max length 64、AdamW lr=1e-5、weight decay=.01、temperature=.05、梯度裁剪 1.0；使用 Mac MPS。

## 操作

```sh
.venv-training/bin/python scripts/train_macbert.py --device mps
```

環境依 `training/requirements-lock.txt`。模型在忽略 Git 的 `training_artifacts/<run-id>/model/`；每次成功或失敗寫 `docs/training-runs/<run-id>.md/.json` 和 `daily.txt`。報告包含來源 revision、資料 hash、環境、實際步數、loss、耗時、權重校驗、載入一致性、是否發布與限制。

驗證使用固定 seed 的獨立品名文本對比 loss；不等同 Recall@K／NDCG@K。驗證文字不參與 optimizer 更新。權重變更與保存後重新載入向量一致性會實測。沒有人工查詢評估，因此訓練完成狀態明示 `trained_unvalidated_for_retrieval`，不自動上線。相近飲料可能是假負例，品名／風味文字可能含來源錯誤，不能保證推薦品質提高。

後續需要人工標註查詢—飲料相關性，對照 TF-IDF 和原始 MacBERT、生成目錄向量、實作 Mac 服務及 Worker adapter。網站目前仍維持原先推薦；沒有開啟每日排程。

來源：[官方模型](https://huggingface.co/hfl/chinese-macbert-base)、[官方 MacBERT](https://github.com/ymcui/MacBERT)、[SimCSE 論文](https://aclanthology.org/2021.emnlp-main.552/)。

## 2026-10-13T23:14:11+08:00 每日訓練排程擴充

Codex automation `relgt` 已更新為「飲料網站 RelGT／MacBERT／Qwen 每日訓練」，狀態 ACTIVE。讀取現有設定發現時間已變成每日 Asia/Taipei 02:00，這次保留現有時段；前段 04:00 為建立時的歷史設定。下一預定執行為 2026-10-14 02:00。

三個模型依序處理：RelGT 使用真實匿名事件及現有 10 epoch 入口；MacBERT 使用現有目錄文字 MPS 對比微調入口、1 epoch；Qwen 第一次排程須先建立審核過的 intent 資料、MLX LoRA／QLoRA 入口及獨立驗證，再實際訓練。Qwen 入口目前尚未實作，加入排程指令不等於已完成訓練程式或已訓練。完全無有效資料或執行失敗須留下真實報告。每個模型都需前後比較；發布需相同驗證集的線上舊版／候選新版比較及重載、網站契約測試，未完成則沿用目前模型。

本次只更新與核對排程，0 optimizer 步、無新權重或部署；沒有提交／推送 Git。需要 Mac 開機與 Codex App 持續運作。

## 2026-10-13T23:26:28+08:00 三模型排程立即實測

已依使用者要求實際執行三模型訓練，Qwen 新增 MLX QLoRA 入口並完成一次修正重試；權重未發布。安全總報告與各次真實前後比較見 [首次手動排程報告](training-runs/20261013T231513-manual-schedule-trial.md)。排程已改呼叫 `scripts/run_daily_training.py`，保留每日 02:00，新增防重疊與分模型失敗處理。Qwen 資料、方法與限制見 [Qwen訓練操作](Qwen訓練操作.md)。
