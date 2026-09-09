// src/feeds/espn-nfl.js
import { makeEvent } from '../events.js';
import { espnGameState, espnScoreline, espnStatusDetail, statusLine } from './espn-status.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';

function playToEvent(play, driveIndex, playIndex) {
  const id = play.id
    ? String(play.id)
    : play.sequenceNumber
      ? `seq-${play.sequenceNumber}`
      : `d${driveIndex}p${playIndex}`;

  return makeEvent({
    id,
    sport: 'nfl',
    type: play.type && play.type.text ? play.type.text : null,
    text: typeof play.text === 'string' ? play.text.trim() : '',
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

  // Elements are guarded as well as containers: ESPN's endpoint is
  // undocumented, and a single null in one of these arrays must not take the
  // whole parse down.
  const isPlay = (play) => play && typeof play === 'object';

  previous.forEach((drive, di) => {
    const plays = drive && Array.isArray(drive.plays) ? drive.plays : [];
    plays.forEach((play, pi) => {
      if (isPlay(play)) events.push(playToEvent(play, di, pi));
    });
  });

  const currentPlays =
    drives.current && Array.isArray(drives.current.plays) ? drives.current.plays : [];
  currentPlays.forEach((play, pi) => {
    if (isPlay(play)) events.push(playToEvent(play, 'cur', pi));
  });

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

// The raw play rows ESPN returned, before any of parseNflSummary's filtering.
// The poller needs this to tell "ESPN's shape changed under us" (no rows at
// all) from "this game has not produced an explainable play yet" (rows present,
// none survive the parse). Returns 0 when the container is missing, which is
// exactly the silent-rename case spec 4.2 is aimed at.
export function countNflRows(json) {
  if (!json || typeof json !== 'object') return 0;
  const drives = json.drives;
  if (!drives || typeof drives !== 'object') return 0;
  const previous = Array.isArray(drives.previous) ? drives.previous : [];
  let n = previous.reduce(
    (acc, d) => acc + (d && Array.isArray(d.plays) ? d.plays.length : 0),
    0
  );
  if (drives.current && Array.isArray(drives.current.plays)) n += drives.current.plays.length;
  return n;
}

// Down and distance for the drive in progress. NFL has no top-level
// `situation` block, so this reads the last play of drives.current.
export function nflStatus(json) {
  if (!json || typeof json !== 'object') return null;

  let now = null;
  const current = json.drives && json.drives.current;
  const plays = current && Array.isArray(current.plays) ? current.plays : [];
  const last = plays[plays.length - 1];
  if (last && last.start && typeof last.start.downDistanceText === 'string') {
    now = last.start.downDistanceText;
  }

  return statusLine({
    detail: espnStatusDetail(json),
    now,
    scoreline: espnScoreline(json)
  });
}

export const EspnNflFeed = {
  sport: 'nfl',
  url: (eventId) => `${BASE}?event=${encodeURIComponent(eventId)}`,
  parse: parseNflSummary,
  gameState: espnGameState,
  rowCount: countNflRows,
  status: nflStatus
};
