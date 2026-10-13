"""Train the pinned official RelGT on a masked-price catalog smoke task.

This is NOT a consumer preference model or a production publishing command.
No account data, recommendation traces, secrets, or network APIs are read.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import platform
import random
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = "19e423ca3e7cac761130aba790857f2dc3a46ef7"
TZ = ZoneInfo("Asia/Taipei")


def now():
    return datetime.now(TZ).isoformat(timespec="seconds")


def run(args, report, out):
    import numpy as np
    import pandas as pd
    import torch
    import torch_frame
    from torch_frame.data import Dataset

    sys.path.insert(0, str(ROOT / "training/vendor/relgt"))
    from model import RelGT

    torch.set_num_threads(4)
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device(args.device)
    if args.device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS is not available; rerun explicitly with --device cpu")
    report["environment"] = {
        "python": platform.python_version(), "machine": platform.machine(),
        "device": str(device), "mps_available": torch.backends.mps.is_available(),
        "packages": {n: importlib.metadata.version(n) for n in
                     ["torch", "torch-geometric", "pytorch-frame", "einops"]},
    }
    raw = (ROOT / "data/catalog.json").read_bytes()
    drinks = json.loads(raw)["drinks"]
    # Group all variants of the same brand/name into the same split.
    split = {"train": [], "validation": [], "test": []}
    for i, d in enumerate(drinks):
        group = d["brand"] + "\0" + "".join(d["name"].split())
        bucket = int(hashlib.sha256((str(args.seed) + group).encode()).hexdigest()[:8], 16) % 100
        split["train" if bucket < 70 else "validation" if bucket < 85 else "test"].append(i)
    for ids in split.values():
        if len(ids) < 2:
            raise ValueError("Each split needs at least two catalog rows")
    report["data"] = {
        "catalog_sha256": hashlib.sha256(raw).hexdigest(), "drinks": len(drinks),
        "split_rows": {k: len(v) for k, v in split.items()},
        "split_method": "seeded SHA256 of brand + whitespace-normalized name; 70/15/15",
        "user_events": 0, "price_missing": sum(d["price"] is None for d in drinks),
        "excluded_inputs": ["price", "priceText", "name", "notes", "taste", "category", "user data"],
    }
    if report["data"]["price_missing"]:
        raise ValueError("Missing price labels require explicit filtering before this experiment")
    node_types = {name: i for i, name in enumerate(["drink", "brand", "tea", "milk", "toppings"])}
    tables = {}
    for kind in node_types:
        if kind == "drink":
            tables[kind] = pd.DataFrame({
                "no_milk": [float(d["noMilk"]) for d in drinks],
                "richness": [float(d["richness"]) for d in drinks],
            })
        else:
            tables[kind] = pd.DataFrame({"value": [
                d[kind] if kind == "brand" else "|".join(sorted(d[kind])) or "NONE"
                for d in drinks
            ]})
    # Statistics and categorical vocabularies see training rows ONLY.
    frames, stats, cols = {}, {}, {}
    for kind, table in tables.items():
        types = {c: torch_frame.numerical if kind == "drink" else torch_frame.categorical
                 for c in table.columns}
        ds = Dataset(table.iloc[split["train"]].reset_index(drop=True), col_to_stype=types).materialize()
        frames[kind] = ds.convert_to_tensor_frame(table)
        stats[kind], cols[kind] = ds.col_stats, ds.tensor_frame.col_names_dict
    # Each row is a sampled typed star: drink -> brand/tea/milk/toppings.
    # Static catalog has no event timestamps: time=0 is explicitly static.
    config = dict(num_nodes=len(drinks), max_neighbor_hop=1,
                  node_type_map=node_types, col_names_dict=cols, col_stats_dict=stats,
                  local_num_layers=1, channels=32, out_channels=1, global_dim=32,
                  heads=4, ff_dropout=0.0, attn_dropout=0.0, conv_type="full",
                  gnn_pe_dim=0, num_centroids=8, sample_node_len=5)
    model = RelGT(**config).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.learning_rate)
    prices = torch.tensor([d["price"] for d in drinks], dtype=torch.float32, device=device)
    train_ids = torch.tensor(split["train"], device=device)
    target_mean = prices[train_ids].mean()
    target_std = prices[train_ids].std().clamp_min(1)
    targets = (prices - target_mean) / target_std
    report["parameters"] = {
        "epochs": args.epochs, "batch_size": args.batch_size, "seed": args.seed,
        "learning_rate": args.learning_rate, "optimizer": "Adam", "loss": "MSE of training-standardized price",
        "channels": 32, "heads": 4, "local_layers": 1, "centroids": 8,
        "conv_type": "full", "sample_tokens": 5,
        "trainable_parameters": sum(p.numel() for p in model.parameters()),
        "starting_checkpoint": None,
    }

    def forward(ids):
        b, k = len(ids), 5
        types = torch.arange(k, device=device).repeat(b, 1)
        hops = torch.tensor([0, 1, 1, 1, 1], device=device).repeat(b, 1)
        grouped = {
            "grouped_tfs": {t: frames[name][ids] for name, t in node_types.items()},
            "grouped_indices": {t: [i*k+t for i in range(b)] for t in range(k)},
            "flat_batch_idx": [i for i in range(b) for _ in range(k)],
            "flat_nbr_idx": list(range(k))*b,
        }
        edges = [(i*k, i*k+j) for i in range(b) for j in range(1, k)]
        edges += [(v, u) for u, v in edges]
        edge_index = torch.tensor(edges, device=device).t().contiguous()
        batch = torch.arange(b, device=device).repeat_interleave(k)
        return model(types, torch.tensor(ids, device=device), hops,
                     torch.zeros(b, k, device=device), grouped, edge_index, batch).reshape(-1)

    def batches(ids):
        chunks = [ids[i:i+args.batch_size] for i in range(0, len(ids), args.batch_size)]
        # Upstream local readout squeezes singleton batches, and BN needs >1.
        if len(chunks) > 1 and len(chunks[-1]) == 1:
            chunks[-2].extend(chunks.pop())
        return chunks

    def evaluate(ids):
        model.eval()
        # Upstream structural encoder uses random features even during eval.
        # Restore RNG after fixed-seed evaluation so comparison is reproducible.
        with torch.random.fork_rng(devices=[]):
            torch.manual_seed(args.seed + 1)
            preds = []
            with torch.no_grad():
                for chunk in batches(ids):
                    preds.append(forward(chunk) * target_std + target_mean)
            pred = torch.cat(preds)
            truth = prices[torch.tensor(ids, device=device)]
            return {"mae_ntd": float((pred-truth).abs().mean()),
                    "rmse_ntd": float((pred-truth).square().mean().sqrt())}

    baseline = {}
    for key in ["validation", "test"]:
        truth = prices[torch.tensor(split[key], device=device)]
        baseline[key] = {"mae_ntd": float((truth-target_mean).abs().mean()),
                         "rmse_ntd": float((truth-target_mean).square().mean().sqrt())}
    report["baseline_train_mean"] = baseline
    report["before_training_validation"] = evaluate(split["validation"])
    history, best = [], math.inf
    for epoch in range(1, args.epochs + 1):
        model.train()
        order = split["train"].copy()
        random.shuffle(order)
        total = 0.0
        for ids in batches(order):
            optimizer.zero_grad()
            pred = forward(ids)
            loss = (pred - targets[torch.tensor(ids, device=device)]).square().mean()
            if not torch.isfinite(loss):
                raise RuntimeError("Non-finite loss; abort without publishing")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total += float(loss.detach()) * len(ids)
        val = evaluate(split["validation"])
        item = {"epoch": epoch, "train_mse_standardized": total/len(order), "validation": val}
        history.append(item)
        report["history"] = history
        print(json.dumps(item, ensure_ascii=False), flush=True)
        if val["mae_ntd"] < best:
            best = val["mae_ntd"]
            torch.save({"model": model.state_dict(), "optimizer": optimizer.state_dict(),
                        "epoch": epoch, "seed": args.seed, "torch_rng": torch.get_rng_state(),
                        "python_rng": random.getstate(), "numpy_rng": np.random.get_state(),
                        "model_config": config, "split": split, "feature_tables": tables,
                        "target_mean": float(target_mean), "target_std": float(target_std),
                        "catalog_sha256": report["data"]["catalog_sha256"],
                        "upstream_commit": UPSTREAM}, out / "best.pt")
            report["best_epoch"] = epoch
    # Only load our own checkpoint; pickle-based checkpoints are not public inputs.
    checkpoint = torch.load(out / "best.pt", map_location=device, weights_only=False)
    model.load_state_dict(checkpoint["model"])
    report["best_validation"] = evaluate(split["validation"])
    report["heldout_test"] = evaluate(split["test"])
    fresh_model = RelGT(**checkpoint["model_config"]).to(device)
    fresh_model.load_state_dict(checkpoint["model"])
    model = fresh_model
    reloaded_test = evaluate(split["test"])
    if any(abs(reloaded_test[k] - report["heldout_test"][k]) > 1e-6
           for k in reloaded_test):
        raise RuntimeError("Fresh checkpoint reload changed held-out predictions")
    report["checkpoint_reload_verified"] = True
    report["checkpoint"] = str((out / "best.pt").relative_to(ROOT))
    report["checkpoint_sha256"] = hashlib.sha256((out / "best.pt").read_bytes()).hexdigest()
    report["status"] = "success"


def main():
    raise SystemExit("價格訓練已依使用者 2026-10-13 指示停用；RelGT 目標改為長期使用意圖。歷史程式僅保留追溯。")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--learning-rate", type=float, default=0.001)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", choices=["cpu", "mps"], default="cpu")
    args = parser.parse_args()
    if args.epochs < 1 or args.batch_size < 2 or args.learning_rate <= 0:
        parser.error("epochs >=1, batch-size >=2, learning-rate >0 required")
    started = time.perf_counter()
    run_id = datetime.now(TZ).strftime("%Y%m%dT%H%M%S") + "-catalog-smoke"
    out = ROOT / "training_artifacts" / run_id
    out.mkdir(parents=True, exist_ok=False)
    reports = ROOT / "docs/training-runs"
    reports.mkdir(parents=True, exist_ok=True)
    report = {"run_id": run_id, "started_at": now(), "status": "running",
              "task": "catalog masked-price regression; NOT user recommendation",
              "upstream_commit": UPSTREAM,
              "git_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "working_tree_dirty": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT)),
              "training_script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "published": False, "updated_users": 0,
              "changes": ["first official RelGT Mac CPU compatibility experiment", "static typed catalog graph adapter", "train-only statistics and group holdout", "checkpoint and per-run report"],
              "limitations": ["no real user events", "no time-based recommendation evaluation", "no production ranking integration", "MPS is unverified", "no nightly scheduler", "no checkpoint resume CLI yet"]}
    try:
        run(args, report, out)
    except Exception as exc:
        report["status"] = "failed"
        report["error"] = f"{type(exc).__name__}: {exc}"
        print(report["error"], file=sys.stderr)
    finally:
        report["ended_at"] = now()
        report["duration_seconds"] = round(time.perf_counter() - started, 3)
        json_path = reports / f"{run_id}.json"
        json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        md_path = reports / f"{run_id}.md"
        md_path.write_text(
            f"# RelGT 本機訓練驗證：{run_id}\n\n"
            "這次使用官方 RelGT 完整 local/global 層做飲料價格遮蔽回歸，"
            "不是用戶偏好訓練，也沒有更新線上模型。\n\n"
            f"開始：{report['started_at']}\n\n結束：{report['ended_at']}\n\n"
            f"狀態：{report['status']}；耗時：{report['duration_seconds']} 秒。\n\n"
            "完整實測、參數、每輪結果與限制如下（價格誤差單位為新台幣）：\n\n"
            "```json\n" + json.dumps(report, ensure_ascii=False, indent=2) + "\n```\n")
        with (ROOT / "daily.txt").open("a") as f:
            f.write(f"\n[{report['ended_at']}｜RelGT 本機訓練驗證 {run_id}]\n"
                    f"- 狀態：{report['status']}；實際耗時：{report['duration_seconds']} 秒。\n"
                    "- 任務：遮蔽價格、以靜態飲料關聯圖預測價格；未使用真實用戶事件。\n"
                    "- 本次新增：官方模型適配、訓練／驗證／測試切分、權重保存與每次報告。\n"
                    f"- 報告：{md_path.relative_to(ROOT)}；結構化紀錄：{json_path.relative_to(ROOT)}。\n"
                    "- 沒有發布雲端模型，沒有更新用戶榜單，也沒有啟用凌晨 04:00 排程。\n")
        print(f"REPORT={md_path}", flush=True)
    return 0 if report["status"] == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
