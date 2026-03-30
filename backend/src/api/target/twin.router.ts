import { Router } from "express";
import { asyncHandler } from "../middlewares/async.js";
import { badRequest } from "../../domain/common/errors.js";
import { loadTwinScene } from "../../demo/repository.js";
import { telemetryRingBuffer } from "../../infra/cache/telemetryRingBuffer.js";
import { getRecentAlerts } from "../../domain/alerts.js";

function levelForElement(elementId: string): { level: string; color: string } {
  const recent = getRecentAlerts(200).filter((item) => item.element_id === elementId);
  const latest = recent[recent.length - 1];
  if (!latest) return { level: "NORMAL", color: "#4CAF50" };
  if (latest.level === "L2") return { level: "HIGH", color: "#E53935" };
  if (latest.level === "L1") return { level: "MEDIUM", color: "#FB8C00" };
  return { level: "NORMAL", color: "#4CAF50" };
}

export function createTwinTargetRouter(): Router {
  const router = Router();

  router.get(
    "/twin/scene",
    asyncHandler(async (req, res) => {
      const model_id = typeof req.query.model_id === "string" ? req.query.model_id : "demo_tower";
      const scene = await loadTwinScene(model_id);
      const enriched = scene.elements.map((element) => {
        const latest = telemetryRingBuffer.latestSnapshot(element.element_id, ["disp", "vib", "temp", "wind"]);
        const alert = levelForElement(element.element_id);
        return {
          ...element,
          status: alert.level,
          color: alert.color,
          latest_metrics: {
            disp: latest.disp?.value ?? null,
            vib: latest.vib?.value ?? null,
            temp: latest.temp?.value ?? null,
            wind: latest.wind?.value ?? null,
          },
        };
      });
      res.json({ ...scene, elements: enriched, generated_at_ts_ms: Date.now() });
    })
  );

  router.get(
    "/twin/elements/:element_id",
    asyncHandler(async (req, res) => {
      const element_id = req.params.element_id?.trim();
      if (!element_id) throw badRequest("element_id is required");
      const scene = await loadTwinScene("demo_tower");
      const element = scene.elements.find((item) => item.element_id === element_id);
      if (!element) throw badRequest("unknown element_id");
      const metrics = telemetryRingBuffer.latestSnapshot(element_id);
      const alerts = getRecentAlerts(100).filter((item) => item.element_id === element_id);
      res.json({
        ...element,
        latest_metrics: Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, value?.value ?? null])),
        alerts,
      });
    })
  );

  return router;
}
