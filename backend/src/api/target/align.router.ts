import { Router } from "express";
import { asyncHandler } from "../middlewares/async.js";
import { badRequest } from "../../domain/common/errors.js";
import { runPythonTask } from "../../services/pythonBridge.js";

export function createAlignTargetRouter(): Router {
  const router = Router();

  router.post(
    "/align/spatial",
    asyncHandler(async (req, res) => {
      const body = req.body as any;
      if (!body || typeof body !== "object") throw badRequest("body is required");
      if (typeof body.model_id !== "string" || !body.model_id.trim()) throw badRequest("model_id is required");
      if (body.method !== "least_squares") throw badRequest("method must be least_squares");
      if (!Array.isArray(body.pairs) || body.pairs.length < 3) throw badRequest("pairs must contain at least 3 items");
      const result = await runPythonTask<{ R: number[][]; t: number[]; rmse_mm: number }>("align_spatial", {
        model_id: body.model_id,
        pairs: body.pairs,
      });
      res.json(result);
    })
  );

  router.post(
    "/align/temporal",
    asyncHandler(async (req, res) => {
      const body = req.body as any;
      if (!body || typeof body !== "object") throw badRequest("body is required");
      if (body.method !== "dtw") throw badRequest("method must be dtw");
      if (!Array.isArray(body.sensor_series) || body.sensor_series.length === 0) throw badRequest("sensor_series is required");
      if (!Array.isArray(body.bim_timeline) || body.bim_timeline.length === 0) throw badRequest("bim_timeline is required");
      const result = await runPythonTask<{ aligned: any[]; path_len: number; cost: number; max_offset_ms: number }>(
        "align_temporal",
        {
          sensor_series: body.sensor_series,
          bim_timeline: body.bim_timeline,
        }
      );
      res.json(result);
    })
  );

  return router;
}
