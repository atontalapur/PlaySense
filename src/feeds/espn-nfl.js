// src/feeds/espn-nfl.js
import { makeEvent } from '../events.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';

function playToEvent(play, driveIndex, playIndex) {
  const id = play.id
    ? String(play.id)
    : `d${driveIndex}p${playIndex}-${play.sequenceNumber || ''}`;

  return makeEvent({
    id,
    sport: 'nfl',
    type: play.type && play.type.text ? play.type.text : null,
    text: (play.text || '').trim(),
    period: play.period
      ? { type: 'Quarter', number: play.period.number, display: `Q${play.period.number}` }
      : null,
    clock: play.clock ? play.clock.displayValue : null,
    score: {
      home: Number(play.homeScore) || 0,
      away: Number(play.awayScore) || 0
    },
    isScoring: play.scoringPlay === true,
    downDistanceText: play.start ? play.start.downDistanceText : ''
  });
}

export function parseNflSummary(json) {
  if (!json || typeof json !== 'object') return [];
  const drives = json.drives;
  if (!drives || typeof drives !== 'object') return [];

  const events = [];
  const previous = Array.isArray(drives.previous) ? drives.previous : [];

  previous.forEach((drive, di) => {
    const plays = Array.isArray(drive.plays) ? drive.plays : [];
    plays.forEach((play, pi) => events.push(playToEvent(play, di, pi)));
  });

  const currentPlays =
    drives.current && Array.isArray(drives.current.plays) ? drives.current.plays : [];
  currentPlays.forEach((play, pi) => events.push(playToEvent(play, 'cur', pi)));

  // ESPN lists the in-progress drive's plays in BOTH drives.previous and
  // drives.current, so the flattened list contains byte-identical repeats
  // sharing one id. Verified in the recorded fixture: 177 rows, 168 distinct.
  // Collapse them here, keeping first occurrence and preserving order.
  const seen = new Set();
  return events.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

export const EspnNflFeed = {
  sport: 'nfl',
  url: (eventId) => `${BASE}?event=${encodeURIComponent(eventId)}`,
  parse: parseNflSummary
};
