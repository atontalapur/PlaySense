// ESPN race ids and OpenF1 session keys are different id spaces — ESPN's
// 600057442 returns 404 from OpenF1 — so the F1 feed used session_key=latest
// regardless of which race page the viewer had open. On any page that was not
// the currently running session, that showed race control from an unrelated
// race, stated as confidently as if it were the right one.
//
// Nothing joins the two id spaces directly, but the date does. ESPN dates an
// event to the start of the race weekend and OpenF1 dates each session within
// it, so a session belongs to an ESPN race when it falls inside that weekend.
// Verified against the full 2026 season: 25 of 25 ESPN events resolve to the
// right OpenF1 race.

const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard';
const OPENF1_SESSIONS = 'https://api.openf1.org/v1/sessions';

// ESPN's event date is the first day of the weekend, and sessions run from
// then until the race. Generous on both sides because timezones move the
// nominal date by up to a day either way.
const WEEKEND_BEFORE_MS = 24 * 60 * 60 * 1000;
const WEEKEND_AFTER_MS = 4 * 24 * 60 * 60 * 1000;

export const espnScoreboardUrl = (year) => `${ESPN_SCOREBOARD}?dates=${encodeURIComponent(year)}`;
export const openF1SessionsUrl = (year) => `${OPENF1_SESSIONS}?year=${encodeURIComponent(year)}`;

export function findEspnRace(scoreboard, raceId) {
  const events = scoreboard && Array.isArray(scoreboard.events) ? scoreboard.events : [];
  const found = events.find((e) => e && String(e.id) === String(raceId));
  if (!found || typeof found.date !== 'string') return null;
  const startsAt = Date.parse(found.date);
  if (!Number.isFinite(startsAt)) return null;
  return { id: String(found.id), name: found.name || null, startsAt };
}

// Picks the session on that race weekend that the viewer would actually want
// explained. A session running right now wins outright — during a sprint
// weekend the live session may be the sprint, and during Saturday it may be
// qualifying. With nothing live, the weekend's main race is what the page is
// about, and its timing says whether that race is still to come or already run.
//
// session_name is what separates them: session_type 'Race' covers sprints too
// (31 of them across 2026), while session_name 'Race' is exactly the 25 grands
// prix ESPN lists.
export function pickSession(sessions, race, now) {
  const all = Array.isArray(sessions) ? sessions : [];
  const at = now instanceof Date ? now.getTime() : Number(now);

  const inWeekend = all.filter((s) => {
    if (!s || typeof s.date_start !== 'string') return false;
    const start = Date.parse(s.date_start);
    if (!Number.isFinite(start)) return false;
    return start >= race.startsAt - WEEKEND_BEFORE_MS && start <= race.startsAt + WEEKEND_AFTER_MS;
  });

  if (inWeekend.length === 0) return null;

  const live = inWeekend.find((s) => {
    const start = Date.parse(s.date_start);
    const end = Date.parse(s.date_end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    return at >= start && at <= end;
  });
  if (live) return { session: live, phase: 'live' };

  const main = inWeekend.find((s) => s.session_name === 'Race') || inWeekend[inWeekend.length - 1];
  const start = Date.parse(main.date_start);
  return { session: main, phase: Number.isFinite(start) && at < start ? 'upcoming' : 'finished' };
}

async function getJson(fetchImpl, url) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// Never throws. Returns null when the race cannot be identified at all, which
// the caller reports as "not a live session" rather than guessing.
export async function resolveF1Session({ raceId, fetchImpl, now = new Date() }) {
  const at = now instanceof Date ? now : new Date(now);
  const thisYear = at.getUTCFullYear();

  // Current season first, since that is the only one that can be live. The
  // previous year is tried too so that a race in the days either side of New
  // Year still resolves.
  let race = null;
  let year = null;
  for (const candidate of [thisYear, thisYear - 1]) {
    const scoreboard = await getJson(fetchImpl, espnScoreboardUrl(candidate));
    race = findEspnRace(scoreboard, raceId);
    if (race) {
      year = candidate;
      break;
    }
  }
  if (!race) return null;

  const sessions = await getJson(fetchImpl, openF1SessionsUrl(year));
  const picked = pickSession(sessions, race, at);
  if (!picked) return null;

  return {
    sessionKey: String(picked.session.session_key),
    sessionName: picked.session.session_name || null,
    circuit: picked.session.circuit_short_name || null,
    raceName: race.name,
    startsAt: picked.session.date_start || null,
    phase: picked.phase
  };
}

// What the overlay says when there is nothing to follow. Deliberately specific:
// "not a supported live game" on a real race page is the message that made this
// bug hard to notice in the first place.
export function describeF1Unavailable(resolved) {
  if (!resolved) {
    return 'Could not work out which race session this page is for. Nothing to follow.';
  }
  const what = resolved.sessionName ? `${resolved.sessionName}` : 'This session';
  if (resolved.phase === 'upcoming') {
    const when = resolved.startsAt ? new Date(resolved.startsAt).toLocaleString() : 'later';
    return `${what} has not started yet (begins ${when}). PlaySense explains sessions as they run.`;
  }
  return `${what} has already finished. PlaySense explains sessions as they run.`;
}
