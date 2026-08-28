// src/feeds/espn-mlb.js
import { makeEvent } from '../events.js';

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
        text: (p.text || '').trim(),
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

export const EspnMlbFeed = {
  sport: 'mlb',
  url: (eventId) => `${BASE}?event=${encodeURIComponent(eventId)}`,
  parse: parseMlbSummary
};
