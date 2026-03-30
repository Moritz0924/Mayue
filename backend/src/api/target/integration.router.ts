import { Router } from "express";
import { asyncHandler } from "../middlewares/async.js";
import { getRecentAlerts } from "../../domain/alerts.js";

export function createIntegrationTargetRouter(): Router {
  const router = Router();

  /**
   * Export alerts for external systems. For now it simply proxies the recent
   * alerts list without any authentication or filtering. In a production
   * environment this endpoint would enforce auth and possibly adapt the
   * payload format.
   */
  router.get(
    "/integration/export/alerts",
    asyncHandler(async (_req, res) => {
      const alerts = getRecentAlerts(1000);
      res.json(alerts);
    })
  );

  return router;
}