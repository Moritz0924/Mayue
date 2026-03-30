import type {
  AlertItem,
  AnalyzeResp,
  CopilotPlan,
  CopilotStatus,
  PredictResp,
  TwinScene,
  VibrationResp,
} from "./api/client";

export type RiskTone = "low" | "medium" | "high";

export type TwinStageNodeViewModel = {
  elementId: string;
  name: string;
  zone: string;
  shape: "box" | "cylinder";
  position: [number, number, number];
  size: [number, number, number];
  tone: RiskTone;
  status: string;
  disp: number | null;
  vib: number | null;
};

export type TwinStageViewModel = {
  modelId: string;
  sceneName: string;
  lod: string;
  selectedId: string;
  selectedName: string;
  nodes: TwinStageNodeViewModel[];
};

export type DualModelViewModel = {
  elementId: string;
  fusedRisk: "LOW" | "MEDIUM" | "HIGH";
  fusedTone: RiskTone;
  displacement: {
    confidencePct: number;
    slope: number;
    breachTime: string;
    peakDispMm: number;
    modelVersion: string;
  };
  vibration: {
    label: string;
    confidencePct: number;
    dominantFreqHz: number;
    modelVersion: string;
  };
};

export type InnovationFlowStep = {
  id: string;
  title: string;
  description: string;
  value: string;
  status: "done" | "active" | "idle";
};

export type InnovationFlowViewModel = {
  title: string;
  subtitle: string;
  steps: InnovationFlowStep[];
};

function toTone(value: string | undefined): RiskTone {
  if (value === "HIGH" || value === "L2" || value === "DAMAGE_SUSPECTED") return "high";
  if (value === "MEDIUM" || value === "L1" || value === "WARNING") return "medium";
  return "low";
}

function upgradeRiskByVibration(
  risk: "LOW" | "MEDIUM" | "HIGH",
  vibrationLabel: string
): "LOW" | "MEDIUM" | "HIGH" {
  if (vibrationLabel === "DAMAGE_SUSPECTED") return "HIGH";
  if (vibrationLabel === "WARNING" && risk === "LOW") return "MEDIUM";
  return risk;
}

export function buildTwinStageViewModel(scene: TwinScene, selectedId: string): TwinStageViewModel {
  const selected = scene.elements.find((item) => item.element_id === selectedId) ?? scene.elements[0];
  return {
    modelId: scene.model_id,
    sceneName: scene.name,
    lod: scene.lod,
    selectedId: selected?.element_id ?? selectedId,
    selectedName: selected?.name ?? selectedId,
    nodes: scene.elements.map((item) => ({
      elementId: item.element_id,
      name: item.name,
      zone: item.zone,
      shape: item.shape,
      position: item.position,
      size: item.size,
      tone: toTone(item.status),
      status: item.status ?? "NORMAL",
      disp: item.latest_metrics.disp ?? null,
      vib: item.latest_metrics.vib ?? null,
    })),
  };
}

export function buildDualModelViewModel(
  elementId: string,
  analysis: AnalyzeResp,
  prediction: PredictResp,
  vibration: VibrationResp
): DualModelViewModel {
  const fusedRisk = upgradeRiskByVibration(analysis.risk, vibration.label);
  const lastDisp = prediction.pred[prediction.pred.length - 1]?.disp ?? 0;
  return {
    elementId,
    fusedRisk,
    fusedTone: toTone(fusedRisk),
    displacement: {
      confidencePct: Math.round(prediction.confidence * 100),
      slope: Number(prediction.trend_slope_mm_per_step.toFixed(4)),
      breachTime: prediction.breach_ts_ms
        ? new Date(prediction.breach_ts_ms).toLocaleTimeString("zh-CN", { hour12: false })
        : "未触发阈值",
      peakDispMm: Number(lastDisp.toFixed(3)),
      modelVersion: prediction.model_version,
    },
    vibration: {
      label: vibration.label,
      confidencePct: Math.round(vibration.prob * 100),
      dominantFreqHz: Number(vibration.dominant_freq_hz.toFixed(2)),
      modelVersion: vibration.model_version,
    },
  };
}

export function buildInnovationFlowViewModel(input: {
  twin: TwinStageViewModel;
  dualModel: DualModelViewModel;
  copilot: CopilotStatus;
  plan: CopilotPlan;
  alerts: AlertItem[];
}): InnovationFlowViewModel {
  const activeAlerts = input.alerts.filter((item) => item.level === "L1" || item.level === "L2").length;
  const llmOnline = input.copilot.enabled ? "在线" : "离线兜底";
  const hasDispatch = input.plan.actions.length > 0;

  return {
    title: "创新链路可视化",
    subtitle: "感知数据 -> 特征工程(64维) -> 双模型判定 -> 风险融合 -> 运维闭环",
    steps: [
      {
        id: "ingest",
        title: "感知数据汇聚",
        description: "多源传感数据入湖与质量过滤",
        value: `${input.twin.nodes.length} 个构件在线`,
        status: "done",
      },
      {
        id: "features",
        title: "64维特征工程",
        description: "窗口聚合与统计特征自动构建",
        value: "disp/vib/temp/wind 等 8 指标",
        status: "done",
      },
      {
        id: "dual-model",
        title: "双模型协同判定",
        description: "LSTM 位移预测 + 1D-CNN 振动评估",
        value: `LSTM ${input.dualModel.displacement.confidencePct}% | CNN ${input.dualModel.vibration.confidencePct}%`,
        status: input.dualModel.fusedRisk === "HIGH" ? "active" : "done",
      },
      {
        id: "fusion",
        title: "风险融合与 Copilot",
        description: "融合风险等级并生成维护建议",
        value: `${input.plan.risk} / ${input.plan.alert_level} (${llmOnline})`,
        status: hasDispatch ? "active" : "idle",
      },
      {
        id: "closed-loop",
        title: "运维闭环执行",
        description: "告警、工单、巡检建议同步联动",
        value: `${activeAlerts} 条高优先告警`,
        status: activeAlerts > 0 ? "active" : "idle",
      },
    ],
  };
}

