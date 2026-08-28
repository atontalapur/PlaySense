// test/espn-mlb.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMlbSummary, EspnMlbFeed } from '../src/feeds/espn-mlb.js';
import { IMPORTANCE } from '../src/events.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/mlb-summary.json', import.meta.url)));

test('keeps only Play Result entries', () => {
  const events = parseMlbSummary(fixture);
  assert.ok(events.length > 20, `expected >20 play results, got ${events.length}`);
  assert.ok(events.length < fixture.plays.length, 'must filter out non-results');
  assert.ok(events.every(e => e.type === 'Play Result'));
});

test('ids are unique and stable', () => {
  const events = parseMlbSummary(fixture);
  const ids = events.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('period carries inning half and number', () => {
  const events = parseMlbSummary(fixture);
  const e = events[0];
  assert.equal(e.sport, 'mlb');
  assert.ok(['Top', 'Bottom'].includes(e.period.type));
  assert.equal(typeof e.period.number, 'number');
});

test('scoring at-bats are high importance', () => {
  const events = parseMlbSummary(fixture);
  const scoring = events.filter(e => e.isScoring);
  assert.ok(scoring.every(e => e.importance === IMPORTANCE.HIGH));
});

test('malformed input returns empty array', () => {
  assert.deepEqual(parseMlbSummary(null), []);
  assert.deepEqual(parseMlbSummary({}), []);
  assert.deepEqual(parseMlbSummary({ plays: 'nope' }), []);
});

test('feed builds the correct endpoint url', () => {
  assert.equal(
    EspnMlbFeed.url('401816696'),
    'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=401816696'
  );
});

test('does not throw when text is present but not a string', () => {
  const json = {
    plays: [
      { id: 'a1', type: { text: 'Play Result' }, text: 12345 },
      { id: 'a2', type: { text: 'Play Result' }, text: {} }
    ]
  };
  let events;
  assert.doesNotThrow(() => {
    events = parseMlbSummary(json);
  });
  assert.equal(events.length, 2);
  assert.ok(events.every(e => e.text === ''));
});
