// Both ESPN summary endpoints carry the game clock state at the same path:
// header.competitions[0].status.type.state, one of 'pre' | 'in' | 'post'.
// Spec 4.2 needs it to tell a not-yet-started game's empty play list from a
// broken feed's, and spec 4.3 needs it to stop polling once a game is over.
// Returns null when the shape is missing rather than guessing — callers treat
// an unknown state as "not pre", which is the safe direction for both uses.
export function espnGameState(json) {
  if (!json || typeof json !== 'object') return null;
  const header = json.header;
  if (!header || typeof header !== 'object') return null;
  const competitions = Array.isArray(header.competitions) ? header.competitions : [];
  const competition = competitions[0];
  if (!competition || typeof competition !== 'object') return null;
  const status = competition.status;
  if (!status || typeof status !== 'object') return null;
  const type = status.type;
  if (!type || typeof type !== 'object') return null;
  return typeof type.state === 'string' ? type.state : null;
}

// Both summary endpoints carry the competitors with their abbreviations and
// live scores. The play rows only carry bare homeScore/awayScore numbers, so
// this is the only place a score can be attached to a team name.
export function espnScoreline(json) {
  const competitions = json && json.header && Array.isArray(json.header.competitions)
    ? json.header.competitions
    : [];
  const competitors = competitions[0] && Array.isArray(competitions[0].competitors)
    ? competitions[0].competitors
    : [];

  const side = (which) => {
    const found = competitors.find((c) => c && c.homeAway === which);
    if (!found) return null;
    const abbr = found.team && found.team.abbreviation;
    if (!abbr) return null;
    return { abbr, score: Number(found.score) || 0 };
  };

  const home = side('home');
  const away = side('away');
  if (!home || !away) return null;
  return { home, away };
}

// "1:06 - 4th Quarter" / "Bottom 5th" — whatever ESPN is showing as the clock.
export function espnStatusDetail(json) {
  const competitions = json && json.header && Array.isArray(json.header.competitions)
    ? json.header.competitions
    : [];
  const status = competitions[0] && competitions[0].status;
  const type = status && status.type;
  return type && typeof type.detail === 'string' ? type.detail : null;
}

// One compact line: where the game is, what is happening right now, and the
// score. `detail` is the clock, `now` is the sport-specific live state.
export function statusLine({ detail, now, scoreline }) {
  const parts = [];
  if (detail) parts.push(detail);
  if (now) parts.push(now);
  if (scoreline) {
    parts.push(`${scoreline.away.abbr} ${scoreline.away.score}, ${scoreline.home.abbr} ${scoreline.home.score}`);
  }
  return parts.length > 0 ? parts.join(' \u00b7 ') : null;
}
