// src/feeds/openf1.js
import { makeEvent } from '../events.js';

const BASE = 'https://api.openf1.org/v1';

export function parseRaceControl(json) {
  if (!Array.isArray(json)) return [];

  return json.map((m, i) =>
    makeEvent({
      id: `${m.session_key || 's'}-${m.date || i}-${i}`,
      sport: 'f1',
      type: m.category || null,
      text: (m.message || '').trim(),
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
