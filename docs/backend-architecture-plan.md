# Mayue Backend Engineering Plan (Node.js) — Review (No Code)

This document locks the backend engineering plan **without changing any code**.
It is aligned with the combined contract (MVP + Target) already frozen.

## 1. Scope & Principles
- Single contract source of truth: `mayue-api-spec-mvp+target-review.yaml` + `mayue-ws-spec-mvp+target.md`
- Phase 1: keep frontend stable (MVP compatibility)
- Later phases: progressively enable target-layer endpoints
- Architecture: monolith-first, microservice-ready; clean layering

## 2. Responsibility Domains
A) Twin Meta (models/elements/mapping)
B) Telemetry Ingest (batch, buffering, validation)
C) Telemetry Query (timeseries, aggregation, downsample)
D) Realtime Hub (WebSocket broadcast→subscribe, backpressure)
E) Intelligence Orchestrator (predict/evaluate/alerts; model-service integration)

## 3. Suggested Repository Layout (TypeScript)
```text
backend-node/
  src/
    app/
    api/
    domain/
    infra/
    contracts/
    obs/
    utils/
  test/
    contract/
    load/
  docs/
    ADR/
    runbook.md
  package.json
  tsconfig.json
  .env.example
  Dockerfile
```

### 3.1 Dependency Rules (Hard Guardrails)
- `api/*` depends on `domain/*` and DTO/schema only
- `domain/*` depends on abstractions (repo/client/bus), not concrete DB/FS
- `infra/*` contains concrete adapters: FS/DB/bus/model-service client
- `obs/*` is allowed everywhere, but must remain business-agnostic

## 4. Dataflow (Telemetry → UI)
1) Sensor/Simulator → `POST /api/telemetry/ingest` (batch)
2) Ingest validates, writes to window cache / TS store, publishes event on bus
3) Realtime hub subscribes bus, pushes to WS (adds `server_ts_ms`)
4) Query serves timeseries for dashboard and model inputs
5) Intelligence orchestrates model-service calls and writes alerts

## 5. Storage Strategy (Interface-first)
- Meta: Postgres (or JSON initially, behind repo interface)
- Timeseries: ring-buffer + file (early) → TimescaleDB/InfluxDB (target)
- Objects (BIM lite): local dir → S3/OSS (future)
- Alerts/tasks: Postgres

## 6. Observability (for proving KPIs)
- trace_id per request
- metrics: ingest accepted/s, dropped, queue length, WS push/s, query p95
- WS payload includes `server_ts_ms` for end-to-end latency measurement

## 7. Compatibility Rules
- MVP uses legacy timeseries timestamp `t` in **seconds**
- Target uses `ts_ms` in **milliseconds**
- Backend must provide conversion to keep frontend unchanged
