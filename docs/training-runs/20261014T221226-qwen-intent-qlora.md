# Qwen 微調啟動失敗報告

- Run ID：20261014T221226-qwen-intent-qlora
- 狀態：啟動失敗，尚未載入模型。
- 模型：qwen3.5-9b-4bit-8b2b98c00a6b-intent-v7
- 資料：73 筆人工合成訓練、59 筆固定驗證（含 29 筆既有回歸案例）。
- 原因：相對路徑在 relative_to(ROOT) 檢查被拒絕；已改為先解析絕對路徑。
- 步數：0；權重變更：否；checkpoint：無；線上版本、提示、服務與用戶行為：未變。

## 前後比較

| 項目 | 訓練前 | 訓練後 | 差值 |
| --- | --- | --- | --- |
| 同份驗證集意圖指標 | 尚未評估 | 尚未評估 | 不計算 |

開始時間取自輸出目錄建立時間，結束時間取自診斷日誌 mtime，為近似來源；未取得精確執行耗時，不補造數值。獨立重試使用另一 run ID。

```json
{
  "run_id": "20261014T221226-qwen-intent-qlora",
  "started_at": "2026-10-14T22:12:26.267+08:00",
  "start_time_source": "output directory creation timestamp; failed before protected training block",
  "ended_at": "2026-10-14T22:12:26.277+08:00",
  "status": "failed_before_model_load",
  "trigger": "human-authorized synthetic robustness fine-tuning",
  "stage": "report initialization / relative model path",
  "optimizer_steps": 0,
  "weights_changed": false,
  "published": false,
  "updated_users": 0,
  "base_model_version": "qwen3.5-9b-4bit-8b2b98c00a6b-intent-v7",
  "candidate_model_version": null,
  "data": {
    "source": "human-authored synthetic scenarios; no consumer records",
    "version": "intent-robust-v2-worker-contract",
    "train": 73,
    "validation": 59,
    "snapshot_file_sha256": "ac0ab7c75285216992b9919a5a0ccccaea8ebcb18ad854df3bbd838628478468",
    "cutoff": "not applicable: authored synthetic scenarios"
  },
  "parameters": {
    "model": "training_artifacts/qwen3.5-9b-4bit",
    "iters": 146,
    "num_layers": 4,
    "rank": 8,
    "learning_rate": 5e-05,
    "max_seq_length": 3072,
    "seed": 42
  },
  "error_type": "ValueError",
  "reason": "Relative model path was rejected by relative_to(ROOT) before model load; resolved model paths before retry",
  "checkpoint": null,
  "before_after_comparison": {
    "model_before": "qwen3.5-9b-4bit-8b2b98c00a6b-intent-v7",
    "model_after": "qwen3.5-9b-4bit-8b2b98c00a6b-intent-v7",
    "weights_changed": false,
    "published": false,
    "updated_users": 0,
    "metrics": [],
    "reason": "No evaluation or optimizer step started; no metrics estimated"
  },
  "limitations": [
    "Only a failed launch; no fine-tuning completed",
    "Separate retry is tracked under a different run ID",
    "Online prompt, model weights and service unchanged"
  ],
  "ended_at_source": "protected diagnostic log mtime; approximate process completion, exact runtime duration not captured",
  "duration_seconds": null,
  "git_commit": "20e9a5486557647e2b75f5882fd3462c47154079",
  "working_tree_dirty": true,
  "script_sha256": null,
  "script_hash_reason": "Launch failed before script hash could be persisted; not reconstructed retrospectively",
  "environment": {
    "python": "3.12.14",
    "device": "mlx-metal",
    "packages": {
      "mlx": "0.32.3",
      "mlx-lm": "0.32.0",
      "transformers": "5.19.0"
    },
    "hardware": {
      "device_name": "Apple M6",
      "max_recommended_working_set_size": 26800603136,
      "memory_size": 34359738368,
      "architecture": "applegpu_g18g",
      "max_buffer_length": 20100448256,
      "resource_limit": 499000
    }
  },
  "environment_source": "same unchanged executable/environment verified by adjacent retry, not captured inside failed launch",
  "changes": [
    "build robust synthetic Worker-preprocessed data and protected manual training entry",
    "resolve relative model path before separate retry"
  ],
  "online_model_changed": false,
  "online_prompt_changed": false,
  "weights_file_changed": false
}
```
