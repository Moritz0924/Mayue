import { Router } from "express";
import { asyncHandler } from "../middlewares/async.js";
import { badRequest } from "../../domain/common/errors.js";
import { getRecentAlerts } from "../../domain/alerts.js";

export function createAlertsTargetRouter(): Router {
  const router = Router();

  // GET /api/alerts/recent?limit=100
  router.get(
    "/alerts/recent",
    asyncHandler(async (req, res) => {
      const limitRaw = req.query.limit;
      let limit = 100;
      if (limitRaw !== undefined) {
        const n = Number(limitRaw);
        if (Number.isFinite(n) && n >= 1 && n <= 1000) {
          limit = Math.floor(n);
        } else {
          throw badRequest("limit must be between 1 and 1000");
        }
      }
      const alerts = getRecentAlerts(limit);
      res.json(alerts);
    })
  );

  return router;
}