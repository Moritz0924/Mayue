import { AppError } from "../../domain/common/errors.js";

export type Metric =
  | "disp"
  | "vib"
  | "temp"
  | "hum"
  | "wind"
  | "strain"
  | "stress"
  | "settlement";

export const ALL_METRICS: Metric[] = ["disp", "vib", "temp", "hum", "wind", "strain", "stress", "settlement"];

export type TelemetryPoint = {
  sensor_id: string;
  element_id: string;
  metric: Metric;
  ts_ms: number;
  value: number;
  coord_local?: [number, number, number];
  quality?: number;
  source?: string;
};

type Key = string;

export class TelemetryRingBuffer {
  private readonly capacityPerKey: number;
  private readonly buffers = new Map<Key, TelemetryPoint[]>();

  constructor(opts?: { capacityPerKey?: number }) {
    this.capacityPerKey = opts?.capacityPerKey ?? 20_000;
    if (!Number.isFinite(this.capacityPerKey) || this.capacityPerKey <= 0) {
      throw new AppError(400, "INVALID_ARGUMENT", "capacityPerKey must be a positive number");
    }
  }

  private keyOf(p: Pick<TelemetryPoint, "element_id" | "metric">): Key {
    return `${p.element_id}:${p.metric}`;
  }

  clear(): void {
    this.buffers.clear();
  }

  push(p: TelemetryPoint): void {
    const key = this.keyOf(p);
    let buf = this.buffers.get(key);
    if (!buf) {
      buf = [];
      this.buffers.set(key, buf);
    }
    buf.push(p);
    const overflow = buf.length - this.capacityPerKey;
    if (overflow > 0) buf.splice(0, overflow);
  }

  latest(element_id: string, metric: Metric, limit = 1200): TelemetryPoint[] {
    const key = `${element_id}:${metric}`;
    const buf = this.buffers.get(key);
    if (!buf) return [];
    const n = Math.max(0, Math.min(limit, buf.length));
    return buf.slice(buf.length - n);
  }

  latestValue(element_id: string, metric: Metric): TelemetryPoint | null {
    const buf = this.buffers.get(`${element_id}:${metric}`);
    if (!buf || buf.length === 0) return null;
    return buf[buf.length - 1] ?? null;
  }

  latestWindow(element_id: string, metric: Metric, windowMs: number, nowTsMs = Date.now()): TelemetryPoint[] {
    return this.queryRange(element_id, metric, nowTsMs - windowMs, nowTsMs, this.capacityPerKey);
  }

  queryRange(
    element_id: string,
    metric: Metric,
    from_ts_ms: number,
    to_ts_ms: number,
    limit = 1200
  ): TelemetryPoint[] {
    const key = `${element_id}:${metric}`;
    const buf = this.buffers.get(key);
    if (!buf || buf.length === 0) return [];

    const filtered = buf.filter((p) => p.ts_ms >= from_ts_ms && p.ts_ms <= to_ts_ms);
    if (filtered.length === 0) return [];

    filtered.sort((a, b) => a.ts_ms - b.ts_ms);
    if (filtered.length <= limit) return filtered;
    return filtered.slice(filtered.length - limit);
  }

  listElementIds(): string[] {
    const ids = new Set<string>();
    for (const key of this.buffers.keys()) {
      ids.add(key.split(":", 1)[0] ?? key);
    }
    return Array.from(ids.values()).sort();
  }

  latestSnapshot(element_id: string, metrics: Metric[] = ALL_METRICS): Partial<Record<Metric, TelemetryPoint>> {
    const out: Partial<Record<Metric, TelemetryPoint>> = {};
    for (const metric of metrics) {
      const latest = this.latestValue(element_id, metric);
      if (latest) out[metric] = latest;
    }
    return out;
  }
}

export const telemetryRingBuffer = new TelemetryRingBuffer();
