# Qwen 在哪裡，以及本機防護

Qwen3-8B 4-bit 在這台 Mac 的 MLX 上推論，Cloudflare 負責網站、驗證與請求轉接。沒有把模型部署到 Workers AI 或其他外部 LLM 供應商。

- 執行目錄：`/Users/ai/Library/Application Support/DrinksMk2LLM`
- 模型：上述目錄下 `training_artifacts/qwen3-8b-4bit`，包含 `config.json`、tokenizer 與 safetensors；僅本機保存，不上 GitHub。
- 執行程式：`scripts/qwen_agent.py`；對應專案來源為 `scripts/qwen_agent.py`。
- 系統隔離設定：`qwen.sb`；固定網站轉接程式：`scripts/qwen_relay.py`，其隔離設定為 `qwen-relay.sb`。
- 登入後自動啟動：`~/Library/LaunchAgents/local.drinks-mk2.qwen.plist` 及 `local.drinks-mk2.qwen-relay.plist`。
- 狀態：[網站服務狀態](https://drinks-mk2.rtx941031.workers.dev/api/semantic/status)，`llm.ready=true` 才代表 Qwen 已接通。
- 日誌：執行目錄下 `logs/qwen.log`、`qwen-error.log`、`qwen-relay.log`、`qwen-relay-error.log`。只寫啟動、連線及錯誤類型，不印原始對話、偏好、密碼或金鑰。

## 已加入的限制

1. Qwen 沒有檔案、終端機、瀏覽器或任意 HTTP 工具；只輸出 JSON 意圖與一句對話文字。模型輸出不交給 eval、exec 或 shell。
2. LaunchAgent 使用 macOS sandbox-exec。使用者目錄 `/Users` 內，只允許讀取 Qwen 執行目錄與必要的 Python 基礎執行環境；文件、桌面、下載、瀏覽器使用者資料、SSH 金鑰等其他使用者檔案不在允許範圍。
3. Qwen 只能寫入自己的 logs/cache/tmp；不能覆寫模型、程式、隔離設定、資料庫檔案或金鑰。禁止建立子程序、啟動其他執行檔及對外監聽。
4. Qwen 的網路出口只允許本機 `127.0.0.1:52791`。這是固定轉接到 `drinks-mk2.rtx941031.workers.dev:443` 的程式，驗證 TLS ClientHello 的 SNI 必須為本站，不能改指其他網域；只在 loopback 監聽，不對外網開放。TLS 從 Qwen 到 Worker，保留主機名稱與憑證驗證；轉接程式不解密對話。
5. Qwen 使用獨立 `LLM_KEY`，只允許 `role=llm` 的模型連線，不能使用 MacBERT 角色或 `/api/training/events` 匯出。舊廣泛權限金鑰副本已從 Qwen 執行目錄移除。金鑰檔案權限 600、執行目錄 700；不放 GitHub。
6. 模型固定本機來源、`trust_remote_code=False`，設定 Hugging Face offline 與停用 telemetry。收到的文字、歷史、偏好及模型 JSON 都有長度／格式限制。未知配料先追問，不能假裝已排除。

## 驗證与界線

以無個資的測試檔確認文件讀取被拒絕；shell、其他外連、建立監聽埠被拒絕。使用 Qwen 金鑰呼叫訓練匯出及 MacBERT 角色均為 401；合法 LLM 角色通過驗證後，沒有 WebSocket upgrade 則為 426。可執行 `python3 scripts/verify_qwen_security.py` 重做無個資的檔案／寫入／shell／外連／監聽及 TLS 網域拒絕測試；角色金鑰的精確 HTTP 狀態由 Node 整合測試驗證。實際推論仍需另外確認 `llm.ready` 與對話結果，不能只看隔離測試。

這不是虛擬機，也不是零風險保證。macOS 的 sandbox-exec 已由系統手冊標示 deprecated，將來 OS 更新可能影響相容性；安裝程式不會在隔離失敗時自動改成無隔離執行。作業系統漏洞、帳號遭入侵或使用者自行修改服務設定，不在這些防護可保證的範圍。系統目錄仍按 macOS 原有權限讀取，非完全隱藏整台電腦。

對話先到你自己的 Cloudflare 網站，既有推薦紀錄仍存入 D1，登入團隊後台可查看；Mac 收到對話與飲料偏好摘要。這不是所有資料完全不離開本機的架構。前端不應輸入與推薦無關的密碼或私人檔案內容。

更新或重裝：在專案執行 `python3 scripts/install_qwen_service.py`；新增服務金鑰須先透過 Wrangler 設定 Cloudflare `LLM_KEY`。不要把金鑰貼到網站或傳給模型。

TLS 主機名稱格式依 [RFC 6066 第 3 節](https://www.rfc-editor.org/rfc/rfc6066#section-3)；未知、無 SNI 或不完整握手拒絕轉送。現有 Python／OpenSSL 的正式連線已另行驗證。
