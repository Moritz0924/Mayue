from __future__ import annotations

import json
import math
import random
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim


torch.set_num_threads(1)
SEED = 2026
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

METRICS = ["disp", "vib", "temp", "hum", "wind", "strain", "stress", "settlement"]
STATS = ["last", "mean", "std", "min", "max", "p95", "slope", "delta"]
FEATURE_NAMES = [f"{metric}_{stat}" for metric in METRICS for stat in STATS]
SEQ_LEN = 16
SIGNAL_LEN = 256


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


def rolling_stats(values: np.ndarray) -> List[float]:
    values = np.asarray(values, dtype=np.float32)
    if values.size == 0:
        return [0.0] * len(STATS)
    slope = 0.0
    if values.size > 1:
        slope = float((values[-1] - values[0]) / max(1, values.size - 1))
    return [
        float(values[-1]),
        float(values.mean()),
        float(values.std()),
        float(values.min()),
        float(values.max()),
        float(np.percentile(values, 95)),
        slope,
        float(values[-1] - values[0]),
    ]


class SyntheticTwinGenerator:
    def __init__(self, anomaly: bool = False) -> None:
        self.anomaly = anomaly
        self.reset()

    def reset(self) -> None:
        self.disp = np.random.normal(0.12, 0.01)
        self.vib = np.random.normal(0.18, 0.03)
        self.temp = np.random.normal(24.0, 1.5)
        self.hum = np.random.normal(58.0, 3.0)
        self.wind = np.random.normal(6.0, 1.0)
        self.strain = self.disp * 720 + np.random.normal(0, 2.0)
        self.stress = 12 + self.disp * 95 + np.random.normal(0, 1.5)
        self.settlement = np.random.normal(0.08, 0.01)
        self.hist: Dict[str, List[float]] = {m: [] for m in METRICS}
        for _ in range(SEQ_LEN + 1):
            self.step()

    def step(self) -> None:
        drift = 0.003 * self.wind + 0.002 * (self.temp - 24) + 0.005 * self.settlement
        noise = np.random.normal(0, 0.004)
        anomaly_boost = 0.015 if self.anomaly and random.random() < 0.28 else 0.0
        self.disp = max(0.0, self.disp + drift * 0.08 + noise + anomaly_boost)
        self.vib = max(0.02, 0.55 * self.vib + 0.12 * self.wind + np.random.normal(0, 0.04) + anomaly_boost * 8)
        self.temp = 0.96 * self.temp + 0.04 * (24 + np.random.normal(0, 4.5))
        self.hum = np.clip(0.96 * self.hum + 0.04 * (58 + np.random.normal(0, 9.0)), 30, 90)
        self.wind = max(0.1, 0.85 * self.wind + np.random.normal(0, 0.8) + (2.5 if self.anomaly and random.random() < 0.15 else 0.0))
        self.strain = 0.9 * self.strain + 0.1 * (self.disp * 760 + self.wind * 2.2 + np.random.normal(0, 2.5))
        self.stress = 0.88 * self.stress + 0.12 * (11 + self.disp * 104 + self.wind * 0.9 + np.random.normal(0, 2.0))
        self.settlement = max(0.0, self.settlement + np.random.normal(0.0004, 0.0002) + (0.0012 if self.anomaly else 0.0))

        snapshot = {
            "disp": self.disp,
            "vib": self.vib,
            "temp": self.temp,
            "hum": self.hum,
            "wind": self.wind,
            "strain": self.strain,
            "stress": self.stress,
            "settlement": self.settlement,
        }
        for key, value in snapshot.items():
            self.hist[key].append(float(value))
            if len(self.hist[key]) > 64:
                self.hist[key] = self.hist[key][-64:]

    def build_feature_row(self) -> np.ndarray:
        feats: List[float] = []
        for metric in METRICS:
            window = np.array(self.hist[metric][-12:], dtype=np.float32)
            feats.extend(rolling_stats(window))
        return np.array(feats, dtype=np.float32)

    def sample(self) -> Tuple[np.ndarray, float]:
        seq = []
        for _ in range(SEQ_LEN):
            seq.append(self.build_feature_row())
            self.step()
        target = float(self.disp)
        return np.stack(seq), target


def build_displacement_dataset(samples: int = 720) -> Tuple[np.ndarray, np.ndarray]:
    xs: List[np.ndarray] = []
    ys: List[float] = []
    for idx in range(samples):
        gen = SyntheticTwinGenerator(anomaly=idx % 4 == 0)
        seq, target = gen.sample()
        xs.append(seq)
        ys.append(target)
    x = np.stack(xs).astype(np.float32)
    y = np.array(ys, dtype=np.float32)
    return x, y


