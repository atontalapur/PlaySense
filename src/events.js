export const IMPORTANCE = { HIGH: 'high', NORMAL: 'normal', LOW: 'low' };

const CLOCK_TYPES = new Set([
  'Official Timeout', 'Timeout', 'End Period', 'End of Half',
  'Two-minute warning', 'End Game'
]);

const NFL_HIGH_TYPES = new Set([
  'Penalty', 'Sack', 'Pass Interception Return',
  'Muffed Punt Recovery (Opponent)', 'Fumble Recovery (Opponent)', 'Safety'
]);

const F1_HIGH_CATEGORIES = new Set(['SafetyCar', 'Flag', 'Drs', 'VirtualSafetyCar']);

const NFL_TURNOVER_TEXT = /\bfumble|intercepted|interception\b/i;
const MLB_HIGH_TEXT = /\bwalk(?:ed|s)?\b|\bstruck out\b|\bhome run\b|\bhomer(?:ed|s)?\b|\bstole\b|\bdouble play\b|\berror\b/i;

// The feed taxonomies are open sets. Anything unrecognised must fall through
// to NORMAL rather than throw — a new ESPN play type must never break a game.
export function classifyImportance(raw = {}) {
  const type = raw.type || '';
  const text = raw.text || '';

  if (raw.isScoring === true) return IMPORTANCE.HIGH;

  if (raw.sport === 'f1') {
    if (raw.flag) return IMPORTANCE.HIGH;
    if (F1_HIGH_CATEGORIES.has(raw.category)) return IMPORTANCE.HIGH;
    return IMPORTANCE.LOW;
  }

  if (CLOCK_TYPES.has(type)) return IMPORTANCE.LOW;

  if (raw.sport === 'mlb') {
    if (type !== 'Play Result') return IMPORTANCE.LOW;
    if (Number(raw.scoreValue) > 0) return IMPORTANCE.HIGH;
    if (MLB_HIGH_TEXT.test(text)) return IMPORTANCE.HIGH;
    return IMPORTANCE.NORMAL;
  }

  if (raw.sport === 'nfl') {
    if (NFL_HIGH_TYPES.has(type)) return IMPORTANCE.HIGH;
    if (NFL_TURNOVER_TEXT.test(text)) return IMPORTANCE.HIGH;
    if (/^4th/i.test(raw.downDistanceText || '')) return IMPORTANCE.HIGH;
    return IMPORTANCE.NORMAL;
  }

  return IMPORTANCE.NORMAL;
}

// Note: classifyImportance reads downDistanceText, scoreValue, flag, and category
// for classification but deliberately does not carry them onto the event object.
// Call classifyImportance only on raw feed payloads, never on a GameEvent returned
// by makeEvent, or importance will be silently misclassified.
export function makeEvent(fields) {
  return {
    id: String(fields.id),
    sport: fields.sport,
    type: fields.type || null,
    text: fields.text || '',
    period: fields.period || null,
    clock: fields.clock || null,
    score: fields.score || null,
    isScoring: fields.isScoring === true,
    importance: classifyImportance(fields)
  };
}
