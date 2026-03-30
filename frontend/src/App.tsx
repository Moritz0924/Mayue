import { startTransition, useEffect, useRef, useState } from "react";
import {
  analyze,
  evaluateVibration,
  getAlerts,
  getCopilotStatus,
  getElements,
  getMaintenancePlan,
  getModels,
  getTimeseries,
  getTwinElement,
  getTwinScene,
  predictDisplacement,
  type AlertItem,
  type AnalyzeResp,
  type CopilotPlan,
  type CopilotStatus,
  type ElementItem,
  type Point,
  type PredictResp,
  type TwinElement,
  type TwinElementDetail,
  type TwinScene,
  type VibrationResp,
} from "./api/client";
import {
  buildDualModelViewModel,
  buildInnovationFlowViewModel,
  buildTwinStageViewModel,
  type RiskTone,
} from "./viewmodels";

const FALLBACK_MODEL_ID = "demo_tower";
const PRIMARY_ELEMENT_ID = "E1008";
const TWIN_MESSAGE_SOURCE = "mayue-twin";

const FALLBACK_SCENE: TwinScene = {
  model_id: "demo_tower",
  name: "Mayue Demo Tower",
  lod: "LOD400-demo",
  generated_at_ts_ms: Date.now(),
  elements: [
    {
      element_id: "E1001",
      name: "Foundation Core",
      shape: "box",
      position: [0, 6, 0],
      size: [10, 12, 10],
      zone: "foundation",
      status: "NORMAL",
      color: "#8a98a6",
      latest_metrics: { disp: 0.18, vib: 0.22, temp: 24.5, wind: 5.8 },
    },
    {
      element_id: "E1002",
      name: "South Mega Column",
      shape: "box",
      position: [-8, 28, 0],
      size: [3, 44, 3],
      zone: "south",
      status: "MEDIUM",
      color: "#e48e2f",
      latest_metrics: { disp: 0.63, vib: 0.71, temp: 25.1, wind: 8.2 },
    },
    {
      element_id: "E1003",
      name: "North Mega Column",
      shape: "box",
      position: [8, 28, 0],
      size: [3, 44, 3],
      zone: "north",
      status: "NORMAL",
      color: "#8a98a6",
      latest_metrics: { disp: 0.29, vib: 0.38, temp: 24.9, wind: 6.4 },
    },
    {
      element_id: "E1004",
      name: "East Outrigger",
      shape: "box",
      position: [6, 38, 0],
      size: [10, 2, 2],
      zone: "east",
      status: "NORMAL",
      color: "#9caab7",
      latest_metrics: { disp: 0.33, vib: 0.42, temp: 24.6, wind: 6.6 },
    },
    {
      element_id: "E1005",
      name: "West Outrigger",
      shape: "box",
      position: [-6, 38, 0],
      size: [10, 2, 2],
      zone: "west",
      status: "NORMAL",
      color: "#9caab7",
      latest_metrics: { disp: 0.31, vib: 0.39, temp: 24.4, wind: 6.5 },
    },
    {
      element_id: "E1006",
      name: "Mid Core Tube",
      shape: "box",
      position: [0, 30, 0],
      size: [8, 36, 8],
      zone: "core_mid",
      status: "NORMAL",
      color: "#a9b3be",
      latest_metrics: { disp: 0.27, vib: 0.36, temp: 24.8, wind: 6.1 },
    },
    {
      element_id: "E1007",
      name: "Upper Core Tube",
      shape: "box",
      position: [0, 52, 0],
      size: [6, 18, 6],
      zone: "core_top",
      status: "NORMAL",
      color: "#b8c1ca",
      latest_metrics: { disp: 0.44, vib: 0.48, temp: 24.2, wind: 7.4 },
    },
    {
      element_id: "E1008",
      name: "Crown Mast",
      shape: "cylinder",
      position: [0, 66, 0],
      size: [1.2, 12, 1.2],
      zone: "crown",
      status: "HIGH",
      color: "#df554d",
      latest_metrics: { disp: 1.42, vib: 0.89, temp: 23.9, wind: 10.8 },
    },
  ],
};

