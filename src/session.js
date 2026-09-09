import { detectGame, feedForSport } from './feeds/index.js';
import { createPoller } from './poller.js';
import { createDomScrapeFeed, createTabScrapeFetch } from './feeds/dom-scrape.js';
import { IMPORTANCE } from './events.js';
import { resolveF1Session, describeF1Unavailable } from './feeds/f1-session.js';

// How many of the plays swallowed by the priming fetch are replayed as context
// when monitoring starts. Enough that the overlay opens with something real in
// it rather than blank; small enough that the paid explainer calls it costs are
// a fixed, trivial ceiling rather than a function of how long the game has run.
export const RECAP_EVENTS = 2;

export function createSession({ tabId, url, deps, seed = [] }) {
  const detected = detectGame(url);
  let poller = null;
  // Held between start() and the first pump() rather than emitted from start()
  // itself. background.js only adds the session to its map AFTER start()
  // resolves, and the Claude explainer's isCancelled is bound to membership of
  // that map — emitting here would read as "the user stopped monitoring" and
  // silently drop every recap event to the rules tier.
  let pendingRecap = [];
  let degraded = false;
  let finished = false;
  // Set only by stop(). emit() reads this rather than `poller === null`,
  // because switchToFinished also nulls the poller and the final plays of a
  // game are exactly the ones that must still be delivered.
  let halted = false;
  // Why start() refused, when it did. F1 pages are real game pages that simply
  // have no session running, and saying "not a supported live game" there is
  // what made the wrong-session bug hard to spot.
  let unavailable = null;

  const state = () => ({
    sport: detected ? detected.sport : null,
    eventId: detected ? detected.eventId : null,
    degraded,
    finished,
    active: poller !== null,
    unavailable
  });

  // Spec 4.3: the game is over, so there is nothing left to poll for. Retains
  // seenIds() via the seed swap so a caller that persists them still can.
  async function switchToFinished() {
    if (finished) return;
    finished = true;
    seed = poller ? poller.seenIds() : seed;
    if (poller) poller.stop();
    poller = null;
    await deps.sendToTab(tabId, { action: 'finished' });
  }

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
      // Deliberately not `!poller`: an overlapping beat can finish the game
      // while this loop is mid-flight, and truncating there would drop final
      // plays whose ids poller.tick() has already marked seen.
      if (halted) break;
      const explanation = deps.explainer ? await deps.explainer.explain(event) : null;
      explained.push({ ...event, explanation });
    }
    if (explained.length === 0) return;
    await deps.sendToTab(tabId, { action: 'events', events: explained });
  }

  // Never gated on `halted` the way emit() is: a status line costs nothing and
  // sends no paid call, and the last thing a stopping session reports should be
  // the true state of the game.
  async function sendStatus(status) {
    if (!status) return;
    await deps.sendToTab(tabId, { action: 'status', status });
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
    unavailableReason: () => unavailable,
    seenIds: () => (poller ? poller.seenIds() : seed),
    async start() {
      if (!detected) return false;

      // F1 is the one sport whose feed id is not in the URL. Resolving it is
      // also the only chance to notice that the page's race is not running,
      // which is the difference between explaining this race and replaying an
      // unrelated one.
      let eventId = detected.eventId;
      if (detected.sport === 'f1') {
        const resolved = await resolveF1Session({
          raceId: detected.pageId,
          fetchImpl: deps.fetchImpl,
          now: deps.now ? deps.now() : new Date()
        });
        if (!resolved || resolved.phase !== 'live') {
          unavailable = describeF1Unavailable(resolved);
          return false;
        }
        eventId = resolved.sessionKey;
      }

      poller = createPoller({
        feed: feedForSport(detected.sport),
        eventId,
        fetchImpl: deps.fetchImpl,
        onEvents: (evts) => emit(evts),
        onStatus: (status) => sendStatus(status),
        onFailure: (reason) => switchToDegraded(reason),
        // Only the structured feeds can report a finished game; the DOM
        // scraper's gameState is always null, so the degraded poller needs no
        // equivalent.
        onFinished: () => switchToFinished(),
        seed
      });

      // Only a session with no history primes. A seeded session is a worker
      // that restarted mid-game: it already knows where it left off, and
      // swallowing the feed again would silently eat whatever happened while
      // the worker was down.
      if (seed.length === 0) {
        const primed = await poller.prime();
        if (primed.ok) {
          pendingRecap = primed.events
            .filter(e => e.importance === IMPORTANCE.HIGH)
            .slice(-RECAP_EVENTS);
        }
      }
      return true;
    },
    // One poll cycle. When the first tick trips the fallback, the second drives
    // the freshly-created degraded poller so no cycle is lost.
    async pump() {
      if (!poller) return;
      if (pendingRecap.length > 0) {
        // Cleared before the await, not after: emit() is long (one explainer
        // call per event) and a second beat landing mid-flight must not send
        // the same recap twice.
        const recap = pendingRecap;
        pendingRecap = [];
        await emit(recap);
      }
      await poller.tick();
      if (degraded && poller) await poller.tick();
    },
    stop() {
      halted = true;
      pendingRecap = [];
      if (poller) poller.stop();
      poller = null;
    }
  };
}
