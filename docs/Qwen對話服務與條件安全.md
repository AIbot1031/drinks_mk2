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

## 2.3 對話主入口與帳號快捷標籤追加更新

Qwen 現在接收最近最多 8 則對話、目前篩選條件，以及最多各 10 筆收藏／不喜歡飲料的名稱、茶種、奶類、配料和風味。這份偏好摘要不含帳號 ID、登入憑證或時間事件。收藏只是參考，本輪要求優先，不喜歡單一飲料不代表排除整個品牌。

`worker/catalog-features.ts` 由目前飲料資料生成 `drink-catalog-v1` 特徵契約，提供實際茶種、奶類、配料、各篩選欄位的含義與資料限制。Qwen 輸出 `action=clarify` 時先追問；需求足夠才輸出 `action=recommend`，交給 MacBERT 候選排序與原有融合流程。追問時沒有飲料榜單，內部紀錄也不記不存在的 A／B 排名。未知配料不得當成已排除；模型不合法輸出時仍使用驗證與備援。

已支援「珍奶但是不要珍」「別加珍珠」「不想要珍珠」「粉圓」等說法，以及資料庫中的奶蓋、果肉、冰淇淋、茶凍、芋圓、芋泥排除。未知配料會詢問完整名稱；回答「珍珠」可接續前一輪排除問題。真正過敏限制仍由後端保留。此更新為提示詞及對話流程更新，模型版本增加 `-intent-v2`，沒有訓練或改變 Qwen 權重。

登入後在對話框下方按「自訂快捷標籤」，可新增、修改、刪除最多 8 個標籤；名稱 1–20 字，送出的需求 1–300 字。儲存在 D1 該用戶的 `chat_shortcuts` 欄位，跨裝置登入保留；與按讚偏好分開寫入，避免互相覆蓋。API 為 `/api/account/shortcuts` GET／PUT，必須通過消費者登入及同源檢查，無法指定他人帳號。訪客使用預設標籤。

對話卡住、沒有符合結果或請求錯誤時，下方輸入框附近會顯示「重新開始」；按下清除本輪對話、條件與已看批次，保留帳號收藏與快捷標籤。

安全追加：Qwen 改用獨立 LLM_KEY，經作業系統隔離和 loopback 固定目的地轉接連到 Worker，不使用 MacBERT／訓練匯出金鑰。部署位置與防護範圍見 [本機安全說明](Qwen本機安全與部署位置.md)。
