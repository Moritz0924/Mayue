from fastapi import FastAPI, WebSocket
from pydantic import BaseModel
import asyncio
import random
import sys
import time
from pathlib import Path
from fastapi import HTTPException
from app.core.model_store import list_models as _list_models
from app.core.model_store import list_elements as _list_elements

ROOT_DIR = Path(__file__).resolve().parents[2]
ALGO_DIR = ROOT_DIR / "algo"
sys.path.append(str(ALGO_DIR))

from algos.baseline import analyze_timeseries  # noqa: E402

app = FastAPI(title="Mayue Digital Twin Monitor (MVP)")

class AnalyzeReq(BaseModel):
    metric: str = "disp"
    horizon: int = 60


def generate_timeseries(element_id: str, metric: str = "disp", n: int = 120):
    now = int(time.time())
    rng = random.Random(f"{element_id}:{metric}")
    series = []
    v = 0.0
    for i in range(n):
        t = now - (n - i)
        v += rng.uniform(-0.02, 0.02)
        series.append({"t": t, "v": v})
    return series

@app.get("/api/models")
def list_models():
    return _list_models()

@app.get("/api/models/{model_id}/elements")
def list_elements(model_id: str):
    try:
        return _list_elements(model_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/elements/{element_id}/timeseries")
def get_timeseries(element_id: str, metric: str = "disp", n: int = 120):
    series = generate_timeseries(element_id, metric, n=n)
    return {"element_id": element_id, "metric": metric, "series": series}

@app.post("/api/elements/{element_id}/analyze")
def analyze(element_id: str, req: AnalyzeReq):
    series = generate_timeseries(element_id, req.metric, n=max(req.horizon, 1))
    result = analyze_timeseries(series)
    return {
        "element_id": element_id,
        "metric": req.metric,
        "risk": result.risk,
        "score": result.score,
        "note": result.note,
    }

@app.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await ws.accept()

    # MVP：固定推 demo_001 的构件；后续可改成从前端传 model_id
    elements = _list_elements("demo_001")
    ids = [e["element_id"] for e in elements] or ["E1001"]

    while True:
        msg = {
            "element_id": random.choice(ids),
            "metric": "disp",
            "t": int(time.time()),
            "v": random.uniform(-2.0, 2.0),
        }
        await ws.send_json(msg)
        await asyncio.sleep(1.0)
