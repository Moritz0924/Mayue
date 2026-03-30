import { loadConfig } from "../app/config.js";
import { loadMaintenanceHistory } from "../demo/repository.js";
import { findRecentMatchingAlert, recordAlert } from "../domain/alerts.js";
import { eventBus, TOPIC_ALERTS } from "../infra/bus/eventBus.memory.js";
import { telemetryRingBuffer } from "../infra/cache/telemetryRingBuffer.js";
import { buildFeatureVector, buildVibrationSignal, type FeatureVector } from "./featureEngineering.js";
import { assertElementTelemetry } from "./elementGuard.js";
import { getLlmStatus, requestStructuredJson, runToolLoop, type ChatMessage, type JsonSchema, type LlmTool, type ToolLoopResult } from "./llmRuntime.js";
import { runPythonTask } from "./pythonBridge.js";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type AlertLevel = "L1" | "L2" | "L3";

export type AgentOpinion = { agent: string; conclusion: string; score: number };
export type ReferenceItem = { record_id: string; issue: string; action: string; result: string };

export type CopilotResult = {
  element_id: string;
  mode: "offline-expert-ensemble" | "llm-tool-calling";
  summary: string;
  risk: RiskLevel;
  alert_level: AlertLevel;
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
  agents: AgentOpinion[];
  actions: string[];
  references: ReferenceItem[];
  llm?: {
    provider: string;
    model: string;
    rounds: number;
    executed_tools: string[];
    status: "active" | "fallback";
    note?: string;
  };
};

type PredictResponse = {
  pred: Array<{ ts_ms: number; disp: number }>;
  confidence: number;
  trend_slope_mm_per_step: number;
  threshold_mm: number;
  breach_ts_ms?: number | null;
  model_version: string;
};

type EvaluateResponse = {
  label: string;
  prob: number;
  probs: Record<string, number>;
  rms: number;
  dominant_freq_hz: number;
  model_version: string;
};

type JudgedRisk = {
  risk: RiskLevel;
  alert_level: AlertLevel;
  score: number;
};

type CopilotFacts = {
  element_id: string;
  horizon_sec: number;
  features: FeatureVector;
  current: {
    disp: number;
    vib: number;
    temp: number;
    wind: number;
  };
  predict: PredictResponse;
  evaluate: EvaluateResponse;
  references: ReferenceItem[];
  judged: JudgedRisk;
  predMax: number;
};

type LlmPlanDraft = {
  summary?: unknown;
  risk?: unknown;
  alert_level?: unknown;
  agents?: Array<{ agent?: unknown; conclusion?: unknown }>;
  actions?: unknown[];
};

const LLM_PLAN_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "risk", "alert_level", "agents", "actions"],
  properties: {
    summary: { type: "string" },
    risk: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
    alert_level: { type: "string", enum: ["L1", "L2", "L3"] },
    agents: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["agent", "conclusion"],
        properties: {
          agent: { type: "string" },
          conclusion: { type: "string" },
        },
      },
    },
    actions: {
      type: "array",
      minItems: 3,
      maxItems: 8,
      items: { type: "string" },
    },
  },
};

function clampRiskScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function riskFromSignals(input: { currentDisp: number; predMax: number; vibLabel: string; vibProb: number }): JudgedRisk {
  let score = 0;
  score += Math.min(0.45, Math.abs(input.currentDisp) / 1.5 * 0.35);
  score += Math.min(0.35, Math.abs(input.predMax) / 1.5 * 0.35);
  if (input.vibLabel === "WARNING") score += 0.18 + input.vibProb * 0.1;
  if (input.vibLabel === "DAMAGE_SUSPECTED") score += 0.35 + input.vibProb * 0.15;
  score = clampRiskScore(score);
  if (score >= 0.78) return { risk: "HIGH", alert_level: "L2", score };
  if (score >= 0.48) return { risk: "MEDIUM", alert_level: "L1", score };
  return { risk: "LOW", alert_level: "L3", score };
}

function severityOf(risk: RiskLevel): number {
  if (risk === "HIGH") return 3;
  if (risk === "MEDIUM") return 2;
  return 1;
}

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return severityOf(a) >= severityOf(b) ? a : b;
}

function alertFromRisk(risk: RiskLevel): AlertLevel {
  if (risk === "HIGH") return "L2";
  if (risk === "MEDIUM") return "L1";
  return "L3";
}

