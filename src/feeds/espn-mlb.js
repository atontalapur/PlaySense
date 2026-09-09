// src/feeds/espn-mlb.js
import { makeEvent } from '../events.js';
import { espnGameState, espnScoreline, espnStatusDetail, statusLine } from './espn-status.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary';

export function parseMlbSummary(json) {
  if (!json || typeof json !== 'object') return [];
  const plays = json.plays;
  if (!Array.isArray(plays)) return [];

  return plays
    .filter(p => p && p.type && p.type.text === 'Play Result')
    .map((p, i) =>
      makeEvent({
        id: p.id ? String(p.id) : `${p.atBatId || 'ab'}-${p.sequenceNumber != null ? p.sequenceNumber : i}`,
        sport: 'mlb',
        type: p.type.text,
        text: typeof p.text === 'string' ? p.text.trim() : '',
        period: p.period
          ? {
              type: p.period.type || null,
              number: p.period.number,
              display: p.period.displayValue || `Inning ${p.period.number}`
            }
          : null,
        clock: null,
        score: {
          home: Number(p.homeScore) || 0,
          away: Number(p.awayScore) || 0
        },
        isScoring: p.scoringPlay === true || Number(p.scoreValue) > 0,
        scoreValue: Number(p.scoreValue) || 0
      })
    );
}

// Raw rows before parseMlbSummary's `type.text === 'Play Result'` filter. That
// filter is correct — the other rows are pitch-level, with text like
// "Pitch 1 : Ball In Play" rather than a narrative — but it keeps only 84 of
// 541 rows in the recorded fixture, and none at all until the first at-bat
// completes. Counting parsed events as "empty" would degrade every MLB game
// within 30 seconds of first pitch.
export function countMlbRows(json) {
  if (!json || typeof json !== 'object') return 0;
  return Array.isArray(json.plays) ? json.plays.length : 0;
}

// The live state of the at-bat in progress, which updates on every pitch —
// unlike parseMlbSummary's output, which only moves when an at-bat completes.
// That gap is why the overlay looked frozen while the ESPN page kept redrawing:
// measured against a live game, the newest 'Play Result' row was 245 seconds
// old while the newest raw row was 93.
export function mlbStatus(json) {
  if (!json || typeof json !== 'object') return null;
  const situation = json.situation;

  let now = null;
  if (situation && typeof situation === 'object') {
    const balls = Number(situation.balls);
    const strikes = Number(situation.strikes);
    const outs = Number(situation.outs);
    const bits = [];
    if (Number.isFinite(balls) && Number.isFinite(strikes)) bits.push(`${balls}-${strikes}`);
    if (Number.isFinite(outs)) bits.push(`${outs} out`);
    now = bits.length > 0 ? bits.join(', ') : null;
  }

  return statusLine({
    detail: espnStatusDetail(json),
    now,
    scoreline: espnScoreline(json)
  });
}

export const EspnMlbFeed = {
  sport: 'mlb',
  url: (eventId) => `${BASE}?event=${encodeURIComponent(eventId)}`,
  parse: parseMlbSummary,
  gameState: espnGameState,
  rowCount: countMlbRows,
  status: mlbStatus
};
