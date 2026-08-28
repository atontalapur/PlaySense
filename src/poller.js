import { fetchEvents } from './feeds/index.js';

export const DEFAULT_INTERVAL_MS = 10000;

// Consecutive empty-but-successful polls tolerated before the feed is treated
// as broken (spec 4.2). Three polls is 30 seconds at the 10s beat. It has to
// clear two legitimate sources of emptiness: a game whose state has just
// flipped from 'pre' to 'in' but whose first play has not posted yet, and the
// natural gaps between plays. Even the slowest of these feeds moves inside 30s
// once a game is genuinely under way — an NFL play clock is 40 seconds but the
// feed carries the whole game's backlog, not just the newest play, so a live
// game is only ever empty here if the shape we read has stopped existing.
export const EMPTY_POLLS_BEFORE_DEGRADE = 3;

export function createPoller({
  feed,
  eventId,
  onEvents,
  onFailure = () => {},
  onFinished = () => {},
  fetchImpl = fetch,
  intervalMs = DEFAULT_INTERVAL_MS,
  seed = []
}) {
  // Seeded from chrome.storage.session so a terminated-and-restarted service
  // worker does not treat the whole game as new. See Task 9.
  const seen = new Set(seed);
  let timer = null;
  let stopped = false;
  let emptyPolls = 0;
  // Some feeds are legitimately sparse (see emptyIsFailure on OpenF1Feed and
  // the DOM scraper), so the empty-poll rule is opt-out per feed.
  const emptyIsFailure = feed.emptyIsFailure !== false;

  async function tick() {
    if (stopped) return;

    const result = await fetchEvents(feed, eventId, fetchImpl);
    if (stopped) return;
    if (!result.ok) {
      onFailure(result.reason);
      return;
    }

    // Spec 4.2: an empty play list is a degradation signal too, because the
    // likeliest form of an ESPN change is a silent rename that still returns a
    // valid 200. A 'pre' game is exempt — it has no plays yet by definition.
    // Counted on the feed's whole response, not on `fresh` below: a live game
    // whose plays we have all seen already is working perfectly.
    if (emptyIsFailure && result.state !== 'pre') {
      if (result.events.length === 0) {
        emptyPolls += 1;
        if (emptyPolls >= EMPTY_POLLS_BEFORE_DEGRADE) {
          onFailure('empty-feed');
          return;
        }
      } else {
        emptyPolls = 0;
      }
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

    // Spec 4.3: stop once the game is over. Checked AFTER emission so the plays
    // that ended the game are still delivered. Stopping here rather than in the
    // caller means an in-flight tick cannot re-fetch a finished game.
    if (result.state === 'post') {
      stopped = true;
      await onFinished();
    }
  }

  return {
    tick,
    seenCount: () => seen.size,
    seenIds: () => Array.from(seen),
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