const FALLBACK_ALERTS: AlertItem[] = [
  {
    alert_id: "A-001",
    element_id: "E1008",
    level: "L2",
    metric: "disp",
    trigger_ts_ms: Date.now() - 2 * 60 * 1000,
    emit_ts_ms: Date.now() - 90 * 1000,
    note: "冠顶桅杆位移趋势仍在抬升，建议进入短周期复测窗口。",
  },
  {
    alert_id: "A-002",
    element_id: "E1002",
    level: "L1",
    metric: "vib",
    trigger_ts_ms: Date.now() - 9 * 60 * 1000,
    emit_ts_ms: Date.now() - 8 * 60 * 1000,
    note: "南向巨柱振动包络在阵风段明显扩张。",
  },
  {
    alert_id: "A-003",
    element_id: "E1006",
    level: "L3",
    metric: "temp",
    trigger_ts_ms: Date.now() - 17 * 60 * 1000,
    emit_ts_ms: Date.now() - 16 * 60 * 1000,
    note: "温漂补偿偏移超出观测基线。",
  },
];

const FALLBACK_COPILOT_STATUS: CopilotStatus = {
  enabled: false,
  mode: "disabled",
  provider: "disabled",
  model: "offline-expert-ensemble",
  base_url: "",
  think: false,
  max_tool_rounds: 0,
  timeout_ms: 0,
  recommended_model: "qwen3:30b",
};

type TwinIncomingMessage = {
  source?: string;
  type?: "twin:ready" | "twin:selected";
  element_id?: string;
  model_id?: string;
};

function buildFallbackSeries(elementId: string): Point[] {
  const bias = elementId === "E1008" ? 0.68 : elementId === "E1002" ? 0.34 : 0.18;
  return Array.from({ length: 36 }, (_, idx) => {
    const wave = Math.sin(idx / 4) * 0.16 + Math.cos(idx / 7) * 0.08;
    const climb = elementId === "E1008" ? idx * 0.015 : idx * 0.004;
    return { t: idx, v: Number((bias + wave + climb).toFixed(4)) };
  });
}

function buildFallbackDetail(elementId: string): TwinElementDetail {
  const element =
    FALLBACK_SCENE.elements.find((item) => item.element_id === elementId) ?? FALLBACK_SCENE.elements[0]!;
  const alerts = FALLBACK_ALERTS.filter((item) => item.element_id === elementId);
  return {
    ...element,
    alerts,
    latest_metrics: {
      disp: element.latest_metrics.disp ?? null,
      vib: element.latest_metrics.vib ?? null,
      temp: element.latest_metrics.temp ?? null,
      wind: element.latest_metrics.wind ?? null,
    },
  };
}

function buildFallbackAnalyze(elementId: string): AnalyzeResp {
  if (elementId === "E1008") {
    return {
      element_id: elementId,
      metric: "disp",
      risk: "HIGH",
      score: 1.42,
      note: "位移基线持续抬升，建议结合振动结果提升巡检频率。",
    };
  }
  if (elementId === "E1002") {
    return {
      element_id: elementId,
      metric: "disp",
      risk: "MEDIUM",
      score: 0.72,
      note: "趋势进入关注区间，建议联动风荷载窗口复核。",
    };
  }
  return {
    element_id: elementId,
    metric: "disp",
    risk: "LOW",
    score: 0.28,
    note: "当前位移与基线一致，保持常规监测。",
  };
}

function buildFallbackPrediction(elementId: string): PredictResp {
  const seed = elementId === "E1008" ? 1.12 : elementId === "E1002" ? 0.56 : 0.24;
  return {
    element_id: elementId,
    horizon: 12,
    confidence: elementId === "E1008" ? 0.91 : 0.82,
    model_version: "demo-lstm-64x128-v1",
    trend_slope_mm_per_step: elementId === "E1008" ? 0.044 : 0.012,
    breach_ts_ms: elementId === "E1008" ? Date.now() + 8 * 60 * 1000 : null,
    pred: Array.from({ length: 12 }, (_, idx) => ({
      ts_ms: Date.now() + (idx + 1) * 5_000,
      disp: Number((seed + idx * (elementId === "E1008" ? 0.042 : 0.011)).toFixed(4)),
    })),
  };
}

