import { Router } from "express";

import { asyncHandler } from "../middlewares/async.js";
import { badRequest } from "../../domain/common/errors.js";
import {
  telemetryRingBuffer,
  type Metric,
  type TelemetryPoint,
  ALL_METRICS,
} from "../../infra/cache/telemetryRingBuffer.js";
import { eventBus, TOPIC_TELEMETRY_LIVE } from "../../infra/bus/eventBus.memory.js";

type Aggregation = "raw" | "avg" | "min" | "max" | "p95";

type IngestBatchRequest = {
  source: string;
  items: Array<Record<string, unknown>>;
};

const AGGS: Aggregation[] = ["raw", "avg", "min", "max", "p95"];
const METRIC_SET = new Set<string>(ALL_METRICS);
const PHYSICAL_RANGES: Record<Metric, [number, number]> = {
  disp: [0, 10],
  vib: [0, 20],
  temp: [-40, 100],
  hum: [0, 100],
  wind: [0, 80],
  strain: [0, 10_000],
  stress: [0, 500],
  settlement: [0, 20],
};

function isMetric(x: unknown): x is Metric {
  return typeof x === "string" && METRIC_SET.has(x);
}

function asFiniteNumber(x: unknown): number | null {
  if (typeof x !== "number") return null;
  if (!Number.isFinite(x)) return null;
  return x;
}

function asInt64(x: unknown): number | null {
  const n = asFiniteNumber(x);
  if (n === null || !Number.isInteger(n)) return null;
  return n;
}

function asQueryString(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const s = x.trim();
  return s.length === 0 ? null : s;
}

