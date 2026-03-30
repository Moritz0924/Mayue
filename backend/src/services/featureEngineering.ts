import { telemetryRingBuffer, type Metric } from "../infra/cache/telemetryRingBuffer.js";

export const FEATURE_METRICS: Metric[] = ["disp", "vib", "temp", "hum", "wind", "strain", "stress", "settlement"];
export const FEATURE_STATS = ["last", "mean", "std", "min", "max", "p95", "slope", "delta"] as const;

export type FeatureVector = {
  element_id: string;
  generated_at_ts_ms: number;
  feature_names: string[];
  features_64: number[];
  history: number[][];
  latest_metrics: Partial<Record<Metric, number>>;
};

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx] ?? sorted[sorted.length - 1] ?? 0;
}

function stats(values: number[]): number[] {
  if (values.length === 0) return [0, 0, 0, 0, 0, 0, 0, 0];
  const n = values.length;
  const mean = values.reduce((acc, v) => acc + v, 0) / n;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const slope = n > 1 ? (values[n - 1]! - values[0]!) / (n - 1) : 0;
  return [
    values[n - 1] ?? 0,
    mean,
    Math.sqrt(variance),
    Math.min(...values),
    Math.max(...values),
    percentile95(values),
    slope,
    (values[n - 1] ?? 0) - (values[0] ?? 0),
  ];
}

function downsample(values: number[], size: number): number[] {
  if (values.length === 0) return Array.from({ length: size }, () => 0);
  if (values.length === size) return values;
  const out: number[] = [];
  for (let i = 0; i < size; i++) {
    const idx = Math.floor((i / size) * values.length);
    out.push(values[Math.min(values.length - 1, idx)] ?? 0);
  }
  return out;
}

export function buildFeatureVector(
  element_id: string,
  opts?: { window_ms?: number; history_steps?: number; step_ms?: number; now_ts_ms?: number }
): FeatureVector {
  const now_ts_ms = opts?.now_ts_ms ?? Date.now();
  const window_ms = opts?.window_ms ?? 30 * 60 * 1000;
  const history_steps = opts?.history_steps ?? 16;
  const step_ms = opts?.step_ms ?? 5 * 60 * 1000;

  const feature_names = FEATURE_METRICS.flatMap((metric) => FEATURE_STATS.map((stat) => `${metric}_${stat}`));
  const history: number[][] = [];
  const latest_metrics: Partial<Record<Metric, number>> = {};

  for (let step = history_steps - 1; step >= 0; step--) {
    const endTs = now_ts_ms - step * step_ms;
    const startTs = endTs - window_ms;
    const row: number[] = [];
    for (const metric of FEATURE_METRICS) {
      const series = telemetryRingBuffer.queryRange(element_id, metric, startTs, endTs, 2_000);
      const values = series.map((p) => p.value);
      if (step === 0 && values.length > 0) latest_metrics[metric] = values[values.length - 1];
      row.push(...stats(values));
    }
    history.push(row);
  }

  return {
    element_id,
    generated_at_ts_ms: now_ts_ms,
    feature_names,
    features_64: history[history.length - 1] ?? Array.from({ length: 64 }, () => 0),
    history,
    latest_metrics,
  };
}

export function buildVibrationSignal(element_id: string, opts?: { window_ms?: number; size?: number; now_ts_ms?: number }): number[] {
  const now_ts_ms = opts?.now_ts_ms ?? Date.now();
  const window_ms = opts?.window_ms ?? 5 * 60 * 1000;
  const size = opts?.size ?? 256;
  const points = telemetryRingBuffer.queryRange(element_id, "vib", now_ts_ms - window_ms, now_ts_ms, 2_000);
  const values = points.map((p) => p.value);
  return downsample(values, size);
}