function buildFallbackVibration(elementId: string): VibrationResp {
  if (elementId === "E1008") {
    return {
      element_id: elementId,
      label: "WARNING",
      prob: 0.84,
      probs: { NORMAL: 0.08, WARNING: 0.84, DAMAGE_SUSPECTED: 0.08 },
      dominant_freq_hz: 13.8,
      model_version: "demo-1dcnn-v1",
    };
  }
  return {
    element_id: elementId,
    label: "NORMAL",
    prob: 0.72,
    probs: { NORMAL: 0.72, WARNING: 0.2, DAMAGE_SUSPECTED: 0.08 },
    dominant_freq_hz: 8.4,
    model_version: "demo-1dcnn-v1",
  };
}

function buildFallbackPlan(elementId: string): CopilotPlan {
  const elevated = elementId === "E1008";
  return {
    element_id: elementId,
    mode: "offline-expert-ensemble",
    summary: elevated
      ? "冠顶桅杆已进入高风险观察窗口，建议将孪生视角锁定冠区并执行短周期现场复测。"
      : "结构信号整体处于可控范围，建议保持当前采样节奏并继续趋势跟踪。",
    risk: elevated ? "HIGH" : "LOW",
    alert_level: elevated ? "L2" : "L3",
    current: {
      disp: elevated ? 1.42 : 0.24,
      vib: elevated ? 0.89 : 0.31,
      temp: elevated ? 23.9 : 24.5,
      wind: elevated ? 10.8 : 6.1,
    },
    prediction: {
      max_disp_mm: elevated ? 1.88 : 0.38,
      horizon_sec: 20,
      confidence: elevated ? 0.91 : 0.82,
      breach_ts_ms: elevated ? Date.now() + 8 * 60 * 1000 : null,
      slope: elevated ? 0.044 : 0.008,
    },
    vibration: {
      label: elevated ? "WARNING" : "NORMAL",
      prob: elevated ? 0.84 : 0.72,
      rms: elevated ? 0.192 : 0.081,
      dominant_freq_hz: elevated ? 13.8 : 8.4,
    },
    agents: [
      {
        agent: "safety-agent",
        score: elevated ? 0.89 : 0.38,
        conclusion: elevated
          ? "建议限制冠区作业并优先复核位移抬升趋势。"
          : "当前无需额外访问限制。",
      },
      {
        agent: "vibration-agent",
        score: elevated ? 0.84 : 0.28,
        conclusion: elevated
          ? "风致振动仍是主导风险因子，建议并行校核阻尼与采样质量。"
          : "振动包络维持在常规范围。",
      },
      {
        agent: "ops-agent",
        score: elevated ? 0.78 : 0.41,
        conclusion: elevated
          ? "建议在 15 分钟内安排现场确认与传感器健康复查。"
          : "维持当前巡检节奏即可。",
      },
    ],
    actions: elevated
      ? [
          "创建 P1 工单，15 分钟内完成冠区复测与设备核验。",
          "锁定孪生视角到 Crown Mast，对比近 2 小时位移包络。",
          "复查相关传感器质量评分并回放风荷载峰值时段数据。",
        ]
      : [
          "维持当前监测频率，持续观察趋势斜率。",
          "保持现有阈值策略并记录告警变动。",
          "在下一个巡检周期复核风振窗口。",
        ],
    references: [],
  };
}

function isTwinIncomingMessage(value: unknown): value is TwinIncomingMessage {
  return typeof value === "object" && value !== null;
}