function parseIntParam(x: unknown): number | null {
  const s = asQueryString(x);
  if (!s || !/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

function isAgg(x: unknown): x is Aggregation {
  return typeof x === "string" && (AGGS as string[]).includes(x);
}

function withinPhysicalRange(metric: Metric, value: number): boolean {
  const [min, max] = PHYSICAL_RANGES[metric];
  return value >= min && value <= max;
}

function parseTelemetryPoint(raw: Record<string, unknown>, source: string): TelemetryPoint | null {
  const sensor_id = typeof raw.sensor_id === "string" ? raw.sensor_id : null;
  const element_id = typeof raw.element_id === "string" ? raw.element_id : null;
  const metric = isMetric(raw.metric) ? raw.metric : null;
  const ts_ms = asInt64(raw.ts_ms);
  const value = asFiniteNumber(raw.value);

  if (!sensor_id || !element_id || !metric || ts_ms === null || value === null) return null;

  let coord_local: [number, number, number] | undefined;
  if (Array.isArray(raw.coord_local) && raw.coord_local.length === 3) {
    const a = asFiniteNumber(raw.coord_local[0]);
    const b = asFiniteNumber(raw.coord_local[1]);
    const c = asFiniteNumber(raw.coord_local[2]);
    if (a !== null && b !== null && c !== null) coord_local = [a, b, c];
  }

  let quality: number | undefined;
  if (raw.quality !== undefined) {
    const q = asFiniteNumber(raw.quality);
    if (q !== null) quality = Math.max(0, Math.min(1, q));
  }

  return { sensor_id, element_id, metric, ts_ms, value, coord_local, quality, source };
}

function isSpike(point: TelemetryPoint): boolean {
  const latest = telemetryRingBuffer.latestValue(point.element_id, point.metric);
  if (!latest) return false;
  const diff = Math.abs(point.value - latest.value);
  switch (point.metric) {
    case "disp":
      return diff > 2.5;
    case "vib":
      return diff > 4.0;
    case "temp":
      return diff > 18;
    case "hum":
      return diff > 35;
    case "wind":
      return diff > 18;
    case "strain":
      return diff > 3500;
    case "stress":
      return diff > 120;
    case "settlement":
      return diff > 2.0;
  }
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx] ?? sorted[sorted.length - 1] ?? 0;
}

function aggregatePoints(points: TelemetryPoint[], agg: Aggregation, limit: number): Array<{ ts_ms: number; v: number }> {
  if (agg === "raw") return points.slice(-limit).map((p) => ({ ts_ms: p.ts_ms, v: p.value }));
  if (points.length === 0) return [];
  const bucketCount = Math.max(1, Math.min(limit, points.length));
  const bucketSize = Math.ceil(points.length / bucketCount);
  const out: Array<{ ts_ms: number; v: number }> = [];
  for (let start = 0; start < points.length; start += bucketSize) {
    const bucket = points.slice(start, start + bucketSize);
    const values = bucket.map((p) => p.value);
    let v = 0;
    if (agg === "avg") v = values.reduce((acc, value) => acc + value, 0) / values.length;
    if (agg === "min") v = Math.min(...values);
    if (agg === "max") v = Math.max(...values);
    if (agg === "p95") v = percentile95(values);
    out.push({ ts_ms: bucket[bucket.length - 1]?.ts_ms ?? bucket[0]!.ts_ms, v: Number(v.toFixed(6)) });
  }
  return out;
}

export function createTelemetryTargetRouter(): Router {
  const router = Router();

  router.post(
    "/telemetry/ingest",
    asyncHandler(async (req, res) => {
      const body = req.body as Partial<IngestBatchRequest>;
      if (!body || typeof body !== "object") throw badRequest("body is required");
      if (typeof body.source !== "string" || body.source.trim().length === 0) throw badRequest("source is required");
      if (!Array.isArray(body.items) || body.items.length === 0) throw badRequest("items must be a non-empty array");

      let accepted = 0;
      let dropped = 0;
      let filtered_outliers = 0;
      const latestPerSecond = new Map<string, TelemetryPoint>();

      for (const item of body.items) {
        if (!item || typeof item !== "object") {
          dropped += 1;
          continue;
        }
        const p = parseTelemetryPoint(item as Record<string, unknown>, body.source);
        if (!p) {
          dropped += 1;
          continue;
        }
        if ((p.quality ?? 1) < 0.15 || !withinPhysicalRange(p.metric, p.value) || isSpike(p)) {
          filtered_outliers += 1;
          continue;
        }
        telemetryRingBuffer.push(p);
        const t = Math.floor(p.ts_ms / 1000);
        const key = `${p.element_id}|${p.metric}|${t}`;
        const prev = latestPerSecond.get(key);
        if (!prev || p.ts_ms >= prev.ts_ms) latestPerSecond.set(key, p);
        accepted += 1;
      }

      for (const p of latestPerSecond.values()) {
        eventBus.publish(TOPIC_TELEMETRY_LIVE, {
          element_id: p.element_id,
          metric: p.metric,
          t: Math.floor(p.ts_ms / 1000),
          v: p.value,
        });
      }

      res.json({ accepted, dropped, filtered_outliers, server_ts_ms: Date.now() });
    })
  );

  router.get(
    "/telemetry/timeseries",
    asyncHandler(async (req, res) => {
      const element_id = asQueryString(req.query.element_id);
      if (!element_id) throw badRequest("element_id is required");

      const metricRaw = asQueryString(req.query.metric);
      if (!metricRaw || !isMetric(metricRaw)) throw badRequest(`metric must be one of ${ALL_METRICS.join(", ")}`);
      const metric: Metric = metricRaw;

      const from_ts_ms = parseIntParam(req.query.from_ts_ms);
      const to_ts_ms = parseIntParam(req.query.to_ts_ms);
      if (from_ts_ms === null || to_ts_ms === null) throw badRequest("from_ts_ms and to_ts_ms are required");
      if (from_ts_ms > to_ts_ms) throw badRequest("from_ts_ms must be <= to_ts_ms");

      const limitRaw = req.query.limit !== undefined ? parseIntParam(req.query.limit) : null;
      const limit = limitRaw ?? 1200;
      if (!Number.isFinite(limit) || limit < 1 || limit > 100000) throw badRequest("limit must be in [1, 100000]");

      const aggRaw = req.query.agg !== undefined ? asQueryString(req.query.agg) : null;
      const agg: Aggregation = (aggRaw && isAgg(aggRaw) ? aggRaw : "raw") as Aggregation;

      const points = telemetryRingBuffer.queryRange(element_id, metric, from_ts_ms, to_ts_ms, Math.max(limit, 5_000));
      const series = aggregatePoints(points, agg, limit);
      res.json({ element_id, metric, from_ts_ms, to_ts_ms, agg, series });
    })
  );

  return router;
}
