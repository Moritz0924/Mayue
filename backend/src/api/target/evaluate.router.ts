import { Router } from "express";
import { asyncHandler } from "../middlewares/async.js";
import { badRequest } from "../../domain/common/errors.js";
import { buildVibrationSignal } from "../../services/featureEngineering.js";
import { runPythonTask } from "../../services/pythonBridge.js";
import { assertElementTelemetry, assertKnownElementId } from "../../services/elementGuard.js";

export function createEvaluateTargetRouter(): Router {
  const router = Router();

  router.post(
    "/evaluate/vibration",
    asyncHandler(async (req, res) => {
      const body = req.body as any;
      if (!body || typeof body !== "object") throw badRequest("body is required");
      const element_id = typeof body.element_id === "string" ? body.element_id.trim() : "";
      if (!element_id) throw badRequest("element_id is required");
      const fs_hz = Number(body.fs_hz ?? 128);
      const window_ms = Number(body.window_ms ?? 5 * 60 * 1000);
      if (!Number.isFinite(fs_hz) || fs_hz < 1 || fs_hz > 50000) throw badRequest("fs_hz must be between 1 and 50000");
      if (!Number.isFinite(window_ms) || window_ms < 100 || window_ms > 600000) {
        throw badRequest("window_ms must be between 100 and 600000");
      }

      const hasSignal = Array.isArray(body.signal) && body.signal.length >= 32;
      if (hasSignal) {
        await assertKnownElementId(element_id);
      } else {
        await assertElementTelemetry(element_id, ["vib"]);
      }

      const signal = hasSignal
        ? body.signal.map((v: unknown) => Number(v))
        : buildVibrationSignal(element_id, { size: 256, window_ms: Math.floor(window_ms) });

      const result = await runPythonTask<{
        label: string;
        prob: number;
        probs: Record<string, number>;
        rms: number;
        dominant_freq_hz: number;
        model_version: string;
      }>("evaluate_vibration", {
        element_id,
        signal,
        fs_hz,
        window_ms,
      });

      res.json({
        element_id,
        label: result.label,
        prob: result.prob,
        probs: result.probs,
        dominant_freq_hz: result.dominant_freq_hz,
        model_version: result.model_version,
      });
    })
  );

  return router;
}