function normalizeRisk(value: unknown, fallback: RiskLevel): RiskLevel {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "LOW" || normalized === "MEDIUM" || normalized === "HIGH") return normalized;
  return fallback;
}

function normalizeAlertLevel(value: unknown, fallback: AlertLevel): AlertLevel {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "L1" || normalized === "L2" || normalized === "L3") return normalized;
  return fallback;
}

function normalizeText(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : fallback;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of values) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

async function loadCopilotFacts(element_id: string, horizon_sec: number): Promise<CopilotFacts> {
  await assertElementTelemetry(element_id, ["disp", "vib"]);
  const features = buildFeatureVector(element_id, { history_steps: 16, step_ms: 5 * 60 * 1000, window_ms: 30 * 60 * 1000 });
  const vibrationSignal = buildVibrationSignal(element_id, { size: 256, window_ms: 5 * 60 * 1000 });
  const currentDisp = telemetryRingBuffer.latestValue(element_id, "disp")?.value ?? 0;
  const currentVib = telemetryRingBuffer.latestValue(element_id, "vib")?.value ?? 0;
  const currentTemp = telemetryRingBuffer.latestValue(element_id, "temp")?.value ?? 0;
  const currentWind = telemetryRingBuffer.latestValue(element_id, "wind")?.value ?? 0;

  const [predict, evaluate, history] = await Promise.all([
    runPythonTask<PredictResponse>("predict_displacement", {
      element_id,
      features_64: features.features_64,
      history: features.history,
      horizon: horizon_sec,
      step_sec: 5,
      base_ts_ms: features.generated_at_ts_ms,
      current_disp: currentDisp,
      threshold_mm: 1.5,
    }),
    runPythonTask<EvaluateResponse>("evaluate_vibration", {
      element_id,
      signal: vibrationSignal,
      fs_hz: 128,
      window_ms: 5 * 60 * 1000,
    }),
    loadMaintenanceHistory(),
  ]);

  const predMax = Math.max(...predict.pred.map((p) => Math.abs(p.disp)), Math.abs(currentDisp));
  const judged = riskFromSignals({ currentDisp, predMax, vibLabel: evaluate.label, vibProb: evaluate.prob });
  const references = history
    .filter((item) => item.element_id === element_id)
    .map((item) => ({
      record_id: item.record_id,
      issue: item.issue,
      action: item.action,
      result: item.result,
    }));

  return {
    element_id,
    horizon_sec,
    features,
    current: {
      disp: currentDisp,
      vib: currentVib,
      temp: currentTemp,
      wind: currentWind,
    },
    predict,
    evaluate,
    references,
    judged,
    predMax,
  };
}

function buildOfflineResult(facts: CopilotFacts, llmMeta?: CopilotResult["llm"]): CopilotResult {
  const { current, evaluate, predict, references, predMax, judged } = facts;
  const agents: AgentOpinion[] = [
    {
      agent: "safety-agent",
      score: Number(judged.score.toFixed(4)),
      conclusion:
        judged.risk === "HIGH"
          ? `预测位移峰值 ${predMax.toFixed(3)}mm，超过 1.5mm 阈值的风险显著。`
          : `当前位移 ${current.disp.toFixed(3)}mm，短时趋势仍需持续观察。`,
    },
    {
      agent: "vibration-agent",
      score: Number(evaluate.prob.toFixed(4)),
      conclusion: `振动模型判定 ${evaluate.label}，主频 ${evaluate.dominant_freq_hz.toFixed(2)}Hz，RMS=${evaluate.rms.toFixed(4)}。`,
    },
    {
      agent: "ops-agent",
      score: Number(Math.max(0.55, evaluate.prob).toFixed(4)),
      conclusion:
        current.wind > 8
          ? `当前风速 ${current.wind.toFixed(2)}m/s，建议优先执行风致工况复核与复测。`
          : `建议联动位移、振动与应变窗口进行二次复核，避免单指标误判。`,
    },
  ];

  const actions = [
    judged.risk === "HIGH" ? "立即创建 P1 工单，45 分钟内完成现场复测。" : "创建 P2 工单，安排下一巡检窗口复测。",
    "同步调取构件近 2 小时位移、振动与应变窗口，复核传感器质量分数。",
    predict.breach_ts_ms ? "将预测越阈时刻写入预警链路，触发维护计划生成。" : "维持分钟级订阅监控，继续观察趋势斜率。",
    references.length > 0 ? `参考历史记录 ${references.map((ref) => ref.record_id).join(", ")} 的处置经验。` : "暂无历史工单，按标准排障流程执行。",
  ];

  const summary =
    judged.risk === "HIGH"
      ? `${facts.element_id} 已达到高风险，位移预测与振动评估同时抬升，建议立即处置。`
      : judged.risk === "MEDIUM"
      ? `${facts.element_id} 为中风险，趋势抬升但尚未形成明确损伤结论。`
      : `${facts.element_id} 当前整体稳定，继续保持在线监测。`;

  return {
    element_id: facts.element_id,
    mode: "offline-expert-ensemble",
    summary,
    risk: judged.risk,
    alert_level: judged.alert_level,
    current: {
      disp: Number(current.disp.toFixed(4)),
      vib: Number(current.vib.toFixed(4)),
      temp: Number(current.temp.toFixed(3)),
      wind: Number(current.wind.toFixed(3)),
    },
    prediction: {
      max_disp_mm: Number(predMax.toFixed(4)),
      horizon_sec: facts.horizon_sec,
      confidence: Number(predict.confidence.toFixed(4)),
      breach_ts_ms: predict.breach_ts_ms ?? null,
      slope: Number(predict.trend_slope_mm_per_step.toFixed(6)),
    },
    vibration: {
      label: evaluate.label,
      prob: Number(evaluate.prob.toFixed(4)),
      rms: Number(evaluate.rms.toFixed(5)),
      dominant_freq_hz: Number(evaluate.dominant_freq_hz.toFixed(3)),
    },
    agents,
    actions,
    references,
    ...(llmMeta ? { llm: llmMeta } : {}),
  };
}

function finalizeResult(result: CopilotResult): CopilotResult {
  if (result.risk !== "LOW") {
    const metric: "disp" | "vib" = result.risk === "HIGH" ? "disp" : "vib";
    const candidate = {
      element_id: result.element_id,
      level: result.alert_level,
      metric,
      trigger_ts_ms: Date.now(),
      note: `AI联合分析判定 ${result.risk}`,
    };
    const existing = findRecentMatchingAlert(candidate, 5 * 60 * 1000);
    if (!existing) {
      const alert = recordAlert(candidate);
      eventBus.publish(TOPIC_ALERTS, alert);
    }
  }
  return result;
}

function buildLlmTools(facts: CopilotFacts): LlmTool[] {
  const currentPayload = {
    element_id: facts.element_id,
    current: {
      disp_mm: Number(facts.current.disp.toFixed(4)),
      vib: Number(facts.current.vib.toFixed(4)),
      temp_c: Number(facts.current.temp.toFixed(3)),
      wind_mps: Number(facts.current.wind.toFixed(3)),
    },
    threshold_mm: Number(facts.predict.threshold_mm.toFixed(3)),
    heuristic_risk_hint: facts.judged.risk,
    feature_snapshot: facts.features.latest_metrics,
  };

  const predictPayload = {
    element_id: facts.element_id,
    model_version: facts.predict.model_version,
    horizon_sec: facts.horizon_sec,
    max_disp_mm: Number(facts.predMax.toFixed(4)),
    confidence: Number(facts.predict.confidence.toFixed(4)),
    breach_ts_ms: facts.predict.breach_ts_ms ?? null,
    slope: Number(facts.predict.trend_slope_mm_per_step.toFixed(6)),
    forecast: facts.predict.pred.slice(0, 8),
  };

  const vibrationPayload = {
    element_id: facts.element_id,
    model_version: facts.evaluate.model_version,
    label: facts.evaluate.label,
    prob: Number(facts.evaluate.prob.toFixed(4)),
    rms: Number(facts.evaluate.rms.toFixed(5)),
    dominant_freq_hz: Number(facts.evaluate.dominant_freq_hz.toFixed(3)),
    probs: facts.evaluate.probs,
  };

  const historyPayload = {
    element_id: facts.element_id,
    history_count: facts.references.length,
    references: facts.references,
  };

  return [
    {
      name: "get_current_state",
      description: "Read the latest displacement, vibration, temperature, wind and feature snapshot for one structural element.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["element_id"],
        properties: {
          element_id: { type: "string", description: "Target structural element id." },
        },
      },
      execute: async () => JSON.stringify(currentPayload),
    },
    {
      name: "get_displacement_forecast",
      description: "Read the LSTM displacement forecast, confidence, slope and breach timestamp for one element.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["element_id", "horizon_sec"],
        properties: {
          element_id: { type: "string" },
          horizon_sec: { type: "number" },
        },
      },
      execute: async () => JSON.stringify(predictPayload),
    },
    {
      name: "evaluate_vibration",
      description: "Read the 1D-CNN vibration health evaluation for one element.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["element_id"],
        properties: {
          element_id: { type: "string" },
        },
      },
      execute: async () => JSON.stringify(vibrationPayload),
    },
    {
      name: "get_maintenance_history",
      description: "Read historical maintenance records, prior issues and repair results for one element.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["element_id"],
        properties: {
          element_id: { type: "string" },
        },
      },
      execute: async () => JSON.stringify(historyPayload),
    },
  ];
}

