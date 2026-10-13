# Qwen 對話推薦服務（2.3）

使用者選擇 Qwen 8B，並授權由 Mac 處理、完成後直接上線。使用 Qwen3-8B 的 MLX 4-bit 量化版本，固定 revision `545dc4251c05440727734bcd94334791f6ab0192`；關閉 thinking、temperature 0、最多輸出 320 tokens，優先兼顧記憶體及速度。本次只下載預訓練權重並執行推論，沒有微調 Qwen。

資料來源：[Qwen 官方模型](https://huggingface.co/Qwen/Qwen3-8B)、[MLX 量化模型](https://huggingface.co/mlx-community/Qwen3-8B-4bit)、[MLX LM](https://github.com/ml-explore/mlx-lm)。

## 消費者流程

1. 網站傳送本輪文字與先前篩選條件到 Worker。
2. 規則先辨識預算、品牌、配料與真正的過敏限制。
3. Qwen 經過 Mac 主動建立的驗證 WebSocket，解析為 JSON 口味與條件。LLM 與 MacBERT 分開連線，互不取代。
4. Worker 驗證模型輸出，不接受未知品牌、放寬已辨識上限、移除排除配料或清除過敏限制。
5. 用資料庫硬性篩選，再由 MacBERT 路徑 A 與既有偏好圖路徑 B 排序。飲料名稱、價格及營養皆来自資料庫，不由 Qwen 編造。
6. 對話顯示實際使用 Qwen 或規則備援；內部推薦紀錄保存解析來源、模型版本及推論耗時。

「奶茶不要珍珠」轉成 `milkTea:true`、`excludedToppings:['珍珠']`，珍珠與波霸視為同類排除；後續調整預算繼續保留排除。舊版誤判為忌口的單純配料需求可以恢復，真正過敏仍保留限制。

## 執行與備援

執行 `python3 scripts/install_qwen_service.py` 安裝登入後持續運作的 `local.drinks-mk2.qwen` LaunchAgent；模型及獨立 Python 環境複製到 `~/Library/Application Support/DrinksMk2LLM`。套件版本記錄於 `training/requirements-llm-lock.txt`，與 MacBERT 的 Transformers 環境分開。

Qwen 解析等待上限 20 秒，失敗、離線或不合法 JSON 時退回規則解析；MacBERT 等待上限 5 秒，失敗退回 TF-IDF。備援仍執行預算、品牌與配料硬性篩選。服務以金鑰驗證，金鑰與模型權重不放 GitHub。Mac 必須開機、登入且連網；這是推論常駐服務，不是凌晨訓練排程。
