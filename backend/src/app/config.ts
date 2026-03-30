import 'dotenv/config';
import path from "node:path";
import { fileURLToPath } from "node:url";

export type LlmMode = "disabled" | "ollama" | "openai-compatible";

export type LlmConfig = {
  mode: LlmMode;
  model: string;
  baseUrl: string;
  apiKey: string;
  think: boolean;
  timeoutMs: number;
  maxToolRounds: number;
  temperature: number;
};

export type AppConfig = {
  port: number;
  pythonBin: string;
  repoRoot: string;
  llm: LlmConfig;
};

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeMode(value: string | undefined): LlmMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "ollama") return "ollama";
  if (normalized === "openai-compatible" || normalized === "openai_compatible" || normalized === "openai") {
    return "openai-compatible";
  }
  return "disabled";
}

function parseFiniteNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFiniteInteger(value: string | undefined, fallback: number): number {
  return Math.trunc(parseFiniteNumber(value, fallback));
}

function normalizeBaseUrl(mode: LlmMode, value: string | undefined): string {
  const raw = value?.trim();
  if (raw) return raw.replace(/\/+$/, "");
  if (mode === "ollama") return "http://127.0.0.1:11434";
  if (mode === "openai-compatible") return "http://127.0.0.1:8001/v1";
  return "";
}

function defaultPythonBin(): string {
  return process.platform === "win32" ? "python" : "python3";
}

export function loadConfig(): AppConfig {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const llmMode = normalizeMode(process.env.MAYUE_LLM_MODE);

  return {
    port: Math.max(1, parseFiniteInteger(process.env.PORT, 8000)),
    pythonBin: process.env.PYTHON_BIN?.trim() || defaultPythonBin(),
    repoRoot,
    llm: {
      mode: llmMode,
      model:
        process.env.MAYUE_LLM_MODEL?.trim() ||
        (llmMode === "ollama" ? "qwen3:30b" : "Qwen/Qwen3-30B-A3B-Instruct-2507"),
      baseUrl: normalizeBaseUrl(llmMode, process.env.MAYUE_LLM_BASE_URL),
      apiKey: process.env.MAYUE_LLM_API_KEY?.trim() || "",
      think: parseBool(process.env.MAYUE_LLM_THINK, false),
      timeoutMs: Math.max(5_000, parseFiniteInteger(process.env.MAYUE_LLM_TIMEOUT_MS, 45_000)),
      maxToolRounds: Math.max(1, Math.min(10, parseFiniteInteger(process.env.MAYUE_LLM_MAX_TOOL_ROUNDS, 5))),
      temperature: Math.max(0, Math.min(1.5, parseFiniteNumber(process.env.MAYUE_LLM_TEMPERATURE, 0.2))),
    },
  };
}
