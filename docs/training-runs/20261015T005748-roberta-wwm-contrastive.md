# RoBERTa-WWM 飲料語意微調報告

本次學習飲料文字的向量表示，不訓練價格或用戶長期意圖。驗證 loss 只衡量對比任務，不代表消費者推薦品質改善；未更新網站模型。

## 訓練前後比較

| 項目 | 訓練前 | 訓練後 | 差值（後−前） |
| --- | --- | --- | --- |
| heldout_dropout_contrastive_loss | 2.05994 | 0.00696056 | -2.05298 |

沒有可比較指標時，不推算改善幅度；未完成訓練不代表模型已更新。
對比 loss／分類 loss 不等同推薦排序品質；只有相同資料與評估方式才能比較。
發布：否；更新用戶：0；權重變更：是。

實際開始／結束、資料、參數、更新步數、驗證、權重與限制如下：

```json
{
  "run_id": "20261015T005748-roberta-wwm-contrastive",
  "started_at": "2026-10-15T00:57:48+08:00",
  "status": "trained_unvalidated_for_retrieval",
  "trigger": "user requested trained RoBERTa comparison for offline v3 candidate",
  "parameters": {
    "model": "hfl/chinese-roberta-wwm-ext",
    "revision": "5c58d0b8ec1d9014354d691c538661bf00bfdb44",
    "epochs": 1,
    "batch_size": 32,
    "max_length": 64,
    "learning_rate": 1e-05,
    "temperature": 0.05,
    "seed": 42,
    "device": "mps",
    "trigger": "user requested trained RoBERTa comparison for offline v3 candidate"
  },
  "git_commit": "c25bf2ddf7208484dd7f2bf134be4a5e00c20bf2",
  "working_tree_dirty": true,
  "script_sha256": "050ce80e869f6c3faa2a2d84c0a20d6eab62280f92d268346caec4294b0224b7",
  "task": "unsupervised dropout-view contrastive fine-tuning on drink text",
  "published": false,
  "updated_users": 0,
  "changes": [
    "RoBERTa-WWM domain contrastive fine-tuning on current catalog",
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
    "model": "hfl/chinese-roberta-wwm-ext",
    "revision": "5c58d0b8ec1d9014354d691c538661bf00bfdb44",
    "license": "Apache-2.0"
  },
  "attention_implementation": "eager (MPS SDPA does not support dropout)",
  "validation_before": 2.0599367651983957,
  "optimizer_steps": 75,
  "epochs": [
    {
      "epoch": 1,
      "train_loss": 0.10919559788175562,
      "validation_loss": 0.0069605636205872365
    }
  ],
  "weights_changed": true,
  "checkpoint_reload_max_error": 0.0,
  "checkpoint": "training_artifacts/20261015T005748-roberta-wwm-contrastive/model/model.safetensors",
  "checkpoint_sha256": "2d7aecfdae2f33744782b0a2d7cbeb868368d883391f877d97ebfa3d22200169",
  "ended_at": "2026-10-15T00:58:52+08:00",
  "duration_seconds": 64.29,
  "before_after_comparison": {
    "status": "trained_unvalidated_for_retrieval",
    "published": false,
    "updated_users": 0,
    "metrics": [
      {
        "name": "heldout_dropout_contrastive_loss",
        "before": 2.0599367651983957,
        "after": 0.0069605636205872365,
        "delta_after_minus_before": -2.0529762015778084,
        "better_direction": "lower",
        "reason": null
      }
    ],
    "data_snapshot_sha256": "6aa67407a66b04c496e2cfa80800a66857a74d13f842f8b8c03b04ae61205bab",
    "weights_changed": true,
    "checkpoint_after": "training_artifacts/20261015T005748-roberta-wwm-contrastive/model/model.safetensors"
  }
}
```

## 後續相同查詢排序評估（2026-10-15T01:01:03+08:00）

訓練後追加實測；原訓練時間與狀態保留。查詢與目錄欄位代理評估不等同人工推薦滿意度。

| 指標 | 訓練前 | 訓練後 | 後−前 |
| --- | ---: | ---: | ---: |
| catalog_proxy_precision_at_10 | 0.587500 | 0.695833 | +0.108333 |
| catalog_proxy_recall_at_10 | 0.090896 | 0.121539 | +0.030643 |
| catalog_proxy_ndcg_at_10 | 0.590461 | 0.722125 | +0.131664 |

與現有服務權重的完整比较：docs/model-validation/20261015T005914-v3.1-encoders/report.md。未部署／更新用戶，線上模型維持原樣。最新結構化資料見同名 JSON 的 retrieval_evaluation。

## 後續正式發布（2026-10-15T11:02:10+08:00）

本訓練權重已於3.1.0正式啟用，模型版本roberta-wwm-2d7aecfdae2f3374；本輪沒有追加optimizer步數。先前「未發布」為訓練當時狀態，最新結果見同名JSON的subsequent_release及docs/3.1更新說明.md，原權重checksum與訓練數值不變。
