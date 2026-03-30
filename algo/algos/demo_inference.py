from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
import torch
import torch.nn as nn


torch.set_num_threads(1)
ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

METRICS = ["disp", "vib", "temp", "hum", "wind", "strain", "stress", "settlement"]
STATS = ["last", "mean", "std", "min", "max", "p95", "slope", "delta"]
FEATURE_INDEX = {f"{metric}_{stat}": i for i, (metric, stat) in enumerate((m, s) for m in METRICS for s in STATS)}


class DisplacementLSTM(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.lstm = nn.LSTM(input_size=64, hidden_size=128, num_layers=2, batch_first=True, dropout=0.1)
        self.head = nn.Sequential(
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.lstm(x)
        y = self.head(out[:, -1, :])
        return y.squeeze(-1)


class VibrationCNN(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv1d(1, 16, kernel_size=5, padding=2),
            nn.ReLU(),
            nn.MaxPool1d(2),
            nn.Conv1d(16, 32, kernel_size=5, padding=2),
            nn.ReLU(),
            nn.MaxPool1d(2),
            nn.Conv1d(32, 64, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.AdaptiveAvgPool1d(16),
            nn.Flatten(),
            nn.Linear(64 * 16, 64),
            nn.ReLU(),
            nn.Linear(64, 3),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def ensure_models() -> None:
    disp_model = MODEL_DIR / "displacement_lstm.pt"
    vib_model = MODEL_DIR / "vibration_cnn.pt"
    if disp_model.exists() and vib_model.exists():
        return
    train_script = ROOT / "algos" / "train_demo_models.py"
    try:
        subprocess.run([sys.executable, str(train_script)], cwd=str(ROOT), check=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError("failed to auto-train demo models") from exc


def load_displacement() -> Tuple[DisplacementLSTM, Dict[str, Any]]:
    ensure_models()
    bundle = torch.load(MODEL_DIR / "displacement_lstm.pt", map_location="cpu")
    model = DisplacementLSTM()
    model.load_state_dict(bundle["state_dict"])
    model.eval()
    return model, bundle


def load_vibration() -> Tuple[VibrationCNN, Dict[str, Any]]:
    ensure_models()
    bundle = torch.load(MODEL_DIR / "vibration_cnn.pt", map_location="cpu")
    model = VibrationCNN()
    model.load_state_dict(bundle["state_dict"])
    model.eval()
    return model, bundle


def as_feature_history(payload: Dict[str, Any], seq_len: int) -> np.ndarray:
    history = payload.get("history")
    features = payload.get("features_64")
    if history is not None:
        arr = np.asarray(history, dtype=np.float32)
        if arr.ndim != 2 or arr.shape[1] != 64:
            raise ValueError("history must be an array shaped [T,64]")
    else:
        if features is None:
            raise ValueError("features_64 is required")
        arr = np.asarray(features, dtype=np.float32).reshape(1, 64)
        repeated = np.repeat(arr, seq_len, axis=0)
        trend = np.linspace(-0.015, 0.0, seq_len, dtype=np.float32).reshape(seq_len, 1)
        repeated[:, FEATURE_INDEX["disp_last"]] += trend[:, 0]
        repeated[:, FEATURE_INDEX["settlement_last"]] += np.linspace(-0.004, 0.0, seq_len)
        arr = repeated
    if arr.shape[0] < seq_len:
        pad = np.repeat(arr[:1], seq_len - arr.shape[0], axis=0)
        arr = np.concatenate([pad, arr], axis=0)
    return arr[-seq_len:]


def predict_displacement(payload: Dict[str, Any]) -> Dict[str, Any]:
    model, bundle = load_displacement()
    seq_len = int(bundle["seq_len"])
    history = as_feature_history(payload, seq_len)
    feat_mean = np.asarray(bundle["feature_mean"], dtype=np.float32)
    feat_std = np.asarray(bundle["feature_std"], dtype=np.float32)
    horizon = int(payload.get("horizon", 60))
    step_sec = int(payload.get("step_sec", 5))
    base_ts_ms = int(payload.get("base_ts_ms", payload.get("ts_ms", 0) or int(np.floor(__import__("time").time() * 1000))))

    current_disp = float(payload.get("current_disp", history[-1, FEATURE_INDEX["disp_last"]]))
    preds: List[Dict[str, float]] = []
    work_hist = history.copy()

    with torch.no_grad():
        for step in range(1, horizon + 1):
            normalized = (work_hist[-seq_len:] - feat_mean) / feat_std
            x = torch.tensor(normalized[None, ...], dtype=torch.float32)
            next_disp = float(model(x).item())
            drift = next_disp - current_disp
            current_disp = next_disp
            ts_ms = base_ts_ms + step * step_sec * 1000
            preds.append({"ts_ms": int(ts_ms), "disp": round(current_disp, 4)})

            next_row = work_hist[-1].copy()
            next_row[FEATURE_INDEX["disp_last"]] = current_disp
            next_row[FEATURE_INDEX["disp_mean"]] = 0.85 * next_row[FEATURE_INDEX["disp_mean"]] + 0.15 * current_disp
            next_row[FEATURE_INDEX["disp_std"]] = abs(drift) * 1.2 + 0.02 * next_row[FEATURE_INDEX["vib_mean"]]
            next_row[FEATURE_INDEX["disp_min"]] = min(next_row[FEATURE_INDEX["disp_min"]], current_disp)
            next_row[FEATURE_INDEX["disp_max"]] = max(next_row[FEATURE_INDEX["disp_max"]], current_disp)
            next_row[FEATURE_INDEX["disp_p95"]] = max(next_row[FEATURE_INDEX["disp_p95"]], current_disp * 0.98)
            next_row[FEATURE_INDEX["disp_slope"]] = drift / max(1, step_sec)
            next_row[FEATURE_INDEX["disp_delta"]] = current_disp - work_hist[max(0, len(work_hist) - 8), FEATURE_INDEX["disp_last"]]
            next_row[FEATURE_INDEX["strain_last"]] = current_disp * 760 + 2.4 * next_row[FEATURE_INDEX["wind_last"]]
            next_row[FEATURE_INDEX["stress_last"]] = current_disp * 110 + 0.8 * next_row[FEATURE_INDEX["wind_last"]]
            next_row[FEATURE_INDEX["settlement_last"]] = next_row[FEATURE_INDEX["settlement_last"]] + 0.0006
            work_hist = np.concatenate([work_hist, next_row[None, :]], axis=0)

    pred_values = np.array([p["disp"] for p in preds], dtype=np.float32)
    slope = float((pred_values[-1] - pred_values[0]) / max(1, len(pred_values))) if len(pred_values) > 1 else 0.0
    confidence = float(np.clip(0.76 + min(0.18, abs(slope) * 4), 0.76, 0.94))
    threshold_mm = float(payload.get("threshold_mm", 1.5))
    breach = next((p["ts_ms"] for p in preds if abs(p["disp"]) >= threshold_mm), None)
    return {
        "pred": preds,
        "confidence": round(confidence, 4),
        "trend_slope_mm_per_step": round(slope, 6),
        "threshold_mm": threshold_mm,
        "breach_ts_ms": breach,
        "model_version": "demo-lstm-64x128-v1",
    }


def dominant_frequency(signal: np.ndarray, fs_hz: float) -> float:
    centered = signal - signal.mean()
    spectrum = np.fft.rfft(centered)
    freqs = np.fft.rfftfreq(centered.size, d=1.0 / fs_hz)
    if freqs.size <= 1:
        return 0.0
    magnitudes = np.abs(spectrum[1:])
    if magnitudes.size == 0:
        return 0.0
    peak = float(np.max(magnitudes))
    if not np.isfinite(peak) or peak <= 1e-8:
        return 0.0
    idx = int(np.argmax(magnitudes) + 1)
    return float(freqs[idx])


def evaluate_vibration(payload: Dict[str, Any]) -> Dict[str, Any]:
    model, bundle = load_vibration()
    signal = np.asarray(payload.get("signal", []), dtype=np.float32)
    if signal.size == 0:
        raise ValueError("signal is required")
    target_len = int(bundle["signal_len"])
    if signal.size < target_len:
        signal = np.pad(signal, (0, target_len - signal.size), mode="edge")
    if signal.size > target_len:
        signal = signal[-target_len:]

    mean = float(bundle["signal_mean"])
    std = float(bundle["signal_std"])
    x = torch.tensor(((signal - mean) / std)[None, None, :], dtype=torch.float32)
    with torch.no_grad():
        logits = model(x)
        probs = torch.softmax(logits, dim=1).cpu().numpy()[0]
    label_map = bundle["label_map"]
    idx = int(np.argmax(probs))
    fs_hz = float(payload.get("fs_hz", 128.0))
    rms = float(np.sqrt(np.mean(signal**2)))
    dom_freq = dominant_frequency(signal, fs_hz)
    return {
        "label": label_map[idx],
        "prob": round(float(probs[idx]), 4),
        "probs": {label_map[i]: round(float(probs[i]), 4) for i in range(len(label_map))},
        "rms": round(rms, 5),
        "dominant_freq_hz": round(dom_freq, 3),
        "model_version": "demo-1dcnn-v1",
    }


def align_spatial(payload: Dict[str, Any]) -> Dict[str, Any]:
    pairs = payload.get("pairs")
    if not isinstance(pairs, list) or len(pairs) < 3:
        raise ValueError("pairs must contain at least 3 point pairs")
    local = np.asarray([p["coord_local"] for p in pairs], dtype=np.float64)
    bim = np.asarray([p["coord_bim"] for p in pairs], dtype=np.float64)
    if local.shape != bim.shape or local.shape[1] != 3:
        raise ValueError("coord_local and coord_bim must be Nx3")
    centroid_local = local.mean(axis=0)
    centroid_bim = bim.mean(axis=0)
    aa = local - centroid_local
    bb = bim - centroid_bim
    h = aa.T @ bb
    u, _s, vt = np.linalg.svd(h)
    r = vt.T @ u.T
    if np.linalg.det(r) < 0:
        vt[-1, :] *= -1
        r = vt.T @ u.T
    t = centroid_bim - r @ centroid_local
    transformed = (r @ local.T).T + t
    rmse = np.sqrt(np.mean(np.sum((transformed - bim) ** 2, axis=1)))
    return {
        "R": [[round(float(v), 8) for v in row] for row in r.tolist()],
        "t": [round(float(v), 8) for v in t.tolist()],
        "rmse_mm": round(float(rmse), 6),
    }


def align_temporal(payload: Dict[str, Any]) -> Dict[str, Any]:
    sensor_series = payload.get("sensor_series")
    bim_timeline = payload.get("bim_timeline")
    if not isinstance(sensor_series, list) or not isinstance(bim_timeline, list):
        raise ValueError("sensor_series and bim_timeline are required")
    sensor = sorted(({"ts_ms": int(p["ts_ms"]), "v": float(p["v"])} for p in sensor_series), key=lambda x: x["ts_ms"])
    timeline = sorted(int(t) for t in bim_timeline)
    n, m = len(sensor), len(timeline)
    dp = np.full((n + 1, m + 1), np.inf, dtype=np.float64)
    dp[0, 0] = 0.0
    parent = np.empty((n + 1, m + 1, 2), dtype=np.int64)
    parent[:] = -1
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = abs(sensor[i - 1]["ts_ms"] - timeline[j - 1])
            options = [dp[i - 1, j], dp[i, j - 1], dp[i - 1, j - 1]]
            move = int(np.argmin(options))
            if move == 0:
                prev = (i - 1, j)
            elif move == 1:
                prev = (i, j - 1)
            else:
                prev = (i - 1, j - 1)
            dp[i, j] = cost + options[move]
            parent[i, j] = prev
    path: List[Tuple[int, int]] = []
    i, j = n, m
    while i > 0 and j > 0:
        path.append((i - 1, j - 1))
        pi, pj = parent[i, j]
        if pi < 0 or pj < 0:
            break
        i, j = int(pi), int(pj)
    path.reverse()
    aligned = []
    offsets = []
    for si, tj in path:
        offset = sensor[si]["ts_ms"] - timeline[tj]
        offsets.append(abs(offset))
        aligned.append(
            {
                "sensor_ts_ms": sensor[si]["ts_ms"],
                "bim_ts_ms": timeline[tj],
                "offset_ms": int(offset),
                "v": round(sensor[si]["v"], 6),
            }
        )
    max_offset = max(offsets) if offsets else 0
    return {
        "aligned": aligned,
        "path_len": len(aligned),
        "cost": round(float(dp[n, m]), 4),
        "max_offset_ms": int(max_offset),
        "method": "dtw",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("task", choices=["predict_displacement", "evaluate_vibration", "align_spatial", "align_temporal"])
    args = parser.parse_args()
    payload = json.load(sys.stdin)
    if args.task == "predict_displacement":
        result = predict_displacement(payload)
    elif args.task == "evaluate_vibration":
        result = evaluate_vibration(payload)
    elif args.task == "align_spatial":
        result = align_spatial(payload)
    else:
        result = align_temporal(payload)
    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
