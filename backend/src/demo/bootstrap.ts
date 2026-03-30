import { recordAlert } from "../domain/alerts.js";
import { telemetryRingBuffer, type Metric } from "../infra/cache/telemetryRingBuffer.js";
import { loadSensorLayout, loadTwinScene, type SensorLayoutItem, type TwinScene } from "./repository.js";

const METRICS: Metric[] = ["disp", "vib", "temp", "hum", "wind", "strain", "stress", "settlement"];
let bootstrapped = false;

const ANOMALY_BIAS: Record<string, number> = {
  E1002: 0.22,
  E1008: 0.45,
};

function hashCode(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function elementBase(elementId: string): number {
  return (hashCode(elementId) % 100) / 1000;
}

function sensorOf(layout: SensorLayoutItem[], elementId: string, metric: Metric): SensorLayoutItem | undefined {
  return layout.find((item) => item.element_id === elementId && (item.type === metric || metric === "temp"));
}

function makeValue(metric: Metric, t: number, elIndex: number, anomaly: number, rng: () => number): number {
  const phase = t / 9 + elIndex * 0.7;
  const noise = (rng() - 0.5) * 0.05;
  switch (metric) {
    case "disp":
      return 0.18 + elementBase(`disp-${elIndex}`) + Math.sin(phase / 3) * 0.08 + anomaly * (0.4 + t / 1800) + noise;
    case "vib":
      return 0.22 + Math.abs(Math.sin(phase)) * 0.18 + anomaly * 0.8 + noise * 2;
    case "temp":
      return 24 + Math.sin(phase / 12) * 4 + elIndex * 0.15 + noise * 8;
    case "hum":
      return 58 + Math.cos(phase / 10) * 8 + noise * 30;
    case "wind":
      return 6 + Math.abs(Math.sin(phase / 2)) * 4 + anomaly * 1.6 + noise * 20;
    case "strain":
      return 110 + Math.sin(phase / 3) * 24 + anomaly * 38 + noise * 60;
    case "stress":
      return 16 + Math.sin(phase / 4) * 4 + anomaly * 12 + noise * 15;
    case "settlement":
      return 0.08 + t * 0.00006 + anomaly * 0.06 + noise * 0.1;
    default:
      return noise;
  }
}

function clampMetric(metric: Metric, value: number): number {
  switch (metric) {
    case "disp":
      return Number(Math.max(0, value).toFixed(4));
    case "vib":
      return Number(Math.max(0.01, value).toFixed(4));
    case "temp":
      return Number(Math.min(45, Math.max(-10, value)).toFixed(3));
    case "hum":
      return Number(Math.min(95, Math.max(20, value)).toFixed(3));
    case "wind":
      return Number(Math.min(35, Math.max(0, value)).toFixed(3));
    case "strain":
      return Number(Math.max(0, value).toFixed(3));
    case "stress":
      return Number(Math.max(0, value).toFixed(3));
    case "settlement":
      return Number(Math.max(0, value).toFixed(4));
  }
}

export async function bootstrapDemoData(): Promise<void> {
  if (bootstrapped) return;
  const scene: TwinScene = await loadTwinScene();
  const layout = await loadSensorLayout();
  telemetryRingBuffer.clear();

  const now = Date.now();
  const sampleCount = 720; // 2 hours @ 10s cadence
  const stepMs = 10_000;

  scene.elements.forEach((element, index) => {
    const anomaly = ANOMALY_BIAS[element.element_id] ?? 0;
    const rng = makeRng(hashCode(element.element_id));
    for (let i = sampleCount - 1; i >= 0; i--) {
      const t = sampleCount - 1 - i;
      const ts_ms = now - i * stepMs;
      for (const metric of METRICS) {
        const sensor = sensorOf(layout, element.element_id, metric);
        const value = clampMetric(metric, makeValue(metric, t, index, anomaly, rng));
        telemetryRingBuffer.push({
          sensor_id: sensor?.sensor_id ?? `${element.element_id}-${metric}`,
          element_id: element.element_id,
          metric,
          ts_ms,
          value,
          coord_local: sensor?.coord_local,
          quality: metric === "disp" || metric === "vib" ? 0.97 : 0.93,
          source: "demo-bootstrap",
        });
      }
    }
  });

  recordAlert({
    element_id: "E1008",
    level: "L2",
    metric: "disp",
    trigger_ts_ms: now - 25_000,
    note: "顶部构件位移趋势持续抬升",
  });
  recordAlert({
    element_id: "E1002",
    level: "L1",
    metric: "vib",
    trigger_ts_ms: now - 12_000,
    note: "南向巨柱振动包络升高",
  });

  bootstrapped = true;
}
