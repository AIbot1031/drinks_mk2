# Qwen 飲料意圖 QLoRA 訓練

2026-10-13 已新增並實際執行 `scripts/train_qwen.py`。最初使用本機固定 revision 的 Qwen3-8B 4-bit 與 MLX，只有最後 4 層 rank 4 adapter 接受更新，基礎模型凍結；預設 batch 1、10 optimizer steps、lr 0.0001、max sequence 2048。每次從相同基礎模型重新建立 adapter，尚不支援線上版本續訓。

```sh
.venv-llm/bin/python scripts/train_qwen.py --iters 10
```

來源資料在 `training/qwen_intent_cases.py`（intent-cases-v1）：24 筆簡單單一修改訓練例句、10 筆另行編寫的組合情境驗證。這些是本次助理明確編寫及核對標籤的合成案例，沒有使用者人工標註或真實用戶對話，不是收集到的顧客資料。沒有從模型輸出自動產生標籤。訓練與驗證不共享完整情境或同義改寫擴增，但任務詞彙和系統提示相同；小型合成驗證不能代表真實使用分布。案例以先前 state 作語意更新輸入，與網站規則已先合併本輪 state 的實際 payload 不完全相同；發布前還須使用實際 Worker 契約情境驗證。

使用現有 SYSTEM 與 tokenizer 的非思考模式，遮蔽 prompt loss，只訓練 JSON 回答。序列超過長度時直接失敗，不能截掉目標。驗證採 deterministic greedy generation，同一份固定案例在前後評估；JSON/schema 合法率、品牌／配料排除與解除、數值、跨輪、澄清以各組完整 action/query/filters 一致率計算，assistantMessage 只檢查字串格式，不以文案相同作正確判準。query 字串也要求完全相同，這是嚴格測試，不等同語意等價率。

候選 adapter 保存在忽略 Git 的 `training_artifacts/<run-id>/adapter`；合成測試輸出保留在同一目錄。公開安全彙總報告在 `docs/training-runs/<run-id>.md/.json`，daily.txt 只記彙總。報告記固定資料／目錄／系統提示 hash、基礎權重 hash、實際步數、參數、前後語意指標及差值、adapter hash、保存／重載 logits 一致性、基礎檔案是否未變與是否發布。

第一次執行已完成 10 步，但重載驗證中的 bfloat16→NumPy 轉換失敗，失敗報告保留。修正為先轉 float32 後重跑，完成 10 步並確認 logits 誤差 0。前兩次只固定 MLX seed，NumPy 的批次排列未固定，因此兩次訓練結果不同，不能把指標差異歸因於 dtype 修正。之後入口已補上 NumPy seed=42；本次補 seed 沒有另訓第三次。

第二次固定合成驗證：JSON/schema 都為 100%；完整 intent 60%→80%（6/10→8/10）。品牌解除與澄清仍失敗；第一個失敗候選則為 60%→20%。全部真實結果均保留，未發布任何一版。下降的 token validation loss 不能冒充意圖改善。

每日排程目前為 Asia/Taipei 02:00，由 Codex 回到此聊天呼叫：

```sh
.venv-training/bin/python scripts/run_daily_training.py --check
.venv-training/bin/python scripts/run_daily_training.py
```

三模型串行、檔案鎖防重疊、受保護的 Cloudflare 真實匿名事件匯出、模型別及批次報告；一模型失敗仍處理其餘模型。Mac 與 Codex App 必須運作。runner 只保存候選，發布須由排程後續工作完成獨立驗證、線上舊新版本比較、推論契約／硬篩選／重載與回復檢查；條件不足沿用現有版本。訓練已實作不代表 adapter 已被推論服務載入。

[MLX 官方 LoRA／QLoRA 文件](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/LORA.md)。

## 2026-10-14 基礎模型更新

`scripts/qwen_model.py` 為推論及訓練共用預設，現在為 Qwen3.5-9B MLX 4-bit 固定快照。每日 02:00 排程保留；下次 Qwen 訓練從 9B 基礎模型重新建立 adapter，不載入舊 8B adapter，不自動續接前一天 adapter。

本次切換 optimizer 步數 0。以正式訓練相同的最後 4 層／rank 4 配置，對一筆人工合成資料進行前向及反向相容性探測，1,352,448 可訓練參數、62 個梯度張量均有限且有非零梯度；沒有 optimizer update、沒有保存新候選。最長既有訓練序列為 1,268 tokens，小於 2,048 上限。這只證明入口相容，不能宣稱已訓練或推薦改善。

資料仍是 intent-cases-v1，原有的小樣本及 state 與正式 Worker 差異仍適用。訓練評估原始模型生成；服務數值 null→省略的格式轉換不混入訓練原始語意指標。完整切換與回復：[Qwen3.5-9B 模型切換與驗證](Qwen3.5-9B模型切換與驗證.md)。
