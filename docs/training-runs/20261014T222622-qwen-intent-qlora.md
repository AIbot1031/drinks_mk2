# Qwen3.5-9B 奇怪輸入微調完整報告

已實際完成 146 個 optimizer steps，更新最後 1 個完整注意力區塊的 rank 8 QLoRA adapter，638,976 個可訓練參數。73 筆助理人工合成訓練情境、59 筆固定驗證（30 新情境＋29 既有回歸），沒有使用顧客個資或原始互動。adapter 保存／重載 logits 最大誤差 0.0，基礎權重檔案未變，峰值 MLX 配置記憶體 6,478.2 MiB。

**候選不發布：完整意圖 36/59 → 22/59，action＋filters 47/59 → 31/59。服務解析後 48/59 → 32/59，17 個案例退步。線上仍為原 Qwen3.5-9B intent-v7，沒有載入本次 adapter。**

| 同一份固定驗證 | 微調前 | 微調後 | 差值 |
| --- | --- | --- | --- |
| JSON 可解析 | 59/59 | 59/59 | 0 |
| 原始 schema 合法 | 52/59 | 58/59 | +6 |
| 完整意圖（含 query） | 36/59 | 22/59 | −14 |
| 原始 action＋filters | 47/59 | 31/59 | −16 |
| query 合格 | 40/59 | 43/59 | +3 |
| 服務解析後 action＋filters | 48/59 | 32/59 | −16 |

## 更新內容與判斷

這次新增錯字／注音／中英混寫、否定與解除、數值單位／無效範圍、心情雜訊、指令混淆、含糊離題、過敏或醫療保證、跨輪改口情境。前後都使用正式 SYSTEM／guard 附加提示、相同 59 個 payload、greedy temperature 0、max tokens 320。原模型基準重用先前失敗執行中、任何完成 optimizer 更新之前產生的 59 份生成；模型檔案 hash、提示 hash、生成設定、全部案例逐一一致。微調後全部重新生成，沒有重播舊答案冒充新推論。

原始 JSON 的格式有改善，但觀察到原有預算、品牌排除、多個配料排除與奶茶否定被省略。例：validation-080 留下仙草排除卻漏掉預算與春水堂排除；regression-milk-no 把 milkTea:false 省略；regression-brand-more 漏掉先前排除的春水堂。推測訓練集多為單一需求、複合狀態保留例句較少，可能促成只輸出當輪文字的行為；本次沒有實驗證明單一因果，也沒有修改驗證題目或線上規則掩蓋退步。

本機 Worker 合併探測 50/59 → 51/59，無合併退步；其中 11 題正式 Worker 會略過 Qwen，真正模型路由的探測為 41/48 → 42/48。這只是同份生成重播 codec／guard／合併程式，沒有重播完整 HTTP、eligibility 或推薦排序，不能把 +1 宣稱成推薦或顧客滿意度改善。既有防護保住部分條件，也不代表可接受模型本身的退步。

## 記憶體失敗與修正

首次相對模型路徑在報告初始化失敗（0 步）；修正 resolve 後，以最後 4 層 rank 8 訓練在第一步反向 graph 遇 Metal OOM（0 個完成更新），兩次完整報告均保留。最後改為完整注意力末層，凍結 DeltaNet 區塊採推論 kernel，僅在最後 512 個位置建立詞彙 logits；所有 prompt 與回答仍完整保留。對真實第一筆驗證前向，原 masked CE 與新 completion loss 誤差 0.0、皆計 62 個回答 token；每筆回答加 padding 經檢查皆在視窗內。每 25 步與最後保存 adapter。

訓練期間 token loss 抽 8 個 validation batch，前後抽樣可能不同，只用來診斷，不作改善比較。上表與下列百分比均採相同全部 59 題。訓練 loss 降低並沒有帶來整體意圖改善。

## 部署、Git 與後續

本次沒有部署 Worker、載入候選、替換基礎檔案、更動提示、其他模型或每日排程； updated_users=0。現有每日入口預設仍為 legacy 資料，此次以 robust／completion-loss 的明確參數手動執行，沒有暗改排程。

下一次若重做，應增加獨立的多限制狀態保留情境，確認解除只影響指定欄位，並用尚未檢視的新情境作最終評估；可降低更新強度或比較較早 checkpoint，但本次未再做第二次成功訓練或挑選較早權重冒充改善。保留本次 adapter 與所有真實失敗／退步結果。

設計與資料來源見 [Qwen奇怪輸入微調設計](../Qwen奇怪輸入微調設計.md)；本機合併安全結果見同 run ID 的 -worker-merge.json。基礎模型、資料／程式 hash、參數、時間、環境、步數、指標差值、權重位置及全部限制如下。

## 訓練前後比較

| 項目 | 訓練前 | 訓練後 | 差值（後−前） |
| --- | --- | --- | --- |
| json_rate | 1 | 1 | 0 |
| schema_rate | 0.881356 | 0.983051 | 0.101695 |
| intent_rate | 0.610169 | 0.372881 | -0.237288 |
| action_filters_rate | 0.79661 | 0.525424 | -0.271186 |
| query_rate | 0.677966 | 0.728814 | 0.0508475 |
| ambiguous_numeric_intent_rate | 0.333333 | 0.666667 | 0.333333 |
| cross_turn_intent_rate | 0.5 | 0.75 | 0.25 |
| injection_intent_rate | 0 | 0 | 0 |
| messy_text_intent_rate | 0.666667 | 0.666667 | 0 |
| mood_noise_intent_rate | 0.333333 | 0.333333 | 0 |
| negation_intent_rate | 0.666667 | 0.333333 | -0.333333 |
| no_intent_intent_rate | 1 | 1 | 0 |
| numeric_intent_rate | 0.75 | 0.25 | -0.5 |
| regression_intent_rate | 0.655172 | 0.310345 | -0.344828 |
| release_intent_rate | 0.666667 | 0 | -0.666667 |
| safety_intent_rate | 1 | 0.5 | -0.5 |

