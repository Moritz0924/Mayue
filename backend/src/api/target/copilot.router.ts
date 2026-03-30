import { Router } from "express";
import { asyncHandler } from "../middlewares/async.js";
import { badRequest } from "../../domain/common/errors.js";
import { getCopilotRuntimeStatus, runCopilot } from "../../services/copilot.js";

export function createCopilotTargetRouter(): Router {
  const router = Router();

  router.get(
    "/copilot/status",
    asyncHandler(async (_req, res) => {
      res.json(getCopilotRuntimeStatus());
    })
  );

  router.post(
    "/copilot/maintenance-plan",
    asyncHandler(async (req, res) => {
      const element_id = typeof req.body?.element_id === "string" ? req.body.element_id.trim() : "";
      const horizon_sec = Number(req.body?.horizon_sec ?? 36);
      if (!element_id) throw badRequest("element_id is required");
      if (!Number.isFinite(horizon_sec) || horizon_sec < 5 || horizon_sec > 300) {
        throw badRequest("horizon_sec must be between 5 and 300");
      }
      const result = await runCopilot(element_id, Math.floor(horizon_sec));
      res.json(result);
    })
  );

  return router;
}
