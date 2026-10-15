# RelGT 真實時間事件初次意圖訓練

使用者要求立即實際訓練；本次使用真實匿名事件，根據先前互動預測下一個收藏／不喜歡目標。不訓練價格、不創造不喜歡標籤；對照候選只作排序比較。少量單日資料可訓練，但不能證明跨日長期效果。

## 訓練前後比較

| 項目 | 訓練前 | 訓練後 | 差值（後−前） |
| --- | --- | --- | --- |
| train_sampled_ce | 2.77295 | 2.73769 | -0.0352623 |
| train_sampled_mrr | 0.12346 | 0.517202 | 0.393743 |
| train_sampled_hit_at_5 | 0.1 | 0.6 | 0.5 |

沒有可比較指標時，不推算改善幅度；未完成訓練不代表模型已更新。
對比 loss／分類 loss 不等同推薦排序品質；只有相同資料與評估方式才能比較。
發布：否；更新用戶：0；權重變更：是。

## 實際執行與更新內容

```json
{
  "run_id": "20261015T010111-relgt-long-intent",
  "started_at": "2026-10-15T01:01:11+08:00",
  "status": "trained_unvalidated_small_temporal_data",
  "task": "self-supervised next observed preference action given strictly past user events",
  "trigger": "User requested three-model training for 3.0; real interactions only",
  "upstream_commit": "19e423ca3e7cac761130aba790857f2dc3a46ef7",
  "git_commit": "c25bf2ddf7208484dd7f2bf134be4a5e00c20bf2",
  "working_tree_dirty": true,
  "script_sha256": "62c16516ffcaa5ec65686bab7b4fc488966a5d80743eedf5407d619f0be637f5",
  "optimizer_steps": 20,
  "published": false,
  "updated_users": 0,
  "changes": [
    "train temporal intent task on current real snapshot",
    "strict past-only event graph",
    "next-action sampled ranking target, no price target",
    "small real samples train without a quality gate"
  ],
  "limitations": [
    "same-day data cannot establish long-term intent quality",
    "unobserved distractors are not dislikes and may be future positives",
    "sampled metrics are not full-catalog ranking quality",
    "explicit padding tokens participate in upstream attention",
    "current catalog metadata assumed available, no historic catalog reconstruction",
    "trainer does not publish automatically or support resume; schedule managed by Codex"
  ],
  "snapshot_sha256": "6cfc7ac74508f714d7929ea9409f611b7b8f19b15638074f3099d06ae214bde3",
  "catalog_sha256": "6aa67407a66b04c496e2cfa80800a66857a74d13f842f8b8c03b04ae61205bab",
  "data_cutoff_ms": 1791997232500,
  "data": {
    "source_events": 10,
    "invalid_ids": 0,
    "duplicate_events": 0,
    "after_cutoff": 0,
    "duplicate_targets": 0,
    "users": 2,
    "like_targets": 10,
    "dislike_targets": 0,
    "valid_events": 10,
    "samples": 10,
    "with_history": 8,
    "cold_start_samples": 2,
    "multi_day_users": 0
  },
  "split_method": "small real data: train every target, no heldout quality claims",
  "split_rows": {
    "train": 10,
    "validation": 0,
    "test": 0
  },
  "environment": {
    "python": "3.12.14",
    "device": "cpu",
    "chip": "Apple M6",
    "packages": {
      "torch": "2.14.1",
      "torch-geometric": "2.8.0.post1",
      "pytorch-frame": "0.3.0"
    }
  },
  "parameters": {
    "snapshot": "internal_exports/interactions-2026-10-14T17-00-33-367Z.json",
    "epochs": 10,
    "batch_size": 8,
    "history_size": 8,
    "distractors": 15,
    "learning_rate": 0.0001,
    "seed": 42,
    "trigger": "User requested three-model training for 3.0; real interactions only",
    "loss": "sampled next observed-action cross entropy; distractors are NOT dislike labels",
    "trainable_parameters": 1197942,
    "channels": 32,
    "heads": 4,
    "centroids": 8,
    "starting_checkpoint": null,
    "initialization": "new temporal task, random official architecture weights"
  },
  "before_training": {
    "train": {
      "sampled_ce": 2.7729543924331663,
      "sampled_mrr": 0.12345959595959596,
      "sampled_hit_at_5": 0.1,
      "rows": 10
    },
    "validation": null,
    "test": null
  },
  "history": [
    {
      "epoch": 1,
      "training_ce": 2.761939764022827
    },
    {
      "epoch": 2,
      "training_ce": 2.840947985649109
    },
    {
      "epoch": 3,
      "training_ce": 2.9790215492248535
    },
    {
      "epoch": 4,
      "training_ce": 2.8622169494628906
    },
    {
      "epoch": 5,
      "training_ce": 2.63879132270813
    },
    {
      "epoch": 6,
      "training_ce": 2.606372356414795
    },
    {
      "epoch": 7,
      "training_ce": 2.463986039161682
    },
    {
      "epoch": 8,
      "training_ce": 2.4477219581604004
    },
    {
      "epoch": 9,
      "training_ce": 2.4680765867233276
    },
    {
      "epoch": 10,
      "training_ce": 2.300858736038208
    }
  ],
  "after_training": {
    "train": {
      "sampled_ce": 2.73769211769104,
      "sampled_mrr": 0.5172023809523809,
      "sampled_hit_at_5": 0.6,
      "rows": 10
    },
    "validation": null,
    "test": null
  },
  "weights_changed": true,
  "checkpoint_reload_max_error": 0.0,
  "checkpoint": "training_artifacts/20261015T010111-relgt-long-intent/model.pt",
  "checkpoint_sha256": "7d9452827b7e94ccc9a8e165c21b7db06316a372f68d2ca07255746a6c569449",
  "checkpoint_reload_verified": true,
  "ended_at": "2026-10-15T01:01:13+08:00",
  "duration_seconds": 1.866,
  "before_after_comparison": {
    "status": "trained_unvalidated_small_temporal_data",
    "published": false,
    "updated_users": 0,
    "metrics": [
      {
        "name": "train_sampled_ce",
        "before": 2.7729543924331663,
        "after": 2.73769211769104,
        "delta_after_minus_before": -0.03526227474212629,
        "better_direction": "lower",
        "reason": null
      },
      {
        "name": "train_sampled_mrr",
        "before": 0.12345959595959596,
        "after": 0.5172023809523809,
        "delta_after_minus_before": 0.3937427849927849,
        "better_direction": "higher",
        "reason": null
      },
      {
        "name": "train_sampled_hit_at_5",
        "before": 0.1,
        "after": 0.6,
        "delta_after_minus_before": 0.5,
        "better_direction": "higher",
        "reason": null
      }
    ],
    "data_snapshot_sha256": "6cfc7ac74508f714d7929ea9409f611b7b8f19b15638074f3099d06ae214bde3",
    "weights_changed": true,
    "checkpoint_after": "training_artifacts/20261015T010111-relgt-long-intent/model.pt"
  }
}
```