def train_displacement() -> Dict[str, float]:
    x, y = build_displacement_dataset()
    train_n = int(len(x) * 0.85)
    x_train, x_val = x[:train_n], x[train_n:]
    y_train, y_val = y[:train_n], y[train_n:]

    feat_mean = x_train.reshape(-1, 64).mean(axis=0)
    feat_std = x_train.reshape(-1, 64).std(axis=0) + 1e-6
    x_train = (x_train - feat_mean) / feat_std
    x_val = (x_val - feat_mean) / feat_std

    device = torch.device("cpu")
    model = DisplacementLSTM().to(device)
    optimizer = optim.Adam(model.parameters(), lr=1e-3)
    criterion = nn.MSELoss()

    batch_size = 64
    x_train_t = torch.tensor(x_train, dtype=torch.float32)
    y_train_t = torch.tensor(y_train, dtype=torch.float32)
    x_val_t = torch.tensor(x_val, dtype=torch.float32)
    y_val_t = torch.tensor(y_val, dtype=torch.float32)

    best_state = None
    best_rmse = float("inf")
    for _epoch in range(4):
        model.train()
        perm = torch.randperm(x_train_t.shape[0])
        for start in range(0, x_train_t.shape[0], batch_size):
            idx = perm[start : start + batch_size]
            xb = x_train_t[idx]
            yb = y_train_t[idx]
            pred = model(xb)
            loss = criterion(pred, yb)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
        model.eval()
        with torch.no_grad():
            val_pred = model(x_val_t)
            rmse = torch.sqrt(criterion(val_pred, y_val_t)).item()
        if rmse < best_rmse:
            best_rmse = rmse
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}

    assert best_state is not None
    torch.save(
        {
            "state_dict": best_state,
            "feature_mean": feat_mean.tolist(),
            "feature_std": feat_std.tolist(),
            "seq_len": SEQ_LEN,
            "feature_names": FEATURE_NAMES,
            "hidden_size": 128,
            "train_rmse": float(best_rmse),
        },
        MODEL_DIR / "displacement_lstm.pt",
    )
    return {"val_rmse": float(best_rmse)}


def make_signal(label: int) -> np.ndarray:
    t = np.linspace(0, 1, SIGNAL_LEN, endpoint=False)
    noise = np.random.normal(0, 0.03, size=SIGNAL_LEN)
    if label == 0:
        signal = 0.18 * np.sin(2 * math.pi * 8 * t) + 0.08 * np.sin(2 * math.pi * 16 * t) + noise
    elif label == 1:
        signal = 0.45 * np.sin(2 * math.pi * 12 * t) + 0.15 * np.sin(2 * math.pi * 26 * t)
        signal += 0.08 * np.sin(2 * math.pi * 42 * t) + noise * 1.6
        signal[::32] += np.random.normal(0.18, 0.05, size=signal[::32].shape)
    else:
        signal = 0.75 * np.sin(2 * math.pi * 14 * t) + 0.35 * np.sin(2 * math.pi * 36 * t)
        signal += 0.18 * np.sin(2 * math.pi * 72 * t) + noise * 2.2
        burst_idx = np.random.choice(np.arange(20, SIGNAL_LEN - 20), size=6, replace=False)
        signal[burst_idx] += np.random.uniform(0.8, 1.4, size=burst_idx.shape[0])
    return signal.astype(np.float32)


def build_vibration_dataset(samples_per_class: int = 220) -> Tuple[np.ndarray, np.ndarray]:
    xs: List[np.ndarray] = []
    ys: List[int] = []
    for label in range(3):
        for _ in range(samples_per_class):
            xs.append(make_signal(label))
            ys.append(label)
    x = np.stack(xs).astype(np.float32)
    y = np.array(ys, dtype=np.int64)
    idx = np.random.permutation(len(x))
    return x[idx], y[idx]


def train_vibration() -> Dict[str, float]:
    x, y = build_vibration_dataset()
    train_n = int(len(x) * 0.85)
    x_train, x_val = x[:train_n], x[train_n:]
    y_train, y_val = y[:train_n], y[train_n:]

    mean = x_train.mean()
    std = x_train.std() + 1e-6
    x_train = (x_train - mean) / std
    x_val = (x_val - mean) / std

    model = VibrationCNN()
    optimizer = optim.Adam(model.parameters(), lr=1e-3)
    criterion = nn.CrossEntropyLoss()

    batch_size = 64
    x_train_t = torch.tensor(x_train[:, None, :], dtype=torch.float32)
    y_train_t = torch.tensor(y_train, dtype=torch.long)
    x_val_t = torch.tensor(x_val[:, None, :], dtype=torch.float32)
    y_val_t = torch.tensor(y_val, dtype=torch.long)

    best_state = None
    best_acc = 0.0
    for _epoch in range(4):
        model.train()
        perm = torch.randperm(x_train_t.shape[0])
        for start in range(0, x_train_t.shape[0], batch_size):
            idx = perm[start : start + batch_size]
            xb = x_train_t[idx]
            yb = y_train_t[idx]
            logits = model(xb)
            loss = criterion(logits, yb)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
        model.eval()
        with torch.no_grad():
            pred = model(x_val_t).argmax(dim=1)
            acc = (pred == y_val_t).float().mean().item()
        if acc > best_acc:
            best_acc = acc
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}

    assert best_state is not None
    torch.save(
        {
            "state_dict": best_state,
            "signal_mean": float(mean),
            "signal_std": float(std),
            "signal_len": SIGNAL_LEN,
            "label_map": ["NORMAL", "WARNING", "DAMAGE_SUSPECTED"],
            "val_acc": float(best_acc),
        },
        MODEL_DIR / "vibration_cnn.pt",
    )
    return {"val_acc": float(best_acc)}


def main() -> None:
    disp_metrics = train_displacement()
    vib_metrics = train_vibration()
    summary = {
        "displacement": disp_metrics,
        "vibration": vib_metrics,
        "artifacts": [
            str(MODEL_DIR / "displacement_lstm.pt"),
            str(MODEL_DIR / "vibration_cnn.pt"),
        ],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
