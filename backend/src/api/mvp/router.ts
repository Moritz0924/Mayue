import { Router } from "express";
import { z } from "zod";
import { listModels, listElements } from "../../core/modelStore.js";
import { analyzeTimeseries, type Point } from "../../core/baseline.js";
import { recordAlert } from "../../domain/alerts.js";
import { eventBus, TOPIC_ALERTS } from "../../infra/bus/eventBus.memory.js";
import { generateTimeseries } from "./timeseries.js";
import { asyncHandler } from "../middlewares/async.js";
import { badRequest } from "../../domain/common/errors.js";

export const mvpRouter = Router();

// REST: /api/models
mvpRouter.get(
  "/api/models",
  asyncHandler(async (_req, res) => {
    res.json(await listModels());
  })
);

// REST: /api/models/:model_id/elements
mvpRouter.get(
  "/api/models/:model_id/elements",
  asyncHandler(async (req, res) => {
    const out = await listElements(req.params.model_id);
    res.json(out);
  })
);

// REST: /api/elements/:element_id/timeseries?metric=disp&n=120
mvpRouter.get(
  "/api/elements/:element_id/timeseries",
  asyncHandler(async (req, res) => {
    const metric = String(req.query.metric ?? "disp").trim() as "disp" | "vib" | "temp";
    if (!metric) throw badRequest("metric is required");
    if (metric !== "disp" && metric !== "vib" && metric !== "temp") {
      throw badRequest("metric must be one of: disp, vib, temp");
    }

    const nRaw = Number(req.query.n ?? 120);
    const n = Math.max(1, Math.min(5000, Number.isFinite(nRaw) ? Math.floor(nRaw) : 120));

    const series = generateTimeseries(req.params.element_id, metric, n);
    res.json({ element_id: req.params.element_id, metric, series });
  })
);

// REST: /api/elements/:element_id/analyze
const AnalyzeReq = z.object({
  metric: z.enum(["disp", "vib", "temp"]).default("disp"),
  horizon: z.number().int().min(1).default(60),
});
mvpRouter.post(
  "/api/elements/:element_id/analyze",
  asyncHandler(async (req, res) => {
    const parsed = AnalyzeReq.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw badRequest("invalid request body");
    }
    const { metric, horizon } = parsed.data;
    const series: Point[] = generateTimeseries(req.params.element_id, metric, horizon);
    const result = analyzeTimeseries(series);
    // If the baseline risk indicates a potential issue, raise an alert. L1=MEDIUM, L2=HIGH.
    if (result.risk === "MEDIUM" || result.risk === "HIGH") {
      const level = result.risk === "HIGH" ? "L2" : "L1";
      const alert = recordAlert({
        element_id: req.params.element_id,
        level,
        metric,
        trigger_ts_ms: Date.now(),
        note: result.note,
      });
      // Publish alert on the event bus so WS stream subscribers can receive it
      eventBus.publish(TOPIC_ALERTS, alert);
    }
    res.json({
      element_id: req.params.element_id,
      metric,
      risk: result.risk,
      score: result.score,
      note: result.note,
    });
  })
);
