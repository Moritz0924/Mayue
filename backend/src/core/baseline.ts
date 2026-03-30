export type Point = { t: number; v: number };
export type BaselineResult = { risk: "LOW" | "MEDIUM" | "HIGH"; score: number; note: string };

export function analyzeTimeseries(series: Point[], threshold = 1.0): BaselineResult {
  // MVP baseline: 看最后一个值的绝对值是否超过阈值。
  if (!series.length) return { risk: "LOW", score: 0.0, note: "empty_series" };
  const v = Number(series[series.length - 1].v);
  const score = Math.abs(v);
  if (score > threshold * 2) return { risk: "HIGH", score, note: "baseline" };
  if (score > threshold) return { risk: "MEDIUM", score, note: "baseline" };
  return { risk: "LOW", score, note: "baseline" };
}