function formatMetric(value: number | null | undefined, fractionDigits = 2, suffix = ""): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value.toFixed(fractionDigits)}${suffix}`;
}

function formatRelativeTime(ts: number): string {
  const deltaMin = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (deltaMin < 1) return "刚刚";
  if (deltaMin < 60) return `${deltaMin} 分钟前`;
  return `${Math.round(deltaMin / 60)} 小时前`;
}

function riskTone(risk: string | undefined): RiskTone {
  if (risk === "HIGH" || risk === "L2" || risk === "DAMAGE_SUSPECTED") return "high";
  if (risk === "MEDIUM" || risk === "L1" || risk === "WARNING") return "medium";
  return "low";
}

function riskLabel(tone: RiskTone): string {
  if (tone === "high") return "高风险";
  if (tone === "medium") return "中风险";
  return "低风险";
}

function sparklinePath(series: Point[], width: number, height: number): string {
  if (series.length === 0) return "";
  const values = series.map((point) => point.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.0001, max - min);
  return series
    .map((point, index) => {
      const x = (index / Math.max(1, series.length - 1)) * width;
      const y = height - ((point.v - min) / range) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function latestValue(series: Point[]): number | null {
  return series.length > 0 ? series[series.length - 1]!.v : null;
}

function elementLayout(element: TwinElement, scene: TwinScene): Record<string, string> {
  const extents = scene.elements.flatMap((item) => [
    item.position[0] - item.size[0] / 2,
    item.position[0] + item.size[0] / 2,
    item.position[1] - item.size[1] / 2,
    item.position[1] + item.size[1] / 2,
  ]);
  const xs = extents.filter((_value, index) => index % 4 < 2);
  const ys = extents.filter((_value, index) => index % 4 >= 2);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const xRange = Math.max(1, maxX - minX);
  const yRange = Math.max(1, maxY - minY);
  const width = Math.max(3, (element.size[0] / xRange) * 68);
  const height = Math.max(5, (element.size[1] / yRange) * 82);
  const left = 16 + ((element.position[0] - minX) / xRange) * 68;
  const top = 92 - ((element.position[1] - minY) / yRange) * 82;
  return { left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` };
}

