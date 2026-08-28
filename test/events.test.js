import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyImportance, makeEvent, IMPORTANCE } from '../src/events.js';

test('scoring plays are high importance', () => {
  assert.equal(classifyImportance({ sport: 'nfl', type: 'Rush', isScoring: true }), IMPORTANCE.HIGH);
});

test('nfl turnovers and penalties are high importance', () => {
  for (const type of ['Penalty', 'Sack', 'Pass Interception Return', 'Muffed Punt Recovery (Opponent)']) {
    assert.equal(classifyImportance({ sport: 'nfl', type }), IMPORTANCE.HIGH, type);
  }
  assert.equal(
    classifyImportance({ sport: 'nfl', type: 'Rush', text: 'J.Allen FUMBLES, recovered by PIT' }),
    IMPORTANCE.HIGH
  );
});

test('nfl fourth down attempts are high importance', () => {
  assert.equal(
    classifyImportance({ sport: 'nfl', type: 'Rush', downDistanceText: '4th & 2 at PIT 40' }),
    IMPORTANCE.HIGH
  );
});

test('clock and administrative plays are low importance', () => {
  for (const type of ['Official Timeout', 'Timeout', 'End Period', 'End of Half', 'Two-minute warning']) {
    assert.equal(classifyImportance({ sport: 'nfl', type }), IMPORTANCE.LOW, type);
  }
});

test('routine nfl plays are normal importance', () => {
  assert.equal(classifyImportance({ sport: 'nfl', type: 'Rush' }), IMPORTANCE.NORMAL);
  assert.equal(classifyImportance({ sport: 'nfl', type: 'Pass Reception' }), IMPORTANCE.NORMAL);
});

test('unknown types classify as normal and never throw', () => {
  assert.equal(classifyImportance({ sport: 'nfl', type: 'Zamboni Interference' }), IMPORTANCE.NORMAL);
  assert.equal(classifyImportance({ sport: 'nfl' }), IMPORTANCE.NORMAL);
  assert.equal(classifyImportance({}), IMPORTANCE.NORMAL);
});

test('mlb non play-results are low, scoring is high', () => {
  assert.equal(classifyImportance({ sport: 'mlb', type: 'End Batter/Pitcher' }), IMPORTANCE.LOW);
  assert.equal(classifyImportance({ sport: 'mlb', type: 'Play Result', scoreValue: 2 }), IMPORTANCE.HIGH);
  assert.equal(
    classifyImportance({ sport: 'mlb', type: 'Play Result', text: 'Judge walked.' }),
    IMPORTANCE.HIGH
  );
  assert.equal(
    classifyImportance({ sport: 'mlb', type: 'Play Result', text: 'Paredes flied out to center.' }),
    IMPORTANCE.NORMAL
  );
});

test('f1 flags and safety cars are high, chatter is low', () => {
  assert.equal(classifyImportance({ sport: 'f1', category: 'Flag', flag: 'YELLOW' }), IMPORTANCE.HIGH);
  assert.equal(classifyImportance({ sport: 'f1', category: 'SafetyCar' }), IMPORTANCE.HIGH);
  assert.equal(classifyImportance({ sport: 'f1', category: 'Other', flag: null }), IMPORTANCE.LOW);
});

test('makeEvent attaches importance and preserves feed text verbatim', () => {
  const e = makeEvent({
    id: 'p1', sport: 'nfl', type: 'Rushing Touchdown',
    text: 'K.Johnson up the middle for 6 yards, TOUCHDOWN.',
    period: { type: 'Quarter', number: 3, display: '3rd Quarter' },
    clock: '2:14', score: { home: 21, away: 17 }, isScoring: true
  });
  assert.equal(e.importance, IMPORTANCE.HIGH);
  assert.equal(e.text, 'K.Johnson up the middle for 6 yards, TOUCHDOWN.');
  assert.equal(e.id, 'p1');
  assert.equal(e.sport, 'nfl');
});
