import { detectGame, feedForSport } from './feeds/index.js';
import { createPoller } from './poller.js';
import { createDomScrapeFeed, createTabScrapeFetch } from './feeds/dom-scrape.js';
import { IMPORTANCE } from './events.js';

export function createSession({ tabId, url, deps, seed = [] }) {
  const detected = detectGame(url);
  let poller = null;
  let degraded = false;

  const state = () => ({
    sport: detected ? detected.sport : null,
    eventId: detected ? detected.eventId : null,
    degraded,
    active: poller !== null
  });

  // Low importance is suppressed entirely; it never reaches the overlay.
  // Both createPoller call sites pass this as an expression-bodied arrow so the
  // promise reaches poller.tick()'s await. A block body would return undefined,
  // making emission fire-and-forget: tick() marks ids seen synchronously, so the
  // worker could be terminated mid-backlog with those events already persisted
  // as seen and their paid explainer calls billed but never delivered.
  async function emit(events) {
    const shown = events.filter(e => e.importance !== IMPORTANCE.LOW);
    if (shown.length === 0) return;

    const explained = [];
    for (const event of shown) {
      // Stop halts the REMAINING backlog. The first pump of a live game can
      // carry ~32 high-importance events, each a multi-second paid call; a user
      // who stops monitoring partway must not be billed for the rest of the loop.
      if (!poller) break;
      const explanation = deps.explainer ? await deps.explainer.explain(event) : null;
      explained.push({ ...event, explanation });
    }
    if (explained.length === 0) return;
    await deps.sendToTab(tabId, { action: 'events', events: explained });
  }

  async function switchToDegraded(reason) {
    if (degraded) return;
    degraded = true;
    // Carry the seen ids across the swap, or the scrape feed replays the game.
    const carried = poller ? poller.seenIds() : seed;
    if (poller) poller.stop();
    await deps.sendToTab(tabId, { action: 'degraded', reason });
    poller = createPoller({
      feed: createDomScrapeFeed(detected.sport),
      eventId: detected.eventId,
      fetchImpl: createTabScrapeFetch(tabId, deps.sendToTab),
      onEvents: (evts) => emit(evts),
      seed: carried
    });
  }

  return {
    state,
    seenIds: () => (poller ? poller.seenIds() : seed),
    async start() {
      if (!detected) return false;
      poller = createPoller({
        feed: feedForSport(detected.sport),
        eventId: detected.eventId,
        fetchImpl: deps.fetchImpl,
        onEvents: (evts) => emit(evts),
        onFailure: (reason) => switchToDegraded(reason),
        seed
      });
      return true;
    },
    // One poll cycle. When the first tick trips the fallback, the second drives
    // the freshly-created degraded poller so no cycle is lost.
    async pump() {
      if (!poller) return;
      await poller.tick();
      if (degraded && poller) await poller.tick();
    },
    stop() {
      if (poller) poller.stop();
      poller = null;
    }
  };
}
