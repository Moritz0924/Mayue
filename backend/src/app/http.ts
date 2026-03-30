import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import { mvpRouter } from "../api/mvp/router.js";
import { createTelemetryTargetRouter } from "../api/target/telemetry.router.js";
import { createAlignTargetRouter } from "../api/target/align.router.js";
import { createPredictTargetRouter } from "../api/target/predict.router.js";
import { createEvaluateTargetRouter } from "../api/target/evaluate.router.js";
import { createAlertsTargetRouter } from "../api/target/alerts.router.js";
import { createIntegrationTargetRouter } from "../api/target/integration.router.js";
import { createTwinTargetRouter } from "../api/target/twin.router.js";
import { createCopilotTargetRouter } from "../api/target/copilot.router.js";
import { traceMiddleware } from "../api/middlewares/trace.middleware.js";
import { notFoundMiddleware } from "../api/middlewares/notfound.middleware.js";
import { errorMiddleware } from "../api/middlewares/error.middleware.js";
import { getCopilotRuntimeStatus } from "../services/copilot.js";
import { loadConfig } from "./config.js";

export function createHttpApp(): Express {
  const app = express();
  const cfg = loadConfig();

  app.use(express.json({ limit: "20mb" }));
  app.use(cors());
  app.use(traceMiddleware);

  app.use(mvpRouter);
  app.use("/api", createTelemetryTargetRouter());
  app.use("/api", createAlignTargetRouter());
  app.use("/api", createPredictTargetRouter());
  app.use("/api", createEvaluateTargetRouter());
  app.use("/api", createAlertsTargetRouter());
  app.use("/api", createIntegrationTargetRouter());
  app.use("/api", createTwinTargetRouter());
  app.use("/api", createCopilotTargetRouter());

  app.use("/demo", express.static(path.join(cfg.repoRoot, "backend", "public")));

  app.get("/healthz", (_req, res) =>
    res.status(200).json({
      ok: true,
      demo_ready: true,
      twin_demo: "/demo/twin-demo.html",
      llm: getCopilotRuntimeStatus(),
    })
  );

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
