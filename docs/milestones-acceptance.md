# Milestones & Acceptance (MVP + Target) — Review (No Code)

This checklist provides phase-by-phase acceptance tests aligned to the frozen contract.

## Phase 0 — Contract Freeze
Artifacts:
- contracts/mayue-api-spec-mvp+target-review.yaml
- contracts/mayue-ws-spec-mvp+target.md
Acceptance:
- Field names, timestamp units, metric enums, risk levels are locked

## Phase 1 — Node Backend Replacement (MVP compatibility, no frontend change)
Must implement:
- GET /api/models
- GET /api/models/{model_id}/elements
- GET /api/elements/{element_id}/timeseries?metric=disp&n=120   (legacy `t` seconds)
- POST /api/elements/{element_id}/analyze
- WS /ws/live (broadcast)

Acceptance (curl):
```bash
curl -s http://localhost:8000/api/models | head
curl -s http://localhost:8000/api/models/demo_001/elements | head
curl -s "http://localhost:8000/api/elements/E1001/timeseries?metric=disp&n=5"
curl -s -X POST http://localhost:8000/api/elements/E1001/analyze   -H "Content-Type: application/json" -d '{"metric":"disp","horizon":60}'
```
WS:
- connect ws://localhost:8000/ws/live
- receive {element_id, metric, t, v} continuously within 10s

Non-functional minimum:
- trace_id in responses or error body
- request logs: path/status/latency_ms

## Phase 2 — Real Telemetry Ingest + Query
Enable:
- POST /api/telemetry/ingest (batch)
- GET /api/telemetry/timeseries (ts_ms)

Acceptance:
```bash
curl -s -X POST http://localhost:8000/api/telemetry/ingest   -H "Content-Type: application/json"   -d '{
    "source":"sim-01",
    "items":[
      {"sensor_id":"S1","element_id":"E1001","metric":"disp","ts_ms":1700000000123,"value":1.0},
      {"sensor_id":"S1","element_id":"E1001","metric":"disp","ts_ms":1700000001123,"value":1.2}
    ]
  }'

curl -s "http://localhost:8000/api/telemetry/timeseries?element_id=E1001&metric=disp&from_ts_ms=1699999999000&to_ts_ms=1700000002000&limit=10&agg=raw"
```

Throughput KPI measurement plan:
- measure accepted/s and p95 latency with a load tool (autocannon/k6)

## Phase 3 — Subscription WS + Alerts Observability
Enable:
- WS /ws/stream subscribe protocol
- GET /api/alerts/recent
- alerts include trigger_ts_ms & emit_ts_ms
Acceptance:
- subscribe filters stream correctly
- alerts endpoint returns recent alerts
- latency computed as emit_ts_ms - trigger_ts_ms

## Phase 4 — Model Orchestration (LSTM/1D-CNN)
Enable:
- POST /api/predict/displacement (features_64, model_version)
- POST /api/evaluate/vibration (prob, model_version)
Acceptance:
- valid inputs return confidence/prob in [0,1]
- model-service down returns MODEL_SERVICE_UNAVAILABLE consistently

## Phase 5 — External Integration
Enable:
- GET /api/integration/export/alerts
(Optional) POST /api/integration/import/workorders
Acceptance:
- external polling works, auth enabled without breaking internal UI
