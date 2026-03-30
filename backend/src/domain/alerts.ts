import { type Metric } from "../infra/cache/telemetryRingBuffer.js";

/**
 * Alert object as defined in the combined API contract.
 *
 * - alert_id: unique identifier (UUID v4-ish) generated when the alert is created
 * - element_id: ID of the affected element
 * - level: severity level, mapped from risk (L1 for MEDIUM, L2 for HIGH, L3 reserved)
 * - metric: telemetry metric associated with the alert
 * - trigger_ts_ms: when the condition triggering the alert occurred (ms since epoch)
 * - emit_ts_ms: when the alert was emitted by the backend (ms since epoch)
 * - note: optional textual note for additional context
 */
export interface Alert {
  alert_id: string;
  element_id: string;
  level: "L1" | "L2" | "L3";
  metric: Metric;
  trigger_ts_ms: number;
  emit_ts_ms: number;
  note?: string;
}

export type AlertSeed = Omit<Alert, "alert_id" | "emit_ts_ms"> & { emit_ts_ms?: number };

// In‑memory store for recent alerts. To avoid unbounded growth we cap the length.
const MAX_ALERTS = 1000;
const alertStore: Alert[] = [];

/**
 * Generate a simple pseudo‑UUID for alerts.
 * In a real implementation you would use a proper UUID generator.
 */
function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Record a new alert in the in‑memory store and return it.
 */
export function recordAlert(partial: AlertSeed): Alert {
  const alert: Alert = {
    alert_id: genId(),
    emit_ts_ms: partial.emit_ts_ms ?? Date.now(),
    ...partial,
  };
  alertStore.push(alert);
  // Trim to MAX_ALERTS
  if (alertStore.length > MAX_ALERTS) {
    alertStore.splice(0, alertStore.length - MAX_ALERTS);
  }
  return alert;
}

export function findRecentMatchingAlert(partial: Omit<AlertSeed, "emit_ts_ms">, within_ms = 5 * 60 * 1000): Alert | null {
  const threshold = Date.now() - Math.max(0, within_ms);
  for (let i = alertStore.length - 1; i >= 0; i--) {
    const item = alertStore[i]!;
    if (item.emit_ts_ms < threshold) break;
    if (
      item.element_id === partial.element_id
      && item.level === partial.level
      && item.metric === partial.metric
      && item.note === partial.note
    ) {
      return item;
    }
  }
  return null;
}

/**
 * Retrieve recent alerts. If a limit is provided, only the most recent `limit` alerts
 * will be returned. The list is ordered from oldest to newest.
 */
export function getRecentAlerts(limit = 100): Alert[] {
  const n = Math.max(1, Math.min(limit, alertStore.length));
  return alertStore.slice(alertStore.length - n);
}