export default function App() {
  const twinFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [modelId, setModelId] = useState(FALLBACK_MODEL_ID);
  const [elements, setElements] = useState<ElementItem[]>(
    FALLBACK_SCENE.elements.map(({ element_id, name }) => ({ element_id, name }))
  );
  const [scene, setScene] = useState<TwinScene>(FALLBACK_SCENE);
  const [selectedId, setSelectedId] = useState(PRIMARY_ELEMENT_ID);
  const [detail, setDetail] = useState<TwinElementDetail>(buildFallbackDetail(PRIMARY_ELEMENT_ID));
  const [series, setSeries] = useState<Point[]>(buildFallbackSeries(PRIMARY_ELEMENT_ID));
  const [analysis, setAnalysis] = useState<AnalyzeResp>(buildFallbackAnalyze(PRIMARY_ELEMENT_ID));
  const [prediction, setPrediction] = useState<PredictResp>(buildFallbackPrediction(PRIMARY_ELEMENT_ID));
  const [vibration, setVibration] = useState<VibrationResp>(buildFallbackVibration(PRIMARY_ELEMENT_ID));
  const [alerts, setAlerts] = useState<AlertItem[]>(FALLBACK_ALERTS);
  const [copilotStatus, setCopilotStatus] = useState<CopilotStatus>(FALLBACK_COPILOT_STATUS);
  const [plan, setPlan] = useState<CopilotPlan>(buildFallbackPlan(PRIMARY_ELEMENT_ID));
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const [twinReady, setTwinReady] = useState(false);
  const [twinEmbedError, setTwinEmbedError] = useState(false);

  useEffect(() => {
    let disposed = false;
    async function hydrate(): Promise<void> {
      const models = await getModels().catch(() => []);
      const nextModelId = models[0]?.model_id ?? FALLBACK_MODEL_ID;
      const [nextScene, nextElements, nextAlerts, nextCopilot] = await Promise.all([
        getTwinScene(nextModelId).catch(() => FALLBACK_SCENE),
        getElements(nextModelId).catch(() =>
          FALLBACK_SCENE.elements.map(({ element_id, name }) => ({ element_id, name }))
        ),
        getAlerts(8).catch(() => FALLBACK_ALERTS),
        getCopilotStatus().catch(() => FALLBACK_COPILOT_STATUS),
      ]);
      if (disposed) return;
      const preferredSelection = nextScene.elements.some((item) => item.element_id === PRIMARY_ELEMENT_ID)
        ? PRIMARY_ELEMENT_ID
        : nextElements[0]?.element_id ?? PRIMARY_ELEMENT_ID;
      startTransition(() => {
        setModelId(nextModelId);
        setScene(nextScene);
        setElements(nextElements);
        setAlerts(nextAlerts);
        setCopilotStatus(nextCopilot);
        setSelectedId(preferredSelection);
      });
    }
    void hydrate();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    setPlan(buildFallbackPlan(selectedId));
    async function loadSelection(): Promise<void> {
      const [nextDetail, nextSeries, nextAnalysis, nextPrediction, nextVibration] = await Promise.all([
        getTwinElement(selectedId).catch(() => buildFallbackDetail(selectedId)),
        getTimeseries(selectedId).catch(() => ({
          element_id: selectedId,
          metric: "disp",
          series: buildFallbackSeries(selectedId),
        })),
        analyze(selectedId).catch(() => buildFallbackAnalyze(selectedId)),
        predictDisplacement(selectedId, 12).catch(() => buildFallbackPrediction(selectedId)),
        evaluateVibration(selectedId).catch(() => buildFallbackVibration(selectedId)),
      ]);
      if (disposed) return;
      startTransition(() => {
        setDetail(nextDetail);
        setSeries(nextSeries.series);
        setAnalysis(nextAnalysis);
        setPrediction(nextPrediction);
        setVibration(nextVibration);
      });
    }
    void loadSelection();
    return () => {
      disposed = true;
    };
  }, [selectedId]);

  useEffect(() => {
    let disposed = false;
    async function refreshOperationalData(): Promise<void> {
      const [nextScene, nextAlerts, nextCopilot] = await Promise.all([
        getTwinScene(modelId).catch(() => null),
        getAlerts(8).catch(() => null),
        getCopilotStatus().catch(() => null),
      ]);
      if (disposed) return;
      startTransition(() => {
        if (nextScene) setScene(nextScene);
        if (nextAlerts) setAlerts(nextAlerts);
        if (nextCopilot) setCopilotStatus(nextCopilot);
      });
    }
    const timer = window.setInterval(() => {
      void refreshOperationalData();
    }, 10_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [modelId]);

  useEffect(() => {
    function handleTwinMessage(event: MessageEvent): void {
      if (event.origin !== window.location.origin) return;
      if (!isTwinIncomingMessage(event.data)) return;
      if (event.data.source !== TWIN_MESSAGE_SOURCE) return;
      if (event.data.type === "twin:ready") {
        setTwinReady(true);
        setTwinEmbedError(false);
        return;
      }
      if (event.data.type === "twin:selected" && typeof event.data.element_id === "string") {
        if (!scene.elements.some((item) => item.element_id === event.data.element_id)) return;
        setSelectedId(event.data.element_id);
      }
    }
    window.addEventListener("message", handleTwinMessage);
    return () => {
      window.removeEventListener("message", handleTwinMessage);
    };
  }, [scene.elements]);

  useEffect(() => {
    setTwinReady(false);
    setTwinEmbedError(false);
  }, [modelId]);

  useEffect(() => {
    if (!twinReady) return;
    if (!twinFrameRef.current?.contentWindow) return;
    twinFrameRef.current.contentWindow.postMessage(
      { source: "mayue-dashboard", type: "dashboard:select", element_id: selectedId },
      window.location.origin
    );
  }, [selectedId, twinReady]);

  async function handleGeneratePlan(): Promise<void> {
    setIsLoadingPlan(true);
    try {
      setPlan(await getMaintenancePlan(selectedId, 20));
    } catch {
      setPlan(buildFallbackPlan(selectedId));
    } finally {
      setIsLoadingPlan(false);
    }
  }

  const currentElement = scene.elements.find((item) => item.element_id === selectedId) ?? FALLBACK_SCENE.elements[0]!;
  const path = sparklinePath(series, 720, 220);
  const alertTone = riskTone(plan.risk);
  const twinModel = buildTwinStageViewModel(scene, selectedId);
  const dualModel = buildDualModelViewModel(selectedId, analysis, prediction, vibration);
  const innovation = buildInnovationFlowViewModel({
    twin: twinModel,
    dualModel,
    copilot: copilotStatus,
    plan,
    alerts,
  });
  const highRiskCount = scene.elements.filter((item) => riskTone(item.status) === "high").length;
  const activeAlerts = alerts.filter((item) => item.level === "L1" || item.level === "L2").length;
  const showFallbackStage = twinEmbedError || !twinReady;
  const twinFrameSrc = `/demo/twin-demo.html?embed=1&model_id=${encodeURIComponent(modelId)}`;

  return (
    <div className="expo-shell">
      <header className="panel expo-header">
        <div className="expo-title-row">
          <div className="brand-area">
            <div className="brand-badge">M</div>
            <div>
              <p className="meta-label">Mayue Digital Twin Exhibition</p>
              <h1>马跃数字孪生结构监测中台</h1>
            </div>
          </div>
          <div className={`mode-chip tone-${alertTone}`}>
            <span>Copilot</span>
            <strong>{copilotStatus.enabled ? copilotStatus.mode : "offline-expert-ensemble"}</strong>
          </div>
        </div>

        <div className="kpi-grid">
          <article className="kpi-card">
            <span>在线构件</span>
            <strong>{scene.elements.length}</strong>
            <small>{twinModel.lod}</small>
          </article>
          <article className="kpi-card">
            <span>活跃告警</span>
            <strong>{activeAlerts}</strong>
            <small>{alerts.length} 条最近记录</small>
          </article>
          <article className="kpi-card">
            <span>高风险构件</span>
            <strong>{highRiskCount}</strong>
            <small>双模型融合判定</small>
          </article>
          <article className="kpi-card">
            <span>当前聚焦</span>
            <strong>{twinModel.selectedId}</strong>
            <small>{twinModel.selectedName}</small>
          </article>
        </div>
      </header>

      <main className="expo-grid">
        <section className="panel twin-zone">
          <div className="zone-head">
            <div>
              <p className="meta-label">数字孪生主舞台</p>
              <h2>3D 结构态势联动视图</h2>
            </div>
            <div className="zone-side">
              <span>{twinModel.modelId}</span>
              <strong>{riskLabel(dualModel.fusedTone)}</strong>
            </div>
          </div>

          <div className="twin-canvas">
            <iframe
              ref={twinFrameRef}
              title="Mayue Twin 3D Stage"
              src={twinFrameSrc}
              className="twin-iframe"
              onLoad={() => setTwinEmbedError(false)}
              onError={() => setTwinEmbedError(true)}
            />

            {showFallbackStage ? (
              <div className="twin-fallback">
                <div className="twin-grid-layer" />
                {scene.elements.map((element) => (
                  <button
                    key={element.element_id}
                    className={`fallback-node ${element.shape === "cylinder" ? "cylinder" : ""} ${
                      selectedId === element.element_id ? "selected" : ""
                    } tone-${riskTone(element.status)}`}
                    style={elementLayout(element, scene)}
                    onClick={() => setSelectedId(element.element_id)}
                    aria-label={element.name}
                  />
                ))}
              </div>
            ) : null}

            <div className="twin-overlay">
              <div>
                <span>聚焦构件</span>
                <strong>{detail.name}</strong>
              </div>
              <div>
                <span>位移</span>
                <strong>{formatMetric(detail.latest_metrics.disp, 3, " mm")}</strong>
              </div>
              <div>
                <span>振动</span>
                <strong>{formatMetric(detail.latest_metrics.vib, 3)}</strong>
              </div>
            </div>
          </div>

          <div className="element-tabs">
            {elements.map((element) => (
              <button
                key={element.element_id}
                className={`element-tab ${selectedId === element.element_id ? "selected" : ""}`}
                onClick={() => setSelectedId(element.element_id)}
              >
                <span className={`tone-dot tone-${riskTone(scene.elements.find((item) => item.element_id === element.element_id)?.status)}`} />
                <strong>{element.element_id}</strong>
                <small>{element.name}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="panel model-zone">
          <div className="zone-head">
            <div>
              <p className="meta-label">双模型诊断区</p>
              <h2>LSTM + 1D-CNN 协同判定</h2>
            </div>
            <span className={`risk-pill tone-${dualModel.fusedTone}`}>{dualModel.fusedRisk}</span>
          </div>

          <div className="model-card-grid">
            <article className="model-card">
              <div className="model-card-head">
                <span className="model-tag">LSTM 位移预测</span>
                <strong>{formatMetric(dualModel.displacement.peakDispMm, 3, " mm")}</strong>
              </div>
              <p>{analysis.note}</p>
              <div className="model-metrics">
                <div>
                  <span>置信度</span>
                  <strong>{dualModel.displacement.confidencePct}%</strong>
                </div>
                <div>
                  <span>趋势斜率</span>
                  <strong>{formatMetric(dualModel.displacement.slope, 4)}</strong>
                </div>
                <div>
                  <span>阈值时刻</span>
                  <strong>{dualModel.displacement.breachTime}</strong>
                </div>
              </div>
              <small>{dualModel.displacement.modelVersion}</small>
            </article>

            <article className="model-card">
              <div className="model-card-head">
                <span className="model-tag">1D-CNN 振动评估</span>
                <strong>{dualModel.vibration.label}</strong>
              </div>
              <p>主频与概率同步更新，辅助位移趋势快速给出风险等级建议。</p>
              <div className="model-metrics">
                <div>
                  <span>置信度</span>
                  <strong>{dualModel.vibration.confidencePct}%</strong>
                </div>
                <div>
                  <span>主频</span>
                  <strong>{formatMetric(dualModel.vibration.dominantFreqHz, 2, " Hz")}</strong>
                </div>
                <div>
                  <span>融合风险</span>
                  <strong>{riskLabel(dualModel.fusedTone)}</strong>
                </div>
              </div>
              <small>{dualModel.vibration.modelVersion}</small>
            </article>
          </div>

          <div className="trend-block">
            <div className="trend-head">
              <span>位移时序包络</span>
              <strong>{formatMetric(latestValue(series), 3, " mm")}</strong>
            </div>
            <svg viewBox="0 0 720 220" className="trend-chart" role="img" aria-label="displacement trend">
              <defs>
                <linearGradient id="trendStroke" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#2b7cff" />
                  <stop offset="100%" stopColor="#ff8c3a" />
                </linearGradient>
              </defs>
              <path d={path} />
            </svg>
          </div>
        </section>

        <section className="panel decision-zone">
          <div className="zone-head">
            <div>
              <p className="meta-label">运维决策区</p>
              <h2>Copilot 维护建议闭环</h2>
            </div>
            <span className={`risk-pill tone-${alertTone}`}>{plan.alert_level}</span>
          </div>

          <p className="decision-summary">{plan.summary}</p>

          <button className="primary-btn" onClick={() => void handleGeneratePlan()}>
            {isLoadingPlan ? "正在生成维护计划..." : "刷新维护计划"}
          </button>

          <div className="action-list">
            {plan.actions.slice(0, 3).map((action, index) => (
              <div key={action} className="action-item">
                <span>{`0${index + 1}`}</span>
                <p>{action}</p>
              </div>
            ))}
          </div>

          <div className="reference-wrap">
            <p className="meta-label">历史工单证据</p>
            {plan.references.length === 0 ? (
              <div className="reference-empty">当前构件暂无可用历史工单，按标准流程执行巡检即可。</div>
            ) : (
              <div className="reference-list">
                {plan.references.slice(0, 3).map((item) => (
                  <article key={item.record_id} className="reference-item">
                    <strong>{item.record_id}</strong>
                    <p>{item.issue}</p>
                    <small>{item.action}</small>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="panel innovation-zone">
          <div className="zone-head">
            <div>
              <p className="meta-label">{innovation.title}</p>
              <h2>{innovation.subtitle}</h2>
            </div>
            <span className="zone-side-text">展示项目功能链路与创新点</span>
          </div>

          <div className="flow-lane">
            {innovation.steps.map((step) => (
              <article key={step.id} className={`flow-step ${step.status}`}>
                <strong>{step.title}</strong>
                <p>{step.description}</p>
                <span>{step.value}</span>
              </article>
            ))}
          </div>

          <div className="alert-strip">
            {alerts.slice(0, 4).map((alert) => (
              <div key={alert.alert_id} className={`alert-chip tone-${riskTone(alert.level)}`}>
                <strong>{alert.element_id}</strong>
                <span>{alert.note ?? `${alert.metric} 指标异常`}</span>
                <small>{formatRelativeTime(alert.emit_ts_ms)}</small>
              </div>
            ))}
          </div>

          <div className="foot-notes">
            <span>当前风速 {formatMetric(currentElement.latest_metrics.wind, 2, " m/s")}</span>
            <span>当前温度 {formatMetric(currentElement.latest_metrics.temp, 1, " C")}</span>
            <span>模型推荐 {copilotStatus.recommended_model}</span>
          </div>
        </section>
      </main>
    </div>
  );
}