function mergeLlmDraft(facts: CopilotFacts, base: CopilotResult, loopResult: ToolLoopResult, draft: LlmPlanDraft): CopilotResult {
  const llmStatus = getLlmStatus();
  const finalRisk = maxRisk(normalizeRisk(draft.risk, base.risk), base.risk);
  const finalAlert = alertFromRisk(finalRisk);
  const summary = normalizeText(draft.summary, base.summary);

  const draftAgentMap = new Map<string, string>();
  for (const item of Array.isArray(draft.agents) ? draft.agents : []) {
    const agent = typeof item?.agent === "string" ? item.agent.trim() : "";
    const conclusion = typeof item?.conclusion === "string" ? item.conclusion.trim() : "";
    if (agent && conclusion) draftAgentMap.set(agent, conclusion);
  }

  const agents = base.agents.map((agent) => ({
    ...agent,
    conclusion: normalizeText(draftAgentMap.get(agent.agent), agent.conclusion),
  }));

  const draftActions = Array.isArray(draft.actions)
    ? draft.actions.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];
  const actions = uniqueStrings([...draftActions, ...base.actions]).slice(0, 6);

  return {
    ...base,
    mode: "llm-tool-calling",
    summary,
    risk: finalRisk,
    alert_level: finalAlert,
    agents,
    actions: actions.length >= 3 ? actions : base.actions,
    llm: {
      provider: llmStatus.provider,
      model: llmStatus.model,
      rounds: loopResult.rounds,
      executed_tools: uniqueStrings(loopResult.executed_calls.map((item) => item.name)),
      status: "active",
      note: loopResult.final_text ? `intermediate=${loopResult.final_text.slice(0, 120)}` : undefined,
    },
  };
}

async function runLlmCopilot(facts: CopilotFacts, offline: CopilotResult): Promise<CopilotResult> {
  const llmTools = buildLlmTools(facts);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "你是马跃项目的结构运维协同大模型。先调用工具收集事实，再给出结论。不要编造数值，不要忽略越阈、损伤嫌疑和历史工单。最终维护计划必须是中文、可执行、偏保守。",
    },
    {
      role: "user",
      content: `请分析构件 ${facts.element_id} 在未来 ${facts.horizon_sec} 秒内的位移与振动风险，生成维护计划。优先调用 get_current_state、get_displacement_forecast、evaluate_vibration、get_maintenance_history。`,
    },
  ];

  const loopResult = await runToolLoop(messages, llmTools);
  const finalDraft = await requestStructuredJson<LlmPlanDraft>(
    [
      ...loopResult.messages,
      {
        role: "user",
        content: "现在不要再调用新工具。请严格输出 JSON，用于后端生成 maintenance-plan。",
      },
    ],
    LLM_PLAN_SCHEMA
  );

  return mergeLlmDraft(facts, offline, loopResult, finalDraft);
}

export function getCopilotRuntimeStatus(): ReturnType<typeof getLlmStatus> {
  return getLlmStatus();
}

export async function runCopilot(element_id: string, horizon_sec = 36): Promise<CopilotResult> {
  const facts = await loadCopilotFacts(element_id, horizon_sec);
  const offline = buildOfflineResult(facts);
  const cfg = loadConfig();

  if (cfg.llm.mode === "disabled") {
    return finalizeResult(offline);
  }

  try {
    const llmResult = await runLlmCopilot(facts, offline);
    return finalizeResult(llmResult);
  } catch (error) {
    const llmStatus = getLlmStatus();
    return finalizeResult(
      buildOfflineResult(facts, {
        provider: llmStatus.provider,
        model: llmStatus.model,
        rounds: 0,
        executed_tools: [],
        status: "fallback",
        note: `llm_failed=${(error as Error).message}`,
      })
    );
  }
}
