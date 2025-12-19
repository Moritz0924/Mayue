from fastapi import FastAPI, WebSocket
from pydantic import BaseModel
import asyncio
import random
import time

app = FastAPI(title="Mayue Digital Twin Monitor (MVP)")

class AnalyzeReq(BaseModel):
    metric: str = "disp"
    horizon: int = 60

@app.get("/api/models")
def list_models():
    return [{"model_id": "demo_001", "name": "Demo Building"}]

@app.get("/api/models/{model_id}/elements")
def list_elements(model_id: str):
    return [
        {"element_id": "E1001", "name": "Column-1F-A"},
        {"element_id": "E1002", "name": "Beam-1F-01"},
    ]

@app.get("/api/elements/{element_id}/timeseries")
def get_timeseries(element_id: str, metric: str = "disp", n: int = 120):
    now = int(time.time())
    series = []
    v = 0.0
    for i in range(n):
        t = now - (n - i)
        v += random.uniform(-0.02, 0.02)
        series.append({"t": t, "v": v})
    return {"element_id": element_id, "metric": metric, "series": series}

@app.post("/api/elements/{element_id}/analyze")
def analyze(element_id: str, req: AnalyzeReq):
    # MVP: baseline 占位（后续接 algo 模块）
    risk = random.choice(["LOW", "MEDIUM", "HIGH"])
    return {"element_id": element_id, "metric": req.metric, "risk": risk, "note": "baseline"}

@app.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await ws.accept()
    while True:
        msg = {
            "element_id": random.choice(["E1001", "E1002"]),
            "metric": "disp",
            "t": int(time.time()),
            "v": random.uniform(-2.0, 2.0),
        }
        await ws.send_json(msg)
        await asyncio.sleep(1.0)
