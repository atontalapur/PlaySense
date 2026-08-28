import { fetchEvents } from './feeds/index.js';

export const DEFAULT_INTERVAL_MS = 10000;

export function createPoller({
  feed,
  eventId,
  onEvents,
  onFailure = () => {},
  fetchImpl = fetch,
  intervalMs = DEFAULT_INTERVAL_MS
}) {
  const seen = new Set();
  let timer = null;
  let stopped = false;

  async function tick() {
    if (stopped) return;

    const result = await fetchEvents(feed, eventId, fetchImpl);
    if (stopped) return;
    if (!result.ok) {
      onFailure(result.reason);
      return;
    }

    // Filter and mark in one pass. Computing `fresh` before marking would let
    // two copies of one id inside a single batch both survive the filter.
    const fresh = [];
    for (const e of result.events) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      fresh.push(e);
    }
    // Awaited: Task 15 makes the session's emit() async (it awaits the
    // explainer per event). A bare call would make emission fire-and-forget
    // and let two overlapping ticks deliver events out of order.
    if (fresh.length > 0) await onEvents(fresh);
  }

  return {
    tick,
    seenCount: () => seen.size,
    start() {
      stopped = false;
      tick();
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
