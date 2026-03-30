type Handler<T> = (payload: T) => void;

/**
 * Minimal in-memory pub/sub bus.
 *
 * Purpose:
 * - Decouple producers (telemetry ingest) from consumers (WS broadcast)
 * - Keep the code monolith-first but microservice-ready
 */
export class MemoryEventBus {
  private readonly topics = new Map<string, Set<Handler<any>>>();

  publish<T>(topic: string, payload: T): void {
    const set = this.topics.get(topic);
    if (!set || set.size === 0) return;
    // Copy to avoid issues if handlers unsubscribe during iteration
    for (const h of Array.from(set)) {
      try {
        (h as Handler<T>)(payload);
      } catch {
        // Swallow handler errors: a consumer must not crash the producer path.
      }
    }
  }

  subscribe<T>(topic: string, handler: Handler<T>): () => void {
    let set = this.topics.get(topic);
    if (!set) {
      set = new Set();
      this.topics.set(topic, set);
    }
    set.add(handler as Handler<any>);
    return () => {
      const s = this.topics.get(topic);
      if (!s) return;
      s.delete(handler as Handler<any>);
      if (s.size === 0) this.topics.delete(topic);
    };
  }
}

// Shared singleton for this process.
export const eventBus = new MemoryEventBus();

// Topic names (centralized to avoid typos).
export const TOPIC_TELEMETRY_LIVE = "telemetry.live";

// Topic for alert events. Consumers (e.g. WS stream or external integrations) should subscribe to this
// topic to receive new alerts. Alert payload shape is defined in src/domain/alerts.ts.
export const TOPIC_ALERTS = "alerts";
