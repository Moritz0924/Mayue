import { WebSocketServer, WebSocket } from "ws";
import type http from "node:http";
import { eventBus, TOPIC_TELEMETRY_LIVE } from "../infra/bus/eventBus.memory.js";

export type LiveMessage = {
  element_id: string;
  metric: string;
  t: number;
  v: number;
};

/**
 * MVP WebSocket: /ws/live
 * - Broadcast-style push
 * - Legacy payload with seconds timestamp `t`
 */
export function attachMvpLiveWs(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });

  const clients = new Set<WebSocket>();

  // Bridge: telemetry ingest -> in-memory bus -> WS broadcast.
  // Policy: drop messages for slow clients (bufferedAmount too large) to avoid backpressure.
  const unsubscribe = eventBus.subscribe<LiveMessage>(TOPIC_TELEMETRY_LIVE, (msg) => {
    const payload = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      // If the socket is falling behind, drop this message for that client.
      if (ws.bufferedAmount > 1_000_000) continue;
      try {
        ws.send(payload);
      } catch {
        // ignore send failures
      }
    }
  });

  server.on("upgrade", async (req, socket, head) => {
    try {
      const url = new URL(req.url ?? "", `http://${req.headers.host}`);
      if (url.pathname !== "/ws/live") {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on("connection", async (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
  });

  // Ensure we unsubscribe if the server shuts down.
  server.on("close", () => {
    unsubscribe();
    clients.clear();
  });
}
