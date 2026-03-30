import type { Point } from "../../core/baseline.js";
import { telemetryRingBuffer, type Metric } from "../../infra/cache/telemetryRingBuffer.js";

/**
 * MVP compatibility timeseries backed by the Target-layer in-memory telemetry cache.
 *
 * Policy (Step5):
 * - Read recent telemetry points from ring buffer
 * - Convert ts_ms -> t (seconds)
 * - Keep only the latest value per second (latest-per-second)
 * - Return the last `n` points ordered by t ascending
 *
 * NOTE: This keeps the legacy response shape stable for the existing frontend.
 */
export function generateTimeseries(elementId: string, metric: Metric = "disp", n = 120): Point[] {
  // Pull enough points to cover high-frequency sampling; ring buffer caps per key anyway.
  const raw = telemetryRingBuffer.latest(elementId, metric, 20_000);
  if (!raw || raw.length === 0) return [];

  // Sort to be robust against slightly out-of-order ingest.
  raw.sort((a, b) => a.ts_ms - b.ts_ms);

  const perSecond: Point[] = [];
  let curT: number | null = null;
  let curV = 0;

  for (const p of raw) {
    const t = Math.floor(p.ts_ms / 1000);
    if (curT === null) {
      curT = t;
      curV = p.value;
      continue;
    }
    if (t !== curT) {
      perSecond.push({ t: curT, v: curV });
      curT = t;
      curV = p.value;
    } else {
      // Same second: keep latest value
      curV = p.value;
    }
  }
  if (curT !== null) perSecond.push({ t: curT, v: curV });

  if (perSecond.length <= n) return perSecond;
  return perSecond.slice(perSecond.length - n);
}
