from __future__ import annotations
import json
from pathlib import Path
from typing import Dict, Any, List

# backend/app/core/model_store.py
REPO_ROOT = Path(__file__).resolve().parents[3]          # .../Mayue
MODEL_DIR = REPO_ROOT / "backend" / "data" / "models"    # .../Mayue/backend/data/models

def list_models() -> List[dict]:
    if not MODEL_DIR.exists():
        return []
    return [{"model_id": p.name, "name": p.name} for p in MODEL_DIR.iterdir() if p.is_dir()]

def load_map(model_id: str) -> Dict[str, Any]:
    p = MODEL_DIR / model_id / "building_lite.map.json"
    if not p.exists():
        raise FileNotFoundError(f"map.json not found: {p}")
    text = p.read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError(f"map.json is empty: {p}")
    return json.loads(text)

def list_elements(model_id: str) -> List[dict]:
    m = load_map(model_id)
    elems = m.get("elements", [])
    # 最小清洗：确保字段存在
    out = []
    for e in elems:
        out.append({
            "element_id": str(e.get("element_id", "")),
            "name": str(e.get("name", "")),
        })
    return out
