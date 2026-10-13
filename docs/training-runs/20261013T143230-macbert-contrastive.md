# MacBERT 飲料語意微調報告

本次學習飲料文字的向量表示，不訓練價格或用戶長期意圖。驗證 loss 只衡量對比任務，不代表消費者推薦品質改善；未更新網站模型。

## 這次更新內容

- 官方 MacBERT 在 Apple M6、32 GB 的 MPS 上完成 1 輪、75 次權重更新，實際執行 64.758 秒（不包含先前套件安裝與失敗重試）。
- 5,781 筆杯型／地區資料整理成 2,603 個品項文字；2,389 訓練、214 獨立品名驗證，沒有用戶資料、價格或營養預測目標。
- 更新的是品名、茶種、奶類、配料和風味的文字編碼權重；同文字兩次 dropout 作正對，批次其他飲料作負對。
- 驗證對比 loss 從 2.35724 到 0.01087；這只是對比目標，不是推薦命中率，不宣称優於 TF-IDF。訓練 loss 0.13255。
- 權重已變化，保存後重新載入向量最大差為 0.0；模型位于 training_artifacts/20261013T143230-macbert-contrastive/model/，權重 SHA256 见 JSON。
- 沒有更新雲端模型或任何用戶推薦，也沒有開啟定時訓練。後續需查詢相關性人工評估與服務接入。

實際開始／结束、資料、參數、更新步數、驗證、權重與限制如下：

```json
{
  "run_id": "20261013T143230-macbert-contrastive",
  "started_at": "2026-10-13T14:32:30+08:00",
  "status": "trained_unvalidated_for_retrieval",
  "trigger": "user requested immediate MacBERT training",
  "parameters": {
    "epochs": 1,
    "batch_size": 32,
    "max_length": 64,
    "learning_rate": 1e-05,
    "temperature": 0.05,
    "seed": 42,
    "device": "mps"
  },
  "git_commit": "9b5c924b939290773a0ee1b87a119b18141a5d4f",
  "working_tree_dirty": true,
  "script_sha256": "ac0126e3812fc9b0b691481c7a6140189196c926f81fff590278f578a781ab56",
  "task": "unsupervised dropout-view contrastive fine-tuning on drink text",
  "published": false,
  "updated_users": 0,
  "changes": [
    "first MacBERT domain contrastive fine-tuning",
    "product/name grouped holdout",
    "no price or nutrition targets",
    "no user information"
  ],
  "limitations": [
    "not official MacBERT correction/WWM/SOP pretraining reproduction",
    "no manually labelled query relevance evaluation",
    "similar drinks may be false in-batch negatives",
    "contrastive validation loss does not prove ranking improvements",
    "source taste/milk metadata may contain errors",
    "no Worker inference service or automatic publishing",
    "no nightly schedule; no RelGT long-term intent training"
  ],
  "data": {
    "catalog_sha256": "ef2503d4ae5fe0324cd9d8e988719ca62800e5a24084971b8a0c2d00609ad97a",
    "catalog_variants": 5781,
    "products": 2603,
    "train_texts": 2389,
    "validation_texts": 214,
    "split": "deterministic name-group holdout; no cup/region/name crossover",
    "user_events": 0,
    "new_user_events": 0,
    "cutoff": "catalog snapshot only",
    "removed_duplicate_texts": 0
  },
  "environment": {
    "device": "mps",
    "packages": {
      "torch": "2.14.1",
      "transformers": "4.57.6",
      "safetensors": "0.7.0"
    }
  },
  "source": {
    "model": "hfl/chinese-macbert-base",
    "revision": "a986e004d2a7f2a1c2f5a3edef4e20604a974ed1",
    "license": "Apache-2.0"
  },
  "attention_implementation": "eager (MPS SDPA does not support dropout)",
  "validation_before": 2.3572388452904245,
  "optimizer_steps": 75,
  "epochs": [
    {
      "epoch": 1,
      "train_loss": 0.132552673311762,
      "validation_loss": 0.01086785584779578
    }
  ],
  "weights_changed": true,
  "checkpoint_reload_max_error": 0.0,
  "checkpoint": "training_artifacts/20261013T143230-macbert-contrastive/model/model.safetensors",
  "checkpoint_sha256": "5754da458c249ff9d48d2a7f06423243f394ae066b3ef1e6e9163be13469a5f6",
  "ended_at": "2026-10-13T14:33:35+08:00",
  "duration_seconds": 64.758
}
```

<!-- before-after-comparison-added:2026-10-13 -->

本段於 2026-10-13 依既有實測補充，沒有重新訓練或新增估計指標。

## 訓練前後比較

| 項目 | 訓練前 | 訓練後 | 差值（後−前） |
| --- | --- | --- | --- |
| heldout_dropout_contrastive_loss | 2.35724 | 0.0108679 | -2.34637 |

沒有可比較指標時，不推算改善幅度；未完成訓練不代表模型已更新。
對比 loss／分類 loss 不等同推薦排序品質；只有相同資料與評估方式才能比較。
發布：否；更新用戶：0；權重變更：是。
