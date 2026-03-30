import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "../domain/common/errors.js";

export type ModelItem = { model_id: string; name: string };
export type ElementItem = { element_id: string; name: string };

// Resolve repo root from ESM `import.meta.url` (works in TS build output too)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", ".."); // backend_node/src/core -> repo root
const MODEL_DIR = path.join(REPO_ROOT, "backend", "data", "models");

export async function listModels(): Promise<ModelItem[]> {
  try {
    const entries = await fs.readdir(MODEL_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => ({ model_id: e.name, name: e.name }));
  } catch {
    return [];
  }
}

async function loadMap(modelId: string): Promise<any> {
  const p = path.join(MODEL_DIR, modelId, "building_lite.map.json");
  let text: string;
  try {
    text = (await fs.readFile(p, "utf-8")).trim();
  } catch {
    throw new AppError(404, "MODEL_NOT_FOUND", `Model ${modelId} not found`);
  }
  if (!text) {
    throw new AppError(400, "INVALID_ARGUMENT", `Model ${modelId} map.json is empty`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, "INVALID_ARGUMENT", `Model ${modelId} map.json is invalid`);
  }
}

export async function listElements(modelId: string): Promise<ElementItem[]> {
  const m = await loadMap(modelId);
  const elems = Array.isArray(m?.elements) ? m.elements : [];
  return elems.map((e: any) => ({
    element_id: String(e?.element_id ?? ""),
    name: String(e?.name ?? ""),
  }));
}