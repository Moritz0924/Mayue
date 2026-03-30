import { Router } from "express";
import { asyncHandler } from "../middlewares/async.js";
import { badRequest } from "../../domain/common/errors.js";
import { buildFeatureVector } from "../../services/featureEngineering.js";
import { runPythonTask } from "../../services/pythonBridge.js";
import { assertElementTelemetry, assertKnownElementId } from "../../services/elementGuard.js";

export function createPredictTargetRouter(): Router {
  const router = Router();

  router.post(
    "/predict/displacement",
    asyncHandler(async (req, res) => {
      const body = req.body as any;
      if (!body || typeof body !== "object") throw badRequest("body is required");
      const element_id = typeof body.element_id === "string" ? body.element_id.trim() : "";
      if (!element_id) throw badRequest("element_id is required");
      const horizon = Number(body.horizon ?? 36);
      if (!Number.isFinite(horizon) || horizon < 1 || horizon > 300) throw badRequest("horizon must be in [1, 300]");

      const hasFeatureVector = Array.isArray(body.features_64) && body.features_64.length === 64;
      if (hasFeatureVector) {
        await assertKnownElementId(element_id);
      } else {
        await assertElementTelemetry(element_id, ["disp"]);
      }

      const featurePack = hasFeatureVector
        ? {
            features_64: body.features_64.map((v: unknown) => Number(v)),
            history: Array.isArray(body.history) ? body.history : undefined,
            generated_at_ts_ms: Date.now(),
          }
        : buildFeatureVector(element_id);

      const result = await runPythonTask<{
        pred: Array<{ ts_ms: number; disp: number }>;
        confidence: number;
        trend_slope_mm_per_step: number;
        threshold_mm: number;
        breach_ts_ms?: number | null;
        model_version: string;
      }>("predict_displacement", {
        element_id,
        features_64: featurePack.features_64,
        history: featurePack.history,
        horizon: Math.floor(horizon),
        step_sec: Number(body.step_sec ?? 5),
        base_ts_ms: featurePack.generated_at_ts_ms,
        current_disp: featurePack.features_64[0],
        threshold_mm: Number(body.threshold_mm ?? 1.5),
      });

      res.json({
        element_id,
        horizon: Math.floor(horizon),
        pred: result.pred,
        confidence: result.confidence,
        model_version: result.model_version,
        breach_ts_ms: result.breach_ts_ms ?? null,
        trend_slope_mm_per_step: result.trend_slope_mm_per_step,
      });
    })
  );

  return router;
}
