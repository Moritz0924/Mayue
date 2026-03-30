import http from "node:http";
import { createHttpApp } from "./http.js";
import { attachMvpLiveWs } from "./ws.js";
import { attachStreamWs } from "./stream.js";
import { loadConfig } from "./config.js";
import { bootstrapDemoData } from "../demo/bootstrap.js";

export async function startServer(): Promise<void> {
  const cfg = loadConfig();
  await bootstrapDemoData();
  const app = createHttpApp();
  const server = http.createServer(app);

  attachMvpLiveWs(server);
  attachStreamWs(server);

  await new Promise<void>((resolve) => {
    server.listen(cfg.port, () => resolve());
  });

  console.log(`Mayue backend (Node) listening on http://localhost:${cfg.port}`);
}
