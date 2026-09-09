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

// Consecutive polls tolerated where the feed DID return rows but none of them
// survived parsing. Far longer than the empty threshold (5 minutes at the 10s
// beat) because this state is ambiguous: it is what a field-level rename looks
// like, but it is also normal at the start of an MLB game, where the parser
// keeps only narrative 'Play Result' rows and the opening at-bat produces none
// for a minute or more. Degrading falsely costs the user the AI tier for the
// whole game, since degradation is one-way and scraped text never reaches the
// model — so this side errs long.
export const UNPARSED_POLLS_BEFORE_DEGRADE = 30;

// Consecutive fetch failures tolerated before the feed is treated as broken.
// This side used to degrade on the very first failure, while the two rules
// below deliberately waited 3 and 30 polls — so a single ESPN 502, or one beat
// during a wifi blip, cost the user the AI tier for the rest of the game.
// Degradation is one-way and scraped text never reaches the model, so a
// transient failure has to be as survivable here as an empty poll is.
export const FETCH_FAILURES_BEFORE_DEGRADE = 3;

export function createPoller({
  feed,
  eventId,
  onEvents,
  onStatus = () => {},
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
  let unparsedPolls = 0;
  let fetchFailures = 0;
  // Last line reported, so an unchanged status is not re-sent every 10 seconds.
  let lastStatus = null;
  // Some feeds are legitimately sparse (see emptyIsFailure on OpenF1Feed and
  // the DOM scraper), so the empty-poll rule is opt-out per feed.
  const emptyIsFailure = feed.emptyIsFailure !== false;

  async function tick() {
    if (stopped) return;

    const result = await fetchEvents(feed, eventId, fetchImpl);
    if (stopped) return;
    if (!result.ok) {
      fetchFailures += 1;
      // Awaited, like the two below: onFailure swaps the caller's poller and
      // messages the tab, and an unawaited rejection here has nowhere to go.
      if (fetchFailures >= FETCH_FAILURES_BEFORE_DEGRADE) await onFailure(result.reason);
      return;
    }
    // Consecutive, like the two counters below: one good poll means the feed is
    // reachable, whatever happened on the last one.
    fetchFailures = 0;

    // Spec 4.2: an empty play list is a degradation signal too, because the
    // likeliest form of an ESPN change is a silent rename that still returns a
    // valid 200. A 'pre' game is exempt — it has no plays yet by definition.
    // Counted on the feed's whole response, not on `fresh` below: a live game
    // whose plays we have all seen already is working perfectly.
    if (emptyIsFailure && result.state !== 'pre') {
      // Measured on the feed's RAW rows, not on parsed events. The parsers
      // filter hard — parseMlbSummary keeps 84 of 541 rows in the recorded
      // fixture, and none until the first at-bat completes — so counting
      // parsed events here degraded essentially every MLB game within 30
      // seconds of first pitch. Feeds that cannot report a row count fall
      // back to the parsed length.
      const rows = result.rowCount == null ? result.events.length : result.rowCount;
      if (rows === 0) {
        // The container we read is gone: the silent-rename case spec 4.2 is
        // aimed at. A live game always has rows, so this is unambiguous.
        emptyPolls += 1;
        unparsedPolls = 0;
      } else if (result.events.length === 0) {
        emptyPolls = 0;
        unparsedPolls += 1;
      } else {
        emptyPolls = 0;
        unparsedPolls = 0;
      }
      if (emptyPolls >= EMPTY_POLLS_BEFORE_DEGRADE) {
        await onFailure('empty-feed');
        return;
      }
      if (unparsedPolls >= UNPARSED_POLLS_BEFORE_DEGRADE) {
        await onFailure('unparsed-feed');
        return;
      }
    }

    // Reported before the dedupe below, and independently of it. This is the
    // whole point of the status line: the MLB parser only yields a play when an
    // at-bat completes, so between at-bats there are no fresh events at all
    // while the count, the outs and the score keep moving.
    if (result.status && result.status !== lastStatus) {
      lastStatus = result.status;
      await onStatus(result.status);
      if (stopped) return;
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

  // One fetch that marks everything the feed currently carries as seen WITHOUT
  // emitting any of it, and hands the swallowed events back to the caller.
  //
  // ESPN's summary endpoint returns the whole game from kickoff, not a delta.
  // Without this, a user who starts monitoring in the fourth quarter has the
  // entire game replayed at them: 146 events and 32 paid explainer calls on the
  // recorded NFL fixture, delivered as one burst that leaves the overlay blank
  // for the minute those serial calls take and then shows only the last play.
  //
  // Deliberately does not touch the degrade counters or call onFinished. A
  // failed prime is not evidence about the feed's health; the tick that follows
  // will fail the same way and take the normal degradation path, and a game
  // that is already 'post' is finished by that tick too.
  async function prime() {
    if (stopped) return { ok: false, state: null, events: [] };

    const result = await fetchEvents(feed, eventId, fetchImpl);
    if (stopped || !result.ok) return { ok: false, state: null, events: [] };

    const swallowed = [];
    for (const e of result.events) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      swallowed.push(e);
    }
    return { ok: true, state: result.state, events: swallowed };
  }

  return {
    tick,
    prime,
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
