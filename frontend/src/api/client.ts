export type Model = { model_id: string; name: string };
export type ElementItem = { element_id: string; name: string };
export type Point = { t: number; v: number };
export type SeriesResp = { element_id: string; metric: string; series: Point[] };
export type AnalyzeResp = { element_id: string; metric: string; risk: "LOW" | "MEDIUM" | "HIGH"; score: number; note: string };

export type TwinElement = {
  element_id: string;
  name: string;
  shape: "box" | "cylinder";
  position: [number, number, number];
  size: [number, number, number];
  zone: string;
  status?: string;
  color?: string;
  latest_metrics: {
    disp?: number | null;
    vib?: number | null;
    temp?: number | null;
    wind?: number | null;
  };
};

export type TwinScene = {
  model_id: string;
  name: string;
  lod: string;
  elements: TwinElement[];
  generated_at_ts_ms?: number;
};

export type AlertItem = {
  alert_id: string;
  element_id: string;
  level: "L1" | "L2" | "L3";
  metric: string;
  trigger_ts_ms: number;
  emit_ts_ms: number;
  note?: string;
};

export type TwinElementDetail = TwinElement & {
  alerts: AlertItem[];
  latest_metrics: Record<string, number | null>;
};

export type CopilotStatus = {
  enabled: boolean;
  mode: "disabled" | "ollama" | "openai-compatible";
  provider: string;
  model: string;
  base_url: string;
  think: boolean;
  max_tool_rounds: number;
  timeout_ms: number;
  recommended_model: string;
};

export type PredictResp = {
  element_id: string;
  horizon: number;
  pred: Array<{ ts_ms: number; disp: number }>;
  confidence: number;
  model_version: string;
  breach_ts_ms: number | null;
  trend_slope_mm_per_step: number;
};

export type VibrationResp = {
  element_id: string;
  label: "NORMAL" | "WARNING" | "DAMAGE_SUSPECTED";
  prob: number;
  probs: Record<string, number>;
  dominant_freq_hz: number;
  model_version: string;
};

export type CopilotPlan = {
  element_id: string;
  mode: "offline-expert-ensemble" | "llm-tool-calling";
  summary: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  alert_level: "L1" | "L2" | "L3";
  current: Record<string, number | null>;
  prediction: {
    max_disp_mm: number;
    horizon_sec: number;
    confidence: number;
    breach_ts_ms: number | null;
    slope: number;
  };
  vibration: {
    label: string;
    prob: number;
    rms: number;
    dominant_freq_hz: number;
  };
  agents: Array<{ agent: string; conclusion: string; score: number }>;
  actions: string[];
  references: Array<{ record_id: string; issue: string; action: string; result: string }>;
  llm?: {
    provider: string;
    model: string;
    rounds: number;
    executed_tools: string[];
    status: "active" | "fallback";
    note?: string;
  };
};

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export function getModels(): Promise<Model[]> {
  return requestJson<Model[]>("/api/models");
}

export function getElements(modelId: string): Promise<ElementItem[]> {
  return requestJson<ElementItem[]>(`/api/models/${modelId}/elements`);
}

export function getTimeseries(elementId: string, metric = "disp", n = 120): Promise<SeriesResp> {
  return requestJson<SeriesResp>(`/api/elements/${elementId}/timeseries?metric=${metric}&n=${n}`);
}

export function analyze(elementId: string, metric = "disp"): Promise<AnalyzeResp> {
  return requestJson<AnalyzeResp>(`/api/elements/${elementId}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metric, horizon: 60 }),
  });
}

export function getTwinScene(modelId = "demo_tower"): Promise<TwinScene> {
  return requestJson<TwinScene>(`/api/twin/scene?model_id=${modelId}`);
}

export function getTwinElement(elementId: string): Promise<TwinElementDetail> {
  return requestJson<TwinElementDetail>(`/api/twin/elements/${elementId}`);
}

export function getAlerts(limit = 6): Promise<AlertItem[]> {
  return requestJson<AlertItem[]>(`/api/alerts/recent?limit=${limit}`);
}

export function getCopilotStatus(): Promise<CopilotStatus> {
  return requestJson<CopilotStatus>("/api/copilot/status");
}

export function predictDisplacement(elementId: string, horizon = 12): Promise<PredictResp> {
  return requestJson<PredictResp>("/api/predict/displacement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ element_id: elementId, horizon }),
  });
}

export function evaluateVibration(elementId: string): Promise<VibrationResp> {
  return requestJson<VibrationResp>("/api/evaluate/vibration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ element_id: elementId }),
  });
}

export function getMaintenancePlan(elementId: string, horizonSec = 20): Promise<CopilotPlan> {
  return requestJson<CopilotPlan>("/api/copilot/maintenance-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ element_id: elementId, horizon_sec: horizonSec }),
  });
}
