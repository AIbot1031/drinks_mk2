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
