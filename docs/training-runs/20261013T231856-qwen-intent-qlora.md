# Qwen 飲料意圖 QLoRA 訓練報告

資料是本次人工編寫的合成任務例句，沒有冒充真實用戶對話。固定獨立組合情境作前後比較；小样本不足證明線上改善，本次未發布。

## 訓練前後比較

| 項目 | 訓練前 | 訓練後 | 差值（後−前） |
| --- | --- | --- | --- |
| json_valid_rate | 1 | 1 | 0 |
| schema_valid_rate | 1 | 1 | 0 |
| brand_exclusion_intent_exact_rate | 1 | 1 | 0 |
| brand_release_intent_exact_rate | 0 | 0 | 0 |
| topping_exclusion_intent_exact_rate | 1 | 1 | 0 |
| topping_release_intent_exact_rate | 0 | 0 | 0 |
| numeric_intent_exact_rate | 1 | 0 | -1 |
| cross_turn_intent_exact_rate | 0.666667 | 0 | -0.666667 |
| clarify_intent_exact_rate | 0 | 0 | 0 |
| all_intent_exact_rate | 0.6 | 0.2 | -0.4 |

沒有可比較指標時，不推算改善幅度；未完成訓練不代表模型已更新。
對比 loss／分類 loss 不等同推薦排序品質；只有相同資料與評估方式才能比較。
發布：否；更新用戶：0；權重變更：是。

