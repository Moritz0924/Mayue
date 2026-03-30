import { notFound } from "../domain/common/errors.js";
import { telemetryRingBuffer, type Metric } from "../infra/cache/telemetryRingBuffer.js";
import { loadTwinScene } from "../demo/repository.js";

const DEFAULT_MODEL_ID = "demo_tower";

export async function assertKnownElementId(element_id: string): Promise<void> {
  const scene = await loadTwinScene(DEFAULT_MODEL_ID);
  const exists = scene.elements.some((item) => item.element_id === element_id);
  if (!exists) {
    throw notFound("ELEMENT_NOT_FOUND", `unknown element_id: ${element_id}`);
  }
}

export async function assertElementTelemetry(element_id: string, metrics: Metric[]): Promise<void> {
  await assertKnownElementId(element_id);
  const hasAnyMetric = metrics.some((metric) => telemetryRingBuffer.latestValue(element_id, metric) != null);
  if (!hasAnyMetric) {
    throw notFound("ELEMENT_NOT_FOUND", `no telemetry available for element_id: ${element_id}`);
  }
}