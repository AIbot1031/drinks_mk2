# MacBERT 飲料語意微調報告

本次學習飲料文字的向量表示，不訓練價格或用戶長期意圖。驗證 loss 只衡量對比任務，不代表消費者推薦品質改善；未更新網站模型。

## 訓練前後比較

| 項目 | 訓練前 | 訓練後 | 差值（後−前） |
| --- | --- | --- | --- |
| heldout_dropout_contrastive_loss | 2.35724 | 0.0109154 | -2.34632 |

沒有可比較指標時，不推算改善幅度；未完成訓練不代表模型已更新。
對比 loss／分類 loss 不等同推薦排序品質；只有相同資料與評估方式才能比較。
發布：否；更新用戶：0；權重變更：是。

實際開始／結束、資料、參數、更新步數、驗證、權重與限制如下：

```json
{
  "run_id": "20261014T015956-macbert-contrastive",
  "started_at": "2026-10-14T01:59:56+08:00",
  "status": "trained_unvalidated_for_retrieval",
  "trigger": "Codex daily scheduled training",
  "parameters": {
    "epochs": 1,
    "batch_size": 32,
    "max_length": 64,
    "learning_rate": 1e-05,
    "temperature": 0.05,
    "seed": 42,
    "device": "mps",
    "trigger": "Codex daily scheduled training"
  },
  "git_commit": "c81ff313cd93814449115006bf462e933d63794b",
  "working_tree_dirty": true,
  "script_sha256": "f12edd26c6fa7a68811f52c1e1f9eba76b399fdf00a845df2b77bfcfd36dd58b",
  "task": "unsupervised dropout-view contrastive fine-tuning on drink text",
  "published": false,
  "updated_users": 0,
  "changes": [
    "MacBERT domain contrastive fine-tuning on current catalog",
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
    "trainer does not replace current Worker inference weights automatically",
    "schedule managed by Codex; this task is not RelGT long-term intent training"
  ],
  "data": {
    "catalog_sha256": "6aa67407a66b04c496e2cfa80800a66857a74d13f842f8b8c03b04ae61205bab",
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
      "train_loss": 0.1325538016900743,
      "validation_loss": 0.010915351225929248
    }
  ],
  "weights_changed": true,
  "checkpoint_reload_max_error": 0.0,
  "checkpoint": "training_artifacts/20261014T015956-macbert-contrastive/model/model.safetensors",
  "checkpoint_sha256": "75cab44b3d18c849825808e6b536d553cdf0b9b239fa7cbeaae34b3291a0c12b",
  "ended_at": "2026-10-14T02:00:59+08:00",
  "duration_seconds": 62.285,
  "before_after_comparison": {
    "status": "trained_unvalidated_for_retrieval",
    "published": false,
    "updated_users": 0,
    "metrics": [
      {
        "name": "heldout_dropout_contrastive_loss",
        "before": 2.3572388452904245,
        "after": 0.010915351225929248,
        "delta_after_minus_before": -2.346323494064495,
        "better_direction": "lower",
        "reason": null
      }
    ],
    "data_snapshot_sha256": "6aa67407a66b04c496e2cfa80800a66857a74d13f842f8b8c03b04ae61205bab",
    "weights_changed": true,
    "checkpoint_after": "training_artifacts/20261014T015956-macbert-contrastive/model/model.safetensors"
  }
}
```
