import { WebSocketServer, WebSocket } from "ws";
import type http from "node:http";
import { eventBus, TOPIC_TELEMETRY_LIVE, TOPIC_ALERTS } from "../infra/bus/eventBus.memory.js";

interface Subscription {
  topics: Set<string>;
  filter?: {
    element_id?: string[];
  };
}

/**
 * Attach the subscription‑based WebSocket endpoint (/ws/stream) to an HTTP server.
 *
 * Clients can subscribe to topics (e.g. telemetry.live, alerts) and optionally
 * filter by element_id. Messages are sent with a wrapper containing the topic
 * name, the data payload and a server_ts_ms timestamp.
 */
export function attachStreamWs(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<WebSocket, Subscription>();

  function sendEvent(topic: string, payload: any): void {
    const server_ts_ms = Date.now();
    const msg = JSON.stringify({ topic, data: payload, server_ts_ms });
    for (const [ws, sub] of clients.entries()) {
      if (ws.readyState !== ws.OPEN) continue;
      if (!sub.topics.has(topic)) continue;
      // Filter on element_id if provided
      if (sub.filter?.element_id && payload.element_id) {
        const allowed = sub.filter.element_id;
        if (!allowed.includes(String(payload.element_id))) continue;
      }
      try {
        ws.send(msg);
      } catch {
        // Ignore errors; the connection may be closed later
      }
    }
  }

  // Subscribe to event bus topics and forward to WS clients
  const unsubTelemetry = eventBus.subscribe<any>(TOPIC_TELEMETRY_LIVE, (data) => {
    sendEvent("telemetry.live", data);
  });
  const unsubAlerts = eventBus.subscribe<any>(TOPIC_ALERTS, (data) => {
    sendEvent("alerts", data);
  });

  server.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url ?? "", `http://${req.headers.host}`);
      if (url.pathname !== "/ws/stream") {
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on("connection", (ws) => {
    // Initialize empty subscription
    clients.set(ws, { topics: new Set() });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg && msg.op === "subscribe" && Array.isArray(msg.topics)) {
          const sub = clients.get(ws);
          if (!sub) return;
          sub.topics = new Set(msg.topics);
          if (msg.filter && typeof msg.filter === "object") {
            sub.filter = {};
            if (Array.isArray(msg.filter.element_id)) {
              sub.filter.element_id = msg.filter.element_id.map((id: any) => String(id));
            }
          }
        }
      } catch {
        // ignore invalid messages
      }
    });
    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  server.on("close", () => {
    unsubTelemetry();
    unsubAlerts();
    clients.clear();
  });
}