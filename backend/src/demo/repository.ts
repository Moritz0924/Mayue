import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type TwinSceneElement = {
  element_id: string;
  name: string;
  shape: "box" | "cylinder";
  position: [number, number, number];
  size: [number, number, number];
  zone: string;
  material?: { base?: string };
};

export type TwinScene = {
  model_id: string;
  name: string;
  lod: string;
  elements: TwinSceneElement[];
};

export type SensorLayoutItem = {
  sensor_id: string;
  element_id: string;
  type: string;
  coord_local: [number, number, number];
  coord_bim: [number, number, number];
};

export type MaintenanceHistoryItem = {
  record_id: string;
  element_id: string;
  issue: string;
  action: string;
  result: string;
  priority: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DATA_ROOT = path.join(REPO_ROOT, "backend", "data");

async function readJson<T>(filePath: string): Promise<T> {
  const text = await fs.readFile(filePath, "utf-8");
  return JSON.parse(text) as T;
}

export function getRepoRoot(): string {
  return REPO_ROOT;
}

export function getBackendDataRoot(): string {
  return DATA_ROOT;
}

export async function loadTwinScene(modelId = "demo_tower"): Promise<TwinScene> {
  return readJson<TwinScene>(path.join(DATA_ROOT, "models", modelId, "scene.json"));
}

export async function loadSensorLayout(): Promise<SensorLayoutItem[]> {
  return readJson<SensorLayoutItem[]>(path.join(DATA_ROOT, "demo", "sensor_layout.json"));
}

export async function loadMaintenanceHistory(): Promise<MaintenanceHistoryItem[]> {
  return readJson<MaintenanceHistoryItem[]>(path.join(DATA_ROOT, "demo", "maintenance_history.json"));
}
