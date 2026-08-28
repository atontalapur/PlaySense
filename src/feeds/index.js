import { EspnNflFeed } from './espn-nfl.js';
import { EspnMlbFeed } from './espn-mlb.js';
import { OpenF1Feed } from './openf1.js';

const FEEDS = {
  nfl: EspnNflFeed,
  mlb: EspnMlbFeed,
  f1: OpenF1Feed
};

// Verified against ESPN's own scoreboard event links. Three shapes exist and
// all three are pages a viewer actually lands on:
//   /nfl/game/_/gameId/401873298[/pit-buf]   summary (path form)
//   /nfl/game?gameId=401873299               the scoreboard's "live" link
//   /nfl/playbyplay/_/gameId/401873298       play-by-play, and /boxscore/ too
// F1 uses /_/id/, NOT /_/raceId/.
const BALL_PATH = /^\/(nfl|mlb)\/(?:game|playbyplay|boxscore)\/_\/gameId\/(\d+)/i;
const BALL_QUERY = /^\/(nfl|mlb)\/(?:game|playbyplay|boxscore)\/?$/i;
const F1_PATH = /^\/f1\/(?:race|results)\/_\/id\/(\d+)/i;

// OpenF1 keys on its own session_key, a different id space from ESPN's race
// id (ESPN's 600057442 returns 404 from OpenF1). The ESPN id only tells us the
// viewer is on an F1 page; "latest" resolves to OpenF1's current session, which
// is the running one during a live race — exactly what this extension explains.
const F1_SESSION_KEY = 'latest';

export function detectGame(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!/(^|\.)espn\.com$/i.test(parsed.hostname)) return null;

  const f1 = parsed.pathname.match(F1_PATH);
  if (f1) {
    return { sport: 'f1', eventId: F1_SESSION_KEY, pageId: f1[1] };
  }

  const path = parsed.pathname.match(BALL_PATH);
  if (path) {
    const sport = path[1].toLowerCase();
    return { sport, eventId: path[2], pageId: path[2] };
  }

  const query = parsed.pathname.match(BALL_QUERY);
  if (query) {
    const gameId = parsed.searchParams.get('gameId');
    if (gameId && /^\d+$/.test(gameId)) {
      const sport = query[1].toLowerCase();
      return { sport, eventId: gameId, pageId: gameId };
    }
  }

  return null;
}

export function feedForSport(sport) {
  return FEEDS[sport] || null;
}

// Never throws. Callers branch on `ok` and fall back to the DOM scraper.
export async function fetchEvents(feed, eventId, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(feed.url(eventId));
    if (!response.ok) {
      return { ok: false, events: [], reason: `http-${response.status}` };
    }
  } catch {
    return { ok: false, events: [], reason: 'network-error' };
  }

  let json;
  try {
    json = await response.json();
  } catch {
    return { ok: false, events: [], reason: 'parse-error' };
  }

  // The parsers guard their own inputs, but this catch is what makes the
  // "never throws" contract above true for any future feed too. A rejection
  // here would skip the caller's onFailure, so the DOM-scrape fallback would
  // never engage and the extension would stall silently.
  let events;
  try {
    events = feed.parse(json);
  } catch {
    return { ok: false, events: [], reason: 'parse-error' };
  }

  // Read separately from parse: a feed that cannot report its state still has
  // perfectly good events, so a throw here must not discard them. `null` means
  // unknown, which callers treat as "not pre".
  let state = null;
  try {
    state = feed.gameState ? feed.gameState(json) : null;
  } catch {
    state = null;
  }

  // Same containment as gameState: an unusable rowCount must not discard good
  // events. `null` means unknown, and the poller falls back to counting parsed
  // events for feeds that do not report it.
  let rowCount = null;
  try {
    rowCount = feed.rowCount ? feed.rowCount(json) : null;
  } catch {
    rowCount = null;
  }

  return { ok: true, events, reason: null, state, rowCount };
}
