// test/espn-mlb.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMlbSummary, EspnMlbFeed, mlbStatus } from '../src/feeds/espn-mlb.js';
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

test('reads the game state from the summary header', () => {
  // The recorded MLB fixture is a completed game.
  assert.equal(EspnMlbFeed.gameState(fixture), 'post');
  assert.equal(EspnMlbFeed.gameState({ header: {} }), null);
});

test('mlbStatus reads the count and outs that move between at-bats', () => {
  const line = mlbStatus({
    situation: { balls: 1, strikes: 2, outs: 2 },
    header: { competitions: [{
      status: { type: { detail: 'Bottom 5th' } },
      competitors: [
        { homeAway: 'home', team: { abbreviation: 'BAL' }, score: '5' },
        { homeAway: 'away', team: { abbreviation: 'CLE' }, score: '6' }
      ]
    }] }
  });
  assert.match(line, /Bottom 5th/);
  assert.match(line, /1-2, 2 out/);
  assert.match(line, /CLE 6, BAL 5/);
});

test('mlbStatus survives a missing situation block', () => {
  assert.equal(mlbStatus(null), null);
  assert.equal(mlbStatus({}), null);
  const line = mlbStatus({
    header: { competitions: [{ status: { type: { detail: 'Final' } } }] }
  });
  assert.equal(line, 'Final', 'the clock alone is still worth a line');
});