```json
{
  "run_id": "20261013T231856-qwen-intent-qlora",
  "started_at": "2026-10-13T23:18:56+08:00",
  "status": "failed",
  "trigger": "manual schedule trial / authorized recurring training",
  "git_commit": "7a63a3a2777a0b64dd903735f1234c5d46efc097",
  "working_tree_dirty": true,
  "script_sha256": "a0a0d76ca119a615ddce0750e11ea9bade389e464b60ea834f604a61590687ca",
  "parameters": {
    "model": "training_artifacts/qwen3-8b-4bit",
    "iters": 10,
    "num_layers": 4,
    "learning_rate": 0.0001,
    "max_seq_length": 2048,
    "seed": 42
  },
  "optimizer_steps": 10,
  "weights_changed": true,
  "published": false,
  "updated_users": 0,
  "changes": [
    "new actual MLX QLoRA trainer",
    "manually authored synthetic intent dataset",
    "fixed heldout semantic before/after evaluation"
  ],
  "limitations": [
    "small synthetic holdout is not proof of real-user quality",
    "no resume or automatic publication",
    "online model remains unchanged; no adapter installed"
  ],
  "data": {
    "source": "manually authored synthetic intent scenarios; no consumer data",
    "version": "intent-cases-v1",
    "train": 24,
    "validation": 10,
    "split": "fixed simple single-edit training; separate composed heldout scenarios",
    "limitations": "small authored holdout, shared task vocabulary; not real-user distribution or external benchmark",
    "sha256": "56b6477ce116a4d779a4a04b44419dc4177d93b2fe9a402f4be10f2788879726"
  },
  "snapshot_sha256": "56b6477ce116a4d779a4a04b44419dc4177d93b2fe9a402f4be10f2788879726",
  "catalog_sha256": "6aa67407a66b04c496e2cfa80800a66857a74d13f842f8b8c03b04ae61205bab",
  "source": {
    "model": "mlx-community/Qwen3-8B-4bit",
    "revision": "545dc4251c05440727734bcd94334791f6ab0192",
    "base": "Qwen/Qwen3-8B",
    "quantization": "4bit"
  },
  "system_sha256": "335d93ebb62983f10946ef31eabfd3fdeb0a97b0d7e301e7309087ea8abf313f",
  "environment": {
    "python": "3.12.14",
    "device": "mlx-metal",
    "packages": {
      "mlx": "0.32.3",
      "mlx-lm": "0.32.0",
      "transformers": "5.19.0"
    }
  },
  "base_weight_sha256": {
    "model.safetensors": "f2d29621aab300336ad645567ff38c42aac755513006ef4e8a579cf7ef5256d8"
  },
  "intent_before": {
    "json_valid_rate": 1.0,
    "schema_valid_rate": 1.0,
    "brand_exclusion_intent_exact_rate": 1.0,
    "brand_release_intent_exact_rate": 0.0,
    "topping_exclusion_intent_exact_rate": 1.0,
    "topping_release_intent_exact_rate": 0.0,
    "numeric_intent_exact_rate": 1.0,
    "cross_turn_intent_exact_rate": 0.6666666666666666,
    "clarify_intent_exact_rate": 0.0,
    "all_intent_exact_rate": 0.6
  },
  "trainable_parameters": 1212416,
  "validation_loss_history": [
    {
      "iteration": 0,
      "val_loss": 1.3817194700241089,
      "val_time": 9.938305208008387
    },
    {
      "iteration": 9,
      "val_loss": 0.07472501695156097,
      "val_time": 9.246401249998598
    }
  ],
  "history": [
    {
      "iteration": 1,
      "train_loss": 1.623335361480713,
      "learning_rate": 9.999999747378752e-05,
      "iterations_per_second": 0.21120966241936798,
      "tokens_per_second": 9.926854133710295,
      "trained_tokens": 47,
      "peak_memory": 5.62234916
    },
    {
      "iteration": 2,
      "train_loss": 1.5580766201019287,
      "learning_rate": 9.999999747378752e-05,
      "iterations_per_second": 0.6150386638948745,
      "tokens_per_second": 28.9068172030591,
      "trained_tokens": 94,
      "peak_memory": 5.930891744
    },
    {
      "iteration": 3,
      "train_loss": 1.0067294836044312,
      "learning_rate": 9.999999747378752e-05,
      "iterations_per_second": 0.6594903855437442,
      "tokens_per_second": 30.336557735012228,
      "trained_tokens": 140,
      "peak_memory": 5.930891744
    },
    {
      "iteration": 4,
      "train_loss": 0.30738550424575806,
      "learning_rate": 9.999999747378752e-05,
      "iterations_per_second": 0.6576446588028017,
      "tokens_per_second": 30.251654304928877,
      "trained_tokens": 186,
      "peak_memory": 5.930891744
    },
    {
      "iteration": 5,
      "train_loss": 0.8682575821876526,
      "learning_rate": 9.999999747378752e-05,
      "iterations_per_second": 0.6480640246963192,
      "tokens_per_second": 23.33030488906749,
      "trained_tokens": 222,
      "peak_memory": 5.930891744
    },
    {
      "iteration": 6,
      "train_loss": 1.153180480003357,
      "learning_rate": 9.999999747378752e-05,
      "iterations_per_second": 0.6230799402197155,
      "tokens_per_second": 18.06931826637175,
      "trained_tokens": 251,
      "peak_memory": 5.930891744
    },
    {
      "iteration": 7,
      "train_loss": 0.25819242000579834,
      "learning_rate": 9.999999747378752e-05,
      "iterations_per_second": 0.6665067605843544,
      "tokens_per_second": 27.993283944542885,
      "trained_tokens": 293,
      "peak_memory": 5.930891744
    },
    {
      "iteration": 8,
      "train_loss": 0.11424212157726288,
      "learning_rate": 9.999999747378752e-05,
      "iterations_per_second": 0.6466579559624698,
      "tokens_per_second": 27.806292106386202,
      "trained_tokens": 336,
      "peak_memory": 5.930893582
    },
    {
      "iteration": 9,
      "train_loss": 0.15866605937480927,
      "learning_rate": 9.999999747378752e-05,
      "iterations_per_second": 0.6564464695220809,
      "tokens_per_second": 22.97562643327283,
      "trained_tokens": 371,
      "peak_memory": 5.930893582
    },
    {
      "iteration": 10,
      "train_loss": 0.10622699558734894,
      "learning_rate": 9.999999747378752e-05,
      "iterations_per_second": 0.6600568211351894,
      "tokens_per_second": 23.762045560866817,
      "trained_tokens": 407,
      "peak_memory": 5.930893582
    }
  ],
  "intent_after": {
    "json_valid_rate": 1.0,
    "schema_valid_rate": 1.0,
    "brand_exclusion_intent_exact_rate": 1.0,
    "brand_release_intent_exact_rate": 0.0,
    "topping_exclusion_intent_exact_rate": 1.0,
    "topping_release_intent_exact_rate": 0.0,
    "numeric_intent_exact_rate": 0.0,
    "cross_turn_intent_exact_rate": 0.0,
    "clarify_intent_exact_rate": 0.0,
    "all_intent_exact_rate": 0.2
  },
  "error_type": "ValueError",
  "reason": "Local QLoRA/evaluation/checkpoint pipeline failed; see protected local execution diagnostics",
  "ended_at": "2026-10-13T23:20:33+08:00",
  "duration_seconds": 96.839,
  "before_after_comparison": {
    "status": "failed",
    "published": false,
    "updated_users": 0,
    "weights_changed": true,
    "checkpoint_after": null,
    "data_snapshot_sha256": "56b6477ce116a4d779a4a04b44419dc4177d93b2fe9a402f4be10f2788879726",
    "metrics": [
      {
        "name": "json_valid_rate",
        "before": 1.0,
        "after": 1.0,
        "delta_after_minus_before": 0.0,
        "better_direction": "higher"
      },
      {
        "name": "schema_valid_rate",
        "before": 1.0,
        "after": 1.0,
        "delta_after_minus_before": 0.0,
        "better_direction": "higher"
      },
      {
        "name": "brand_exclusion_intent_exact_rate",
        "before": 1.0,
        "after": 1.0,
        "delta_after_minus_before": 0.0,
        "better_direction": "higher"
      },
      {
        "name": "brand_release_intent_exact_rate",
        "before": 0.0,
        "after": 0.0,
        "delta_after_minus_before": 0.0,
        "better_direction": "higher"
      },
      {
        "name": "topping_exclusion_intent_exact_rate",
        "before": 1.0,
        "after": 1.0,
        "delta_after_minus_before": 0.0,
        "better_direction": "higher"
      },
      {
        "name": "topping_release_intent_exact_rate",
        "before": 0.0,
        "after": 0.0,
        "delta_after_minus_before": 0.0,
        "better_direction": "higher"
      },
      {
        "name": "numeric_intent_exact_rate",
        "before": 1.0,
        "after": 0.0,
        "delta_after_minus_before": -1.0,
        "better_direction": "higher"
      },
      {
        "name": "cross_turn_intent_exact_rate",
        "before": 0.6666666666666666,
        "after": 0.0,
        "delta_after_minus_before": -0.6666666666666666,
        "better_direction": "higher"
      },
      {
        "name": "clarify_intent_exact_rate",
        "before": 0.0,
        "after": 0.0,
        "delta_after_minus_before": 0.0,
        "better_direction": "higher"
      },
      {
        "name": "all_intent_exact_rate",
        "before": 0.6,
        "after": 0.2,
        "delta_after_minus_before": -0.39999999999999997,
        "better_direction": "higher"
      }
    ]
  }
}
```