沒有可比較指標時，不推算改善幅度；未完成訓練不代表模型已更新。
對比 loss／分類 loss 不等同推薦排序品質；只有相同資料與評估方式才能比較。
發布：否；更新用戶：0；權重變更：是。

```json
{
  "run_id": "20261014T222622-qwen-intent-qlora",
  "started_at": "2026-10-14T22:26:22+08:00",
  "status": "trained_synthetic_intent_not_published",
  "trigger": "human-authorized robustness fine-tuning; memory-safe retry",
  "git_commit": "20e9a5486557647e2b75f5882fd3462c47154079",
  "working_tree_dirty": true,
  "script_sha256": "6eae23e3c124670abf76f5b6acccee5a59d3ecd06521a208742fe31953be751a",
  "parameters": {
    "model": "training_artifacts/qwen3.5-9b-4bit",
    "iters": 146,
    "num_layers": 1,
    "learning_rate": 5e-05,
    "max_seq_length": 3072,
    "seed": 42,
    "rank": 8,
    "dataset": "robust",
    "max_tokens": 320,
    "trigger": "human-authorized robustness fine-tuning; memory-safe retry",
    "baseline_results": "training_artifacts/20261014T221255-qwen-intent-qlora/before-evaluation.json",
    "completion_loss": true,
    "val_batches": 8
  },
  "optimizer_steps": 146,
  "weights_changed": true,
  "published": false,
  "updated_users": 0,
  "changes": [
    "human-authored robust scenarios when selected; legacy data preserved",
    "Worker-preprocessed inputs for robust dataset",
    "same frozen heldout before/after evaluation",
    "prompt masking; frozen quantized base; train adapter only",
    "memory-safe final attention block only; full conditioning and exact completion CE with bounded vocabulary logits",
    "rank 8 adapter trained for 146 actual optimizer steps; no live installation",
    "rejected adapter for inherited-constraint omissions and 17 parser regressions; all outcomes retained"
  ],
  "limitations": [
    "small synthetic holdout is not proof of real-user quality",
    "no resume or automatic publication",
    "online model remains unchanged; no adapter installed",
    "fixed small synthetic validation, not real-user distribution; no independent annotator agreement",
    "query scoring is strict apart from explicit aliases and punctuation normalization",
    "observed inherited filter omissions; sparse multi-constraint contexts may contribute, causal explanation not proven",
    "token loss used 8 sampled validation batches; not necessarily the same subset, not treated as before/after quality improvement",
    "11 cases bypass Qwen in actual Worker routing; the merge probe is hypothetical for those cases",
    "all 59 post-training generations are fresh; baseline 59 generations verified against identical data/prompt/settings/base hashes before reuse"
  ],
  "data": {
    "source": "manually authored synthetic intent scenarios; no consumer data",
    "version": "intent-robust-v2-worker-contract",
    "train": 73,
    "validation": 59,
    "split": "fixed train vs separately authored heldout compositions; existing 29 website cases are evaluation only",
    "limitations": "small authored holdout, shared task vocabulary; not real-user distribution or external benchmark",
    "sha256": "79a5cb29116541eb5568c36a533a63f2062f62092c561a160e3f25c5de0cee14",
    "group_counts": {
      "train": {
        "ambiguous_numeric": 6,
        "cross_turn": 7,
        "injection": 5,
        "messy_text": 15,
        "mood_noise": 6,
        "negation": 6,
        "no_intent": 7,
        "numeric": 9,
        "release": 8,
        "safety": 4
      },
      "validation": {
        "ambiguous_numeric": 3,
        "cross_turn": 4,
        "injection": 3,
        "messy_text": 3,
        "mood_noise": 3,
        "negation": 3,
        "no_intent": 2,
        "numeric": 4,
        "regression": 29,
        "release": 3,
        "safety": 2
      }
    },
    "limitations_detail": [
      "Finite examples; not a real-user distribution",
      "Human labels are authored by the coding assistant, not independently annotated",
      "Quoted text, sarcasm and numeric ambiguity may remain unresolved",
      "Some novel aliases cannot pass unchanged Worker merge rules even if the model learns them"
    ]
  },
  "snapshot_sha256": "79a5cb29116541eb5568c36a533a63f2062f62092c561a160e3f25c5de0cee14",
  "catalog_sha256": "6aa67407a66b04c496e2cfa80800a66857a74d13f842f8b8c03b04ae61205bab",
  "source": {
    "model": "mlx-community/Qwen3.5-9B-4bit",
    "revision": "8b2b98c00a6b4d291155e4890773ca8f769aee53",
    "base": "Qwen/Qwen3.5-9B",
    "quantization": "4bit",
    "version_prefix": "qwen3.5-9b-4bit",
    "weight_sha256": {
      "model-00001-of-00002.safetensors": "a68b87558c6ef43f74c2bd63ce7e9092ceddc3101f3def0030774bae5f42aadd",
      "model-00002-of-00002.safetensors": "b0a770bf8469c7f3f18756a0e0283f1c1174344a83e059a4e483f6af4907352d",
      "tokenizer.json": "87a7830d63fcf43bf241c3c5242e96e62dd3fdc29224ca26fed8ea333db72de4"
    }
  },
  "base_model_version": "qwen3.5-9b-4bit-8b2b98c00a6b-intent-v7",
  "system_sha256": "702273a64cbd1ca6b1f81e7d871885365c5733a3b7773a40a969ff3c6380c79b",
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
  "base_weight_sha256": {
    "model-00001-of-00002.safetensors": "a68b87558c6ef43f74c2bd63ce7e9092ceddc3101f3def0030774bae5f42aadd",
    "model-00002-of-00002.safetensors": "b0a770bf8469c7f3f18756a0e0283f1c1174344a83e059a4e483f6af4907352d"
  },
  "baseline_reused_from": "training_artifacts/20261014T221255-qwen-intent-qlora/before-evaluation.json",
  "intent_before": {
    "json_rate": 1.0,
    "schema_rate": 0.8813559322033898,
    "intent_rate": 0.6101694915254238,
    "action_filters_rate": 0.7966101694915254,
    "query_rate": 0.6779661016949152,
    "ambiguous_numeric_intent_rate": 0.3333333333333333,
    "cross_turn_intent_rate": 0.5,
    "injection_intent_rate": 0.0,
    "messy_text_intent_rate": 0.6666666666666666,
    "mood_noise_intent_rate": 0.3333333333333333,
    "negation_intent_rate": 0.6666666666666666,
    "no_intent_intent_rate": 1.0,
    "numeric_intent_rate": 0.75,
    "regression_intent_rate": 0.6551724137931034,
    "release_intent_rate": 0.6666666666666666,
    "safety_intent_rate": 1.0
  },
  "tokenization": {
    "max_train_tokens": 2168,
    "max_validation_tokens": 2190,
    "prompt_loss_masked": true,
    "truncated_rows": 0
  },
  "trainable_parameters": 638976,
  "loss_equivalence": {
    "absolute_error": 0.0,
    "masked_tokens": 62,
    "reference_tokens": 62,
    "window": 512,
    "full_context_preserved": true,
    "frozen_deltanet_uses_inference_kernel": true
  },
  "validation_loss_history": [
    {
      "iteration": 0,
      "val_loss": 1.3645060062408447,
      "val_time": 15.658482625003671
    },
    {
      "iteration": 145,
      "val_loss": 0.2021932601928711,
      "val_time": 16.93157254200196
    }
  ],
  "history": [
    {
      "iteration": 1,
      "train_loss": 2.061131238937378,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.41027839696646595,
      "tokens_per_second": 13.12890870292691,
      "trained_tokens": 32,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 2,
      "train_loss": 1.6904531717300415,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.43059199677287296,
      "tokens_per_second": 17.654271867687793,
      "trained_tokens": 73,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 3,
      "train_loss": 1.765630841255188,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4292041214338542,
      "tokens_per_second": 18.45577722165573,
      "trained_tokens": 116,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 4,
      "train_loss": 1.432154893875122,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.3823706483087077,
      "tokens_per_second": 12.235860745878647,
      "trained_tokens": 148,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 5,
      "train_loss": 1.1775106191635132,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.43007883960521825,
      "tokens_per_second": 18.493390103024385,
      "trained_tokens": 191,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 6,
      "train_loss": 0.5887028574943542,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4093869843244343,
      "tokens_per_second": 20.87873620054615,
      "trained_tokens": 242,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 7,
      "train_loss": 0.4951038956642151,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4313162946028888,
      "tokens_per_second": 13.802121427292441,
      "trained_tokens": 274,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 8,
      "train_loss": 0.623155951499939,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4330158021828557,
      "tokens_per_second": 22.516821713508495,
      "trained_tokens": 326,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 9,
      "train_loss": 0.9110670685768127,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.435454131027426,
      "tokens_per_second": 16.982711110069612,
      "trained_tokens": 365,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 10,
      "train_loss": 0.30840399861335754,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4308380135667634,
      "tokens_per_second": 17.6643585562373,
      "trained_tokens": 406,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 11,
      "train_loss": 0.45759448409080505,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4298288160793848,
      "tokens_per_second": 24.50024251652493,
      "trained_tokens": 463,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 12,
      "train_loss": 0.15334035456180573,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.42866837651978584,
      "tokens_per_second": 20.147413696429936,
      "trained_tokens": 510,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 13,
      "train_loss": 0.08103824406862259,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.42959519996185147,
      "tokens_per_second": 13.747046398779247,
      "trained_tokens": 542,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 14,
      "train_loss": 0.32371604442596436,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.42905317861258196,
      "tokens_per_second": 21.4526589306291,
      "trained_tokens": 592,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 15,
      "train_loss": 0.06580376625061035,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.42667391070372973,
      "tokens_per_second": 13.653565142519351,
      "trained_tokens": 624,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 16,
      "train_loss": 0.24977116286754608,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4256000409609715,
      "tokens_per_second": 18.726401802282744,
      "trained_tokens": 668,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 17,
      "train_loss": 0.10460516810417175,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.419578519740157,
      "tokens_per_second": 22.23766154622832,
      "trained_tokens": 721,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 18,
      "train_loss": 0.10047110915184021,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4192710092483285,
      "tokens_per_second": 22.64063449940974,
      "trained_tokens": 775,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 19,
      "train_loss": 0.2186492532491684,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4255720197134527,
      "tokens_per_second": 22.555317044812995,
      "trained_tokens": 828,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 20,
      "train_loss": 0.0354088731110096,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.41717793421492577,
      "tokens_per_second": 22.527608447605992,
      "trained_tokens": 882,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 21,
      "train_loss": 0.1834019422531128,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4032160850424235,
      "tokens_per_second": 23.386532932460565,
      "trained_tokens": 940,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 22,
      "train_loss": 0.06850173324346542,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.414536359996213,
      "tokens_per_second": 16.16691803985231,
      "trained_tokens": 979,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 23,
      "train_loss": 0.05237733945250511,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4159004854380489,
      "tokens_per_second": 20.379123786464397,
      "trained_tokens": 1028,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 24,
      "train_loss": 0.02393646538257599,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4167573548027385,
      "tokens_per_second": 21.254625094939666,
      "trained_tokens": 1079,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 25,
      "train_loss": 0.017467325553297997,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4096912464356877,
      "tokens_per_second": 23.762092293269887,
      "trained_tokens": 1137,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 26,
      "train_loss": 0.03733742609620094,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4134138247169584,
      "tokens_per_second": 14.882897689810504,
      "trained_tokens": 1173,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 27,
      "train_loss": 0.07474444061517715,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4075455981795635,
      "tokens_per_second": 20.784825507157738,
      "trained_tokens": 1224,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 28,
      "train_loss": 0.3818274140357971,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40615839700496975,
      "tokens_per_second": 20.714078247253457,
      "trained_tokens": 1275,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 29,
      "train_loss": 0.01613910309970379,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4072248959825039,
      "tokens_per_second": 17.51067052724767,
      "trained_tokens": 1318,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 30,
      "train_loss": 0.014897194691002369,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4066768339211374,
      "tokens_per_second": 20.740518529978008,
      "trained_tokens": 1369,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 31,
      "train_loss": 0.014709068462252617,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4070327733136139,
      "tokens_per_second": 21.979769758935152,
      "trained_tokens": 1423,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 32,
      "train_loss": 0.025059150531888008,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4135533992862523,
      "tokens_per_second": 19.437009766453855,
      "trained_tokens": 1470,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 33,
      "train_loss": 0.1695040464401245,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40486502690909343,
      "tokens_per_second": 16.59946610327283,
      "trained_tokens": 1511,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 34,
      "train_loss": 0.0367494560778141,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.405318912371845,
      "tokens_per_second": 17.428713231989335,
      "trained_tokens": 1554,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 35,
      "train_loss": 0.06218770891427994,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4106637325781988,
      "tokens_per_second": 20.94385036148814,
      "trained_tokens": 1605,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 36,
      "train_loss": 0.07438264787197113,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4036475136089948,
      "tokens_per_second": 15.742253030750797,
      "trained_tokens": 1644,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 37,
      "train_loss": 0.03437327966094017,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40557624755310706,
      "tokens_per_second": 21.90111736786778,
      "trained_tokens": 1698,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 38,
      "train_loss": 0.026324249804019928,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4063218878123676,
      "tokens_per_second": 13.002300409995764,
      "trained_tokens": 1730,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 39,
      "train_loss": 0.011484481394290924,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4111916427505651,
      "tokens_per_second": 17.6812406382743,
      "trained_tokens": 1773,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 40,
      "train_loss": 0.16476936638355255,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4109455905402112,
      "tokens_per_second": 20.958225117550768,
      "trained_tokens": 1824,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 41,
      "train_loss": 0.03451908007264137,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4065850721555773,
      "tokens_per_second": 13.010722308978474,
      "trained_tokens": 1856,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 42,
      "train_loss": 0.042356058955192566,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40371451003266984,
      "tokens_per_second": 16.552294911339462,
      "trained_tokens": 1897,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 43,
      "train_loss": 0.020883731544017792,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.411116782812765,
      "tokens_per_second": 13.15573705000848,
      "trained_tokens": 1929,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 44,
      "train_loss": 0.08140161633491516,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4071393513849027,
      "tokens_per_second": 21.985524974784745,
      "trained_tokens": 1983,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 45,
      "train_loss": 0.09033991396427155,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.3888729198418074,
      "tokens_per_second": 19.832518911932176,
      "trained_tokens": 2034,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 46,
      "train_loss": 0.06769151985645294,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.39242596954975917,
      "tokens_per_second": 16.089464751540127,
      "trained_tokens": 2075,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 47,
      "train_loss": 0.0123085156083107,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.39843402804762784,
      "tokens_per_second": 20.32013543042902,
      "trained_tokens": 2126,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 48,
      "train_loss": 0.012427270412445068,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.3904519847785453,
      "tokens_per_second": 28.11254290405526,
      "trained_tokens": 2198,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 49,
      "train_loss": 0.06983139365911484,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40583386867688953,
      "tokens_per_second": 15.827520878398692,
      "trained_tokens": 2237,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 50,
      "train_loss": 0.04153081774711609,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4004021438928704,
      "tokens_per_second": 15.215281467929074,
      "trained_tokens": 2275,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 51,
      "train_loss": 0.032486092299222946,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40741708224903517,
      "tokens_per_second": 18.741185783455617,
      "trained_tokens": 2321,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 52,
      "train_loss": 0.057452861219644547,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40743221550455694,
      "tokens_per_second": 15.88985640467772,
      "trained_tokens": 2360,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 53,
      "train_loss": 0.10262370854616165,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40329783365778227,
      "tokens_per_second": 22.584678684835808,
      "trained_tokens": 2416,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 54,
      "train_loss": 0.1878930628299713,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40471265628769104,
      "tokens_per_second": 17.402644220370714,
      "trained_tokens": 2459,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 55,
      "train_loss": 0.0094942981377244,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4033770456810148,
      "tokens_per_second": 21.378983421093782,
      "trained_tokens": 2512,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 56,
      "train_loss": 0.06070026382803917,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.39825564680017117,
      "tokens_per_second": 23.89533880801027,
      "trained_tokens": 2572,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 57,
      "train_loss": 0.061454374343156815,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4055465588979374,
      "tokens_per_second": 17.438502032611307,
      "trained_tokens": 2615,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 58,
      "train_loss": 0.04706038162112236,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.404670211173309,
      "tokens_per_second": 15.377468024585742,
      "trained_tokens": 2653,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 59,
      "train_loss": 0.09941814094781876,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.39536138944243426,
      "tokens_per_second": 26.489213092643098,
      "trained_tokens": 2720,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 60,
      "train_loss": 0.09007709473371506,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4061850337781358,
      "tokens_per_second": 24.37110202668815,
      "trained_tokens": 2780,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 61,
      "train_loss": 0.07900814712047577,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4073002252187099,
      "tokens_per_second": 20.772311486154205,
      "trained_tokens": 2831,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 62,
      "train_loss": 0.051340509206056595,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4049351061147834,
      "tokens_per_second": 17.412209562935686,
      "trained_tokens": 2874,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 63,
      "train_loss": 0.03679603710770607,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4069417548821463,
      "tokens_per_second": 18.31237896969658,
      "trained_tokens": 2919,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 64,
      "train_loss": 0.02735568769276142,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.3952441913810866,
      "tokens_per_second": 23.714651482865193,
      "trained_tokens": 2979,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 65,
      "train_loss": 0.03277979791164398,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.41198072223015814,
      "tokens_per_second": 13.18338311136506,
      "trained_tokens": 3011,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 66,
      "train_loss": 0.08121589571237564,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4052347961901697,
      "tokens_per_second": 20.261739809508487,
      "trained_tokens": 3061,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 67,
      "train_loss": 0.04386136308312416,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4084618035330556,
      "tokens_per_second": 17.56385755192139,
      "trained_tokens": 3104,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 68,
      "train_loss": 0.03732955455780029,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4101760086867219,
      "tokens_per_second": 13.1256322779751,
      "trained_tokens": 3136,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 69,
      "train_loss": 0.010708188638091087,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4101936963114085,
      "tokens_per_second": 15.99755415614493,
      "trained_tokens": 3175,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 70,
      "train_loss": 0.052298154681921005,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40880729665298443,
      "tokens_per_second": 15.943484569466394,
      "trained_tokens": 3214,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 71,
      "train_loss": 0.01874130219221115,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40711459891591567,
      "tokens_per_second": 16.69169855555254,
      "trained_tokens": 3255,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 72,
      "train_loss": 0.025853227823972702,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4116745763927567,
      "tokens_per_second": 16.05530847931751,
      "trained_tokens": 3294,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 73,
      "train_loss": 0.011905642226338387,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40640405412377534,
      "tokens_per_second": 21.133010814436318,
      "trained_tokens": 3346,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 74,
      "train_loss": 0.055874187499284744,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4065392379596505,
      "tokens_per_second": 24.392354277579035,
      "trained_tokens": 3406,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 75,
      "train_loss": 0.00892561860382557,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4083419912587411,
      "tokens_per_second": 15.925337659090902,
      "trained_tokens": 3445,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 76,
      "train_loss": 0.003086356446146965,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40770293540949715,
      "tokens_per_second": 20.792849705884354,
      "trained_tokens": 3496,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 77,
      "train_loss": 0.02362193539738655,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.41231189423962894,
      "tokens_per_second": 17.729411452304046,
      "trained_tokens": 3539,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 78,
      "train_loss": 0.007850341498851776,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.41036099279321864,
      "tokens_per_second": 16.004078718935528,
      "trained_tokens": 3578,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 79,
      "train_loss": 0.06850773841142654,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.41176112612601407,
      "tokens_per_second": 16.882206171166576,
      "trained_tokens": 3619,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 80,
      "train_loss": 0.031027164310216904,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.39535865403183196,
      "tokens_per_second": 23.721519241909917,
      "trained_tokens": 3679,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 81,
      "train_loss": 0.10279189795255661,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.3969359652293001,
      "tokens_per_second": 20.243734226694304,
      "trained_tokens": 3730,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 82,
      "train_loss": 0.023950984701514244,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40635544664677226,
      "tokens_per_second": 17.473284205811208,
      "trained_tokens": 3773,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 83,
      "train_loss": 0.0147689338773489,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40883210913064494,
      "tokens_per_second": 22.07693389305483,
      "trained_tokens": 3827,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 84,
      "train_loss": 0.07945232093334198,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4037294780223023,
      "tokens_per_second": 20.590203379137417,
      "trained_tokens": 3878,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 85,
      "train_loss": 0.06902976334095001,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40903049343095277,
      "tokens_per_second": 21.269585658409543,
      "trained_tokens": 3930,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 86,
      "train_loss": 0.023874681442975998,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4041099599377516,
      "tokens_per_second": 23.034267716451843,
      "trained_tokens": 3987,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 87,
      "train_loss": 0.0052575538866221905,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.405991521373362,
      "tokens_per_second": 17.457635419054565,
      "trained_tokens": 4030,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 88,
      "train_loss": 0.0026927178259938955,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4073010684639815,
      "tokens_per_second": 23.623461970910927,
      "trained_tokens": 4088,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 89,
      "train_loss": 0.04841819405555725,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4054325462107385,
      "tokens_per_second": 21.893357495379878,
      "trained_tokens": 4142,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 90,
      "train_loss": 0.06511291116476059,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.405035851238459,
      "tokens_per_second": 16.60646990077682,
      "trained_tokens": 4183,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 91,
      "train_loss": 0.01709918864071369,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.41143779933555347,
      "tokens_per_second": 16.86894977275769,
      "trained_tokens": 4224,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 92,
      "train_loss": 0.037780508399009705,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4071994698690792,
      "tokens_per_second": 21.581571903061196,
      "trained_tokens": 4277,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 93,
      "train_loss": 0.08547952771186829,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40664680467738284,
      "tokens_per_second": 15.859225382417932,
      "trained_tokens": 4316,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 94,
      "train_loss": 0.06486809998750687,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40941989880544155,
      "tokens_per_second": 15.96737605341222,
      "trained_tokens": 4355,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 95,
      "train_loss": 0.006406103726476431,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40415104900302146,
      "tokens_per_second": 20.611703499154096,
      "trained_tokens": 4406,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 96,
      "train_loss": 0.029461942613124847,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4022935155614526,
      "tokens_per_second": 20.516969293634084,
      "trained_tokens": 4457,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 97,
      "train_loss": 0.005884283222258091,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40853955241231044,
      "tokens_per_second": 21.652596277852453,
      "trained_tokens": 4510,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 98,
      "train_loss": 0.04372367635369301,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.3916204132673275,
      "tokens_per_second": 23.49722479603965,
      "trained_tokens": 4570,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 99,
      "train_loss": 0.04538821429014206,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.41031891895728756,
      "tokens_per_second": 16.002437839334217,
      "trained_tokens": 4609,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 100,
      "train_loss": 0.04519634321331978,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40526081907765776,
      "tokens_per_second": 17.426215220339284,
      "trained_tokens": 4652,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 101,
      "train_loss": 0.03962958604097366,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.407767127862616,
      "tokens_per_second": 13.048548091603712,
      "trained_tokens": 4684,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 102,
      "train_loss": 0.016563206911087036,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4069118659891605,
      "tokens_per_second": 17.497210237533903,
      "trained_tokens": 4727,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 103,
      "train_loss": 0.005955581087619066,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40395226899760933,
      "tokens_per_second": 21.813422525870905,
      "trained_tokens": 4781,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 104,
      "train_loss": 0.017488669604063034,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4108560071909244,
      "tokens_per_second": 13.147392230109581,
      "trained_tokens": 4813,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 105,
      "train_loss": 0.004414835013449192,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4063872838731204,
      "tokens_per_second": 20.31936419365602,
      "trained_tokens": 4863,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 106,
      "train_loss": 0.021920260041952133,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4065166997751132,
      "tokens_per_second": 13.008534392803622,
      "trained_tokens": 4895,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 107,
      "train_loss": 0.03569544479250908,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40380297604840854,
      "tokens_per_second": 16.55592201798475,
      "trained_tokens": 4936,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 108,
      "train_loss": 0.04486963897943497,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4039342455485348,
      "tokens_per_second": 14.541632839747253,
      "trained_tokens": 4972,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 109,
      "train_loss": 0.04898642748594284,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.39214032488218004,
      "tokens_per_second": 26.273401767106062,
      "trained_tokens": 5039,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 110,
      "train_loss": 0.0059542469680309296,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.415393284267667,
      "tokens_per_second": 13.292585096565343,
      "trained_tokens": 5071,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 111,
      "train_loss": 0.07824550569057465,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.390612348432884,
      "tokens_per_second": 22.655516209107272,
      "trained_tokens": 5129,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 112,
      "train_loss": 0.045520927757024765,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4044456190081425,
      "tokens_per_second": 15.773379141317559,
      "trained_tokens": 5168,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 113,
      "train_loss": 0.0013750940561294556,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.41709336917425266,
      "tokens_per_second": 13.346987813576085,
      "trained_tokens": 5200,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 114,
      "train_loss": 0.07610917091369629,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40503968604329604,
      "tokens_per_second": 15.39150806964525,
      "trained_tokens": 5238,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 115,
      "train_loss": 0.0643395259976387,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4060964828404625,
      "tokens_per_second": 20.710920624863586,
      "trained_tokens": 5289,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 116,
      "train_loss": 0.1066485121846199,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40618312934782264,
      "tokens_per_second": 17.465874561956376,
      "trained_tokens": 5332,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 117,
      "train_loss": 0.0013244240544736385,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4066321500355292,
      "tokens_per_second": 21.95813610191858,
      "trained_tokens": 5386,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 118,
      "train_loss": 0.01391695812344551,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40671316686175124,
      "tokens_per_second": 13.01482133957604,
      "trained_tokens": 5418,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 119,
      "train_loss": 0.031373463571071625,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.41003293179208833,
      "tokens_per_second": 17.6314160670598,
      "trained_tokens": 5461,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 120,
      "train_loss": 0.03651957958936691,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4077495035784481,
      "tokens_per_second": 19.16422666818706,
      "trained_tokens": 5508,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 121,
      "train_loss": 0.02555217780172825,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40316566356692346,
      "tokens_per_second": 22.577277159747716,
      "trained_tokens": 5564,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 122,
      "train_loss": 0.006124570500105619,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4045258283312453,
      "tokens_per_second": 18.203662274906037,
      "trained_tokens": 5609,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 123,
      "train_loss": 0.024428032338619232,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40468305299221086,
      "tokens_per_second": 16.592005172680643,
      "trained_tokens": 5650,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 124,
      "train_loss": 0.01869654841721058,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40566322082909406,
      "tokens_per_second": 20.688824262283795,
      "trained_tokens": 5701,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 125,
      "train_loss": 0.009740237146615982,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40404370299700404,
      "tokens_per_second": 12.92939849590413,
      "trained_tokens": 5733,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 126,
      "train_loss": 0.07189936935901642,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4051969617391344,
      "tokens_per_second": 20.25984808695672,
      "trained_tokens": 5783,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 127,
      "train_loss": 0.0031723976135253906,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40408137674714767,
      "tokens_per_second": 20.60815021410453,
      "trained_tokens": 5834,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 128,
      "train_loss": 0.08921140432357788,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.3909955931061051,
      "tokens_per_second": 19.94077524841136,
      "trained_tokens": 5885,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 129,
      "train_loss": 0.009774208068847656,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4044963886548606,
      "tokens_per_second": 12.943884436955539,
      "trained_tokens": 5917,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 130,
      "train_loss": 0.037923406809568405,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4091198333998105,
      "tokens_per_second": 15.5465536691928,
      "trained_tokens": 5955,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 131,
      "train_loss": 0.02316184714436531,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40687974653613546,
      "tokens_per_second": 17.495829101053825,
      "trained_tokens": 5998,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 132,
      "train_loss": 0.0006547040538862348,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.38749668326999126,
      "tokens_per_second": 27.89976119543937,
      "trained_tokens": 6070,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 133,
      "train_loss": 0.01891128532588482,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.406803724433923,
      "tokens_per_second": 16.678952701790845,
      "trained_tokens": 6111,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 134,
      "train_loss": 0.01459120586514473,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.407533930449401,
      "tokens_per_second": 13.041085774380832,
      "trained_tokens": 6143,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 135,
      "train_loss": 0.05952219292521477,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4046657147552127,
      "tokens_per_second": 19.019288593494995,
      "trained_tokens": 6190,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 136,
      "train_loss": 0.17892397940158844,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4051929596153114,
      "tokens_per_second": 15.802525424997144,
      "trained_tokens": 6229,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 137,
      "train_loss": 0.02436509169638157,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4043570278457031,
      "tokens_per_second": 19.813494364439453,
      "trained_tokens": 6278,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 138,
      "train_loss": 0.0019977204501628876,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4057742007971045,
      "tokens_per_second": 17.448290634275494,
      "trained_tokens": 6321,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 139,
      "train_loss": 0.02200533077120781,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.402345567312722,
      "tokens_per_second": 20.51962393294882,
      "trained_tokens": 6372,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 140,
      "train_loss": 0.014493918046355247,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4077407613349019,
      "tokens_per_second": 15.901889692061173,
      "trained_tokens": 6411,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 141,
      "train_loss": 0.010069838725030422,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40554270084279614,
      "tokens_per_second": 17.84387883708303,
      "trained_tokens": 6455,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 142,
      "train_loss": 0.0035744868218898773,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4121723776986721,
      "tokens_per_second": 13.189516086357507,
      "trained_tokens": 6487,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 143,
      "train_loss": 0.005759940482676029,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.4098588750634024,
      "tokens_per_second": 21.312661503296923,
      "trained_tokens": 6539,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 144,
      "train_loss": 0.0041524083353579044,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40233389871423486,
      "tokens_per_second": 21.32369663185445,
      "trained_tokens": 6592,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 145,
      "train_loss": 0.0032894655596464872,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.40031295794745014,
      "tokens_per_second": 21.61689972916231,
      "trained_tokens": 6646,
      "peak_memory": 6.792838444
    },
    {
      "iteration": 146,
      "train_loss": 0.006335147190839052,
      "learning_rate": 4.999999873689376e-05,
      "iterations_per_second": 0.39725408048143157,
      "tokens_per_second": 18.273687702145853,
      "trained_tokens": 6692,
      "peak_memory": 6.792838444
    }
  ],
  "checkpoint": "training_artifacts/20261014T222622-qwen-intent-qlora/adapter",
  "checkpoint_sha256": "e758e9e83f7453f9ab26138609fe86115ddd7defd7ed625965458ecaf8bd93a8",
  "candidate_model_version": "qwen3.5-9b-4bit-8b2b98c00a6b-intent-v7-qlora-e758e9e83f74",
  "intent_after": {
    "json_rate": 1.0,
    "schema_rate": 0.9830508474576272,
    "intent_rate": 0.3728813559322034,
    "action_filters_rate": 0.5254237288135594,
    "query_rate": 0.7288135593220338,
    "ambiguous_numeric_intent_rate": 0.6666666666666666,
    "cross_turn_intent_rate": 0.75,
    "injection_intent_rate": 0.0,
    "messy_text_intent_rate": 0.6666666666666666,
    "mood_noise_intent_rate": 0.3333333333333333,
    "negation_intent_rate": 0.3333333333333333,
    "no_intent_intent_rate": 1.0,
    "numeric_intent_rate": 0.25,
    "regression_intent_rate": 0.3103448275862069,
    "release_intent_rate": 0.0,
    "safety_intent_rate": 0.5
  },
  "checkpoint_reload_max_error": 0.0,
  "checkpoint_reload_verified": true,
  "base_weights_unchanged": true,
  "gpu_peak_memory_mb": 6478.2,
  "ended_at": "2026-10-14T22:36:43+08:00",
  "duration_seconds": 620.324,
  "before_after_comparison": {
    "status": "trained_synthetic_intent_not_published",
    "published": false,
    "updated_users": 0,
    "model_before": "qwen3.5-9b-4bit-8b2b98c00a6b-intent-v7",
    "model_after": "qwen3.5-9b-4bit-8b2b98c00a6b-intent-v7-qlora-e758e9e83f74",
    "evaluation": "same frozen holdout, production prompt and max_tokens; greedy temperature 0; raw JSON action/query/filters",
    "weights_changed": true,
    "checkpoint_after": "training_artifacts/20261014T222622-qwen-intent-qlora/adapter",
    "data_snapshot_sha256": "79a5cb29116541eb5568c36a533a63f2062f62092c561a160e3f25c5de0cee14",
    "metrics": [
      {
        "name": "json_rate",
        "before": 1.0,
        "after": 1.0,
        "delta_after_minus_before": 0.0,
        "better_direction": "higher"
      },
      {
        "name": "schema_rate",
        "before": 0.8813559322033898,
        "after": 0.9830508474576272,
        "delta_after_minus_before": 0.10169491525423735,
        "better_direction": "higher"
      },
      {
        "name": "intent_rate",
        "before": 0.6101694915254238,
        "after": 0.3728813559322034,
        "delta_after_minus_before": -0.23728813559322037,
        "better_direction": "higher"
      },
      {
        "name": "action_filters_rate",
        "before": 0.7966101694915254,
        "after": 0.5254237288135594,
        "delta_after_minus_before": -0.27118644067796605,
        "better_direction": "higher"
      },
      {
        "name": "query_rate",
        "before": 0.6779661016949152,
        "after": 0.7288135593220338,
        "delta_after_minus_before": 0.05084745762711862,
        "better_direction": "higher"
      },
      {
        "name": "ambiguous_numeric_intent_rate",
        "before": 0.3333333333333333,
        "after": 0.6666666666666666,
        "delta_after_minus_before": 0.3333333333333333,
        "better_direction": "higher"
      },
      {
        "name": "cross_turn_intent_rate",
        "before": 0.5,
        "after": 0.75,
        "delta_after_minus_before": 0.25,
        "better_direction": "higher"
      },
      {
        "name": "injection_intent_rate",
        "before": 0.0,
        "after": 0.0,
        "delta_after_minus_before": 0.0,
        "better_direction": "higher"
      },
      {
        "name": "messy_text_intent_rate",
        "before": 0.6666666666666666,
        "after": 0.6666666666666666,
        "delta_after_minus_before": 0.0,
        "better_direction": "higher"
      },
      {
        "name": "mood_noise_intent_rate",
        "before": 0.3333333333333333,
        "after": 0.3333333333333333,
        "delta_after_minus_before": 0.0,
        "better_direction": "higher"
      },
      {
        "name": "negation_intent_rate",
        "before": 0.6666666666666666,
        "after": 0.3333333333333333,
        "delta_after_minus_before": -0.3333333333333333,
        "better_direction": "higher"
      },
      {
        "name": "no_intent_intent_rate",
        "before": 1.0,
        "after": 1.0,
        "delta_after_minus_before": 0.0,
        "better_direction": "higher"
      },
      {
        "name": "numeric_intent_rate",
        "before": 0.75,
        "after": 0.25,
        "delta_after_minus_before": -0.5,
        "better_direction": "higher"
      },
      {
        "name": "regression_intent_rate",
        "before": 0.6551724137931034,
        "after": 0.3103448275862069,
        "delta_after_minus_before": -0.3448275862068965,
        "better_direction": "higher"
      },
      {
        "name": "release_intent_rate",
        "before": 0.6666666666666666,
        "after": 0.0,
        "delta_after_minus_before": -0.6666666666666666,
        "better_direction": "higher"
      },
      {
        "name": "safety_intent_rate",
        "before": 1.0,
        "after": 0.5,
        "delta_after_minus_before": -0.5,
        "better_direction": "higher"
      }
    ]
  },
  "publication_decision": {
    "published": false,
    "accepted": false,
    "reason": "Reject this adapter: fixed heldout complete intent decreased 36/59 to 22/59; action+filters decreased 47/59 to 31/59; production-parser action+filters decreased 48/59 to 32/59 with 17 per-case regressions. Local Worker guards retain most conditions; hypothetical merge +1 does not override model regression.",
    "parser_regressions": [
      "validation-078",
      "validation-080",
      "validation-084",
      "validation-085",
      "validation-086",
      "validation-095",
      "validation-100",
      "regression-pure-tea",
      "regression-fresh-milk",
      "regression-brand-more",
      "regression-milk-no",
      "regression-milk-no-prior",
      "regression-milk-release",
      "regression-milk-choose",
      "regression-pure-red",
      "regression-brand-dislike",
      "regression-h-milk-only"
    ],
    "merge_regressions": [],
    "online_model_before": "qwen3.5-9b-4bit-8b2b98c00a6b-intent-v7",
    "online_model_after": "qwen3.5-9b-4bit-8b2b98c00a6b-intent-v7",
    "online_prompt_changed": false,
    "online_adapter_installed": false,
    "updated_users": 0
  },
  "worker_merge_comparison_report": "docs/training-runs/20261014T222622-qwen-intent-qlora-worker-merge.json",
  "worker_merge_probe": {
    "method": "same frozen generations; production null codec / guard override and actual existing Worker merge only; not full HTTP/eligibility/ranking replay",
    "before": 50,
    "after": 51,
    "total": 59,
    "delta": 1,
    "model_routed": 48,
    "routed_before": 41,
    "routed_after": 42,
    "bypassed": 11,
    "limitations": [
      "Some scenarios are bypassed by the real Worker; hypothetical merge results must not be claimed as production gains",
      "Current merge rules restrict novel typo/English aliases and cannot repair every existing preprocessing error",
      "No real-user ranking or satisfaction benchmark"
    ]
  },
  "counts": {
    "validation": 59,
    "raw_json_before": 59,
    "raw_json_after": 59,
    "raw_schema_before": 52,
    "raw_schema_after": 58,
    "raw_intent_before": 36,
    "raw_intent_after": 22,
    "raw_action_filters_before": 47,
    "raw_action_filters_after": 31,
    "raw_query_before": 40,
    "raw_query_after": 43,
    "parser_action_filters_before": 48,
    "parser_action_filters_after": 32
  },
  "supporting_script_sha256": {
    "training/qwen_completion_loss.py": "a35002f03c506840a344a84b7256fc2ae2d8c617b8f89dea0d2876fb88d1a68a",
    "training/qwen_robust_cases.py": "ba7d9df3fbecb9265cb9fdcfa43f729f836011ba7a12d5b62729d48387149131",
    "scripts/score_qwen_robust.ts": "a67ae58d305744471133c0a43ae0e4c930157fc01478fcabd1e7b2d84389718b"
  },
  "attempts": [
    {
      "run_id": "20261014T221226-qwen-intent-qlora",
      "status": "failed_before_model_load",
      "completed_optimizer_steps": 0
    },
    {
      "run_id": "20261014T221255-qwen-intent-qlora",
      "status": "failed_metal_out_of_memory",
      "completed_optimizer_steps": 0
    },
    {
      "run_id": "20261014T222622-qwen-intent-qlora",
      "status": "trained_candidate_rejected",
      "completed_optimizer_steps": 146
    }
  ]
}
```
