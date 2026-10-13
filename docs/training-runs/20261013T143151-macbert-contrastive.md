# MacBERT 飲料語意微調報告

本次學習飲料文字的向量表示，不訓練價格或用戶長期意圖。驗證 loss 只衡量對比任務，不代表消費者推薦品質改善；未更新網站模型。

實際開始／結束、資料、參數、更新步數、驗證、權重與限制如下：

```json
{
  "run_id": "20261013T143151-macbert-contrastive",
  "started_at": "2026-10-13T14:31:51+08:00",
  "status": "failed",
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
  "script_sha256": "dc8ebd206e6ac8346ad86d462144b3eb8578fda6d2c47189c26edc64e562d3bb",
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
  "error": "NotImplementedError",
  "ended_at": "2026-10-13T14:32:03+08:00",
  "duration_seconds": 11.357
}
```

## 故障核對與修正

MPS 的 SDPA attention 不支援訓練所需 dropout；前置驗證失敗，沒有訓練更新。下一次改 eager attention。

<!-- before-after-comparison-added:2026-10-13 -->

本段於 2026-10-13 依既有實測補充，沒有重新訓練或新增估計指標。

## 訓練前後比較

| 項目 | 訓練前 | 訓練後 | 差值（後−前） |
| --- | --- | --- | --- |
| 評估指標 | 未取得 | 未取得 | 不計算 |

沒有可比較指標時，不推算改善幅度；未完成訓練不代表模型已更新。
對比 loss／分類 loss 不等同推薦排序品質；只有相同資料與評估方式才能比較。
發布：否；更新用戶：0；權重變更：否。
