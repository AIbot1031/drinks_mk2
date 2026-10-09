# RelGT 本機訓練驗證操作

這個入口用官方 RelGT 模型，在飲料目錄上訓練「遮蔽價格回歸」。它用來確認 Mac 能完成前向、反向、驗證與權重保存；不是正式消費者偏好模型，也不會發布 Cloudflare 或啟用排程。

## 安裝與執行

使用 Python 3.12，將環境留在獨立的 `.venv-training`，不修改網站或系統 Python：

```sh
python3.12 -m venv .venv-training
.venv-training/bin/python -m pip install -r training/requirements-lock.txt
.venv-training/bin/python scripts/train_relgt_smoke.py --device cpu --epochs 10
```

本次採 CPU；MPS 尚未驗證，不能依 Apple Silicon 機型就推定所有 PyG 操作可在 MPS 執行。首次安裝需下載 PyTorch 等套件；之後同環境可直接執行最後一行。參數包含 `--seed`、`--batch-size` 與 `--learning-rate`。

## 資料與模型

- 讀取專案 `data/catalog.json`，不連線讀取用戶帳號、收藏或推薦文字。
- 價格是預測標籤；所有節點輸入都移除價格與價格文字。品名、備註、風味文字與分類也不輸入，避免文字夾帶價格。
- 品牌、茶種、奶類、配料形成具型別的靜態星狀圖。每個飲料取 5 個 token（飲料本身及 4 類關聯），時間設為 0，沒有假造互動時間。
- 依品牌＋去空白品名的 SHA256 固定分為約 70% 訓練、15% 驗證、15% 測試，同名變體不跨組。
- 只用訓練組估計特徵統計、類別字典及價格標準化。沒有做推薦任務的時間切分，不能將價格 MAE 當成推薦品質。
- `training/vendor/relgt/` 的官方模型原樣使用，固定提交及 MIT 授權見該目錄。使用完整 local/global attention、5 種編碼、8 個 centroid、32 channels、4 heads、1 層 local attention。
- 使用 Adam、標準化價格 MSE 與梯度裁切。驗證 MAE 最低的版本保存為 best checkpoint；最後才查看保留測試組，並檢查重新建立模型／載入權重後結果一致。
- 官方結構編碼在評估時仍使用隨機特徵；CPU 評估固定種子並恢復 RNG，以便比較。

## 每次輸出

- `docs/training-runs/<run-id>.md`：團隊可讀的實際訓練報告。
- `docs/training-runs/<run-id>.json`：參數、時間、每輪 loss、驗證／測試誤差與限制。
- `training_artifacts/<run-id>/best.pt`：模型、optimizer、隨機狀態、切分、特徵表與資料雜湊；不提交 GitHub。
- `daily.txt`：成功或失敗摘要，自動追加台灣日期時間及報告位置。

只有自己產生的 checkpoint 可以使用這個載入流程，不以未驗證的外部 pickle 檔作為輸入。現在可從頭再次訓練；尚未提供載入 checkpoint 繼續訓練的 CLI。

## 如何讀結果

MAE／RMSE 的單位是新台幣，數值愈低代表這項價格預測誤差愈小。報告會同時列出「永遠預測訓練組平均價格」基線與訓練前結果。若模型未勝過基線，要如實保留結果，不發布成新推薦版本。

後續仍需真實互動事件、偏好標籤、推薦任務、時間驗證、雲端版本切換與續訓流程，才適合接上每天 04:00 的排程。這個驗證程式沒有更新任何用戶的榜單。
