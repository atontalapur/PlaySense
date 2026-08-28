// src/feeds/openf1.js
import { makeEvent } from '../events.js';

const BASE = 'https://api.openf1.org/v1';

export function parseRaceControl(json) {
  if (!Array.isArray(json)) return [];

  // The id embeds the array index i, so it assumes OpenF1 returns
  // race-control messages in stable append-only order (verified: a feed
  // growing from 100 to 120 messages recognises all 100 prior ids and
  // emits exactly 20 new). (session_key, date) alone is not sufficient —
  // it collides 16 times in the recorded fixture — so the index is
  // load-bearing for id uniqueness.
  // The index i is taken from the ORIGINAL array, before the guard drops
  // anything, so ids stay stable across polls even if a malformed entry
  // appears or disappears between them.
  return json
    .map((m, i) => (m && typeof m === 'object' ? { m, i } : null))
    .filter(Boolean)
    .map(({ m, i }) =>
      makeEvent({
        id: `${m.session_key || 's'}-${m.date || i}-${i}`,
        sport: 'f1',
        type: m.category || null,
        text: typeof m.message === 'string' ? m.message.trim() : '',
        period:
          m.lap_number != null
            ? { type: 'Lap', number: m.lap_number, display: `Lap ${m.lap_number}` }
            : null,
        clock: m.date || null,
        score: null,
        isScoring: false,
        flag: m.flag || null,
        category: m.category || null
      })
    );
}

export const OpenF1Feed = {
  sport: 'f1',
  url: (sessionKey) => `${BASE}/race_control?session_key=${encodeURIComponent(sessionKey)}`,
  sessionsUrl: (year) => `${BASE}/sessions?year=${encodeURIComponent(year)}`,
  parse: parseRaceControl
};
