# Qwen3.5-9B 模型切換與驗證

2026-10-14（Asia/Taipei）已切換網站對話服務；10:36:47 核對雲端及線上測試結果。這次是更換凍結基礎權重、提示詞及解析格式，不是訓練，實際 optimizer 步數 0，沒有安裝 adapter。

目前線上版本：`qwen3.5-9b-4bit-8b2b98c00a6b-intent-v7`。來源為 [Qwen 官方 Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B) 的 [MLX 4-bit 轉換](https://huggingface.co/mlx-community/Qwen3.5-9B-4bit)，固定 revision `8b2b98c00a6b4d291155e4890773ca8f769aee53`。兩份 safetensors 及 tokenizer 的 SHA-256 已核對。MLX 0.32.3、mlx-lm 0.32.0、Transformers 5.19.0 已支援並成功載入，沒有升級套件。

完整機器可讀證據：[最終比較、線上狀態與測試 JSON](model-validation/20261014-qwen35-final.json)。

## 實作範圍

- `scripts/qwen_model.py` 共用推論與每日訓練的預設模型；版本由核准的模型來源及固定 revision 生成，保留 8B 回復選項。
- `scripts/download_qwen35.py` 可重現固定快照下載及 SHA-256 檢查。權重及服務金鑰留在本機、忽略 Git。
- 推論使用 MLX 文字模型、temperature 0、關閉 thinking、最多 320 tokens；沒有將原 8B adapter 套到 9B。
- 最終沿用第二輪 intent-v5 的提示詞，補強目前 state、排除解除、數值及保留條件的意義。intent-v7 再新增數值欄位格式轉換：`maxPrice/maxCalories/maxCaffeine:null` 轉成省略欄位；不修改非空值、排除陣列或其他欄位。Worker 繼續從已驗證 state 合併，模型省略數值不能自行解除原上限。
- Worker 接受指定的 8B／9B 版本家族，前端及 trace 顯示真正使用的模型；同一 Wi-Fi 的監控也能顯示新版版本與 GPU 記憶體。
- 推論仍在 `~/Library/Application Support/DrinksMk2LLM` 的 LaunchAgent 運作，延用 sandbox、獨立 LLM 金鑰及只通往本站的 TLS 轉接。

## 如何比較

線上舊版為 Qwen3-8B `intent-v4`，候選為 Qwen3.5-9B `intent-v7`。相同目錄、相同案例、相同 greedy 生成參數及驗證器；新舊提示詞 hash 各別記錄。更換模型與提示詞是同一組更新，指標改善不能單獨歸因於 9B 參數量。

先保留 21 組契約案例不變來修正提示詞，再測另外 8 組情境；這 8 組未用來修改最終沿用的 intent-v5 提示。案例均是人工合成、由實際 Worker 預處理的狀態，沒有真實顧客對話或用戶身份。21 組已參與提示修正，是開發案例；8 組只是補充合成契約驗證，不能代表實際使用分布。

原始輸出、解析器格式轉換後、網站約束合併後分開計算。檢查 action 與完整 filters 一致，並要求奶茶排除時 query 不含奶茶類詞；不是所有 query 字串的語意等價或推薦相關性評估。解析器的規則性轉換與 Worker 防護不能宣稱為模型本身全部答對。

| 指標 | 舊版 | 新版 | 差值 |
| --- | ---: | ---: | ---: |
| 21 組原始 action／filters／負向 query 通過數 | 18/21 | 20/21 | +2 |
| 21 組原始 JSON/schema 通過數 | 21/21 | 20/21 | -1 |
| 21 組解析器通過數 | 18/21 | 21/21 | +3 |
| 21 組解析器 JSON/schema 通過數 | 21/21 | 21/21 | 0 |
| 21 組網站合併後通過數 | 21/21 | 21/21 | 0 |
| 8 組原始 action／filters／負向 query 通過數 | 6/8 | 6/8 | 0 |
| 8 組原始 JSON/schema 通過數 | 8/8 | 7/8 | -1 |
| 8 組解析器通過數 | 6/8 | 7/8 | +1 |
| 8 組解析器 JSON/schema 通過數 | 8/8 | 8/8 | 0 |
| 8 組網站合併後通過數 | 8/8 | 8/8 | 0 |
| 權重重載 logits 最大誤差 | 0 | 0 | 0 |

發布檢查採實際解析器及網站契約：解析器沒有任何「舊版通過、新版失敗」案例，schema 全部通過，網站 29/29、權重重載一致。原始模型仍在兩個數值解除案例輸出 null，格式轉換後才通過；8 組中的 `h-milk-prior` 仍誤選 recommend，Worker 既有的奶茶否定／無正向口味防護將它轉為澄清。這些限制完整保留，不能宣稱原始模型 29/29。

21 組最終格式轉換比較重用已完成的 intent-v5 原始生成，先核對相同 fixture、提示詞、版本來源及所有權重 hash；沒有將重用資料說成重新生成。8 組的新版重新生成，線上也另實測實際常駐服務。

## 保留的未通過版本

- [第一輪 intent-v4](model-validation/20261014T101216-qwen35-intent-v4.md)：原始 18/21→15/21，有多個退步，未發布。
- [第二輪 intent-v5](model-validation/20261014-qwen35-intent-v5.json)：原始 18/21→20/21，但數值欄位 null 不合格式，未發布。
- [第三輪 intent-v6](model-validation/20261014-qwen35-intent-v6.json)：原始 19/21，新增珍珠排除退步，未發布；[另外 8 組紀錄](model-validation/20261014-qwen35-holdout-v6.json) 也保留。

最後回到較穩定的 intent-v5 提示，透過明確的 optional-number 格式轉換形成 intent-v7，沒有覆寫前面結果。

## 線上驗證與部署

45 項網站測試全部通過，沒有略過；包含實際本機 Worker HTTP、硬篩選、換批、帳號、角色權限及模型連線替換。另有 11 項 Python 模型來源、格式、排程失敗處理、轉接與監控檢查通過。型別檢查、Python 語法檢查、build／Wrangler dry-run 通過。

發布至 `drinks-mk2.rtx941031.workers.dev`，Worker version `6386c939-a8b1-4672-866b-daef3688a1dd`。部署後 Qwen、MacBERT、RelGT 都 connected／ready，目錄 hash 均為 `6aa67407a66b04c496e2cfa80800a66857a74d13f842f8b8c03b04ae61205bab`。MacBERT 仍為 `macbert-8e08de527639956d`，RelGT 仍為 `relgt-temporal-05757994850db8f6`。

9 次正式網站 API 情境全部通過：奶茶否定先澄清；接著綠茶／80 元／排除春水堂得到 6 杯合格飲料；換批不重複且保留排除；解除奶茶排除、明確改喝奶茶、允許春水堂但不強制指定品牌；設定及解除咖啡因上限時保留預算；手動奶茶否定也全部排除。7 次需模型解析的請求均回報新版 9B，換批為 quick-command，手動搜尋依既有路徑運作。

線上完整請求約 0.9–9.1 秒，包含網路與推薦流程，不等於純模型生成時間。常駐模型回報 GPU active 約 4,804.7 MiB，測試後 peak 約 6,278.9 MiB；這不是 GPU 使用率。首次以系統 Python urllib 發送 POST 收到 HTTP 403，尚未取得推薦結果；保留失敗紀錄，改用既有 Node fetch 通路後 9 項通過，沒有把該失敗當成模型品質測試。

## 每日訓練及回復

每日 Asia/Taipei 02:00 的 automation `relgt` 與時段未更動。runner 的 Qwen 預設已由 8B 改成 9B，每次仍從凍結基礎權重建立新 adapter，10 steps；沒有沿用 8B adapter，也不是續訓。`--check` 已回報新版預設。

以相同 LoRA 配置進行過一次合成前向／反向相容性探測：1,352,448 可訓練參數、62 個梯度張量有限且有非零梯度，沒有 optimizer update 或保存新 adapter。資料及限制見 [Qwen訓練操作](Qwen訓練操作.md)。訓練報告仍評估原始生成，沒有以格式轉換冒充模型語意改善。

保留原 8B 權重及原 LaunchAgent／intent-v4 程式快照於忽略 Git 的 `.wrangler/qwen35-rollback-20261014`。本機精確回復可執行其 `restore.py`；若僅改回 8B 基礎模型，可用 `python3 scripts/install_qwen_service.py --model training_artifacts/qwen3-8b-4bit`，此方式保留目前提示／解析器版本。完整回復網站時，舊 Worker version 為 `1cd8ab9c-b681-4d3c-b5b3-b942a1bd442f`，之後必須再次核對 modelVersion、catalogVersion、ready 及網站硬篩選。沒有修改 D1 結構或資料。

本次沒有 Git commit／push；原先未提交工作及使用者 ZIP 保留。模型權重、金鑰、原始互動快照與回復快照沒有加入 Git。
