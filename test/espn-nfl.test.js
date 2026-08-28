// test/espn-nfl.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNflSummary, EspnNflFeed } from '../src/feeds/espn-nfl.js';
import { IMPORTANCE } from '../src/events.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/nfl-summary.json', import.meta.url)));

test('parses every play from both current and previous drives', () => {
  const events = parseNflSummary(fixture);
  assert.ok(events.length > 100, `expected >100 plays, got ${events.length}`);
});

test('every event has a stable non-empty id and no duplicates', () => {
  const events = parseNflSummary(fixture);
  const ids = events.map(e => e.id);
  assert.ok(ids.every(id => typeof id === 'string' && id.length > 0));
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
});

test('the in-progress drive is not double-counted', () => {
  // ESPN repeats the current drive's plays inside drives.previous. The raw
  // flattened count is higher than the distinct count; parse must collapse it.
  const raw = (fixture.drives.previous || []).reduce((n, d) => n + (d.plays || []).length, 0)
    + ((fixture.drives.current && fixture.drives.current.plays) || []).length;
  const events = parseNflSummary(fixture);
  assert.ok(events.length < raw, `expected dedup: raw ${raw}, parsed ${events.length}`);
  assert.equal(events.length, new Set(events.map(e => e.id)).size);
});

test('scoring plays are detected and marked high importance', () => {
  const events = parseNflSummary(fixture);
  const scoring = events.filter(e => e.isScoring);
  assert.ok(scoring.length >= 4, `expected >=4 scoring plays, got ${scoring.length}`);
  assert.ok(scoring.every(e => e.importance === IMPORTANCE.HIGH));
});

test('play text and type are preserved verbatim from the feed', () => {
  const events = parseNflSummary(fixture);
  const withText = events.filter(e => e.text.length > 0);
  assert.ok(withText.length > 100);
  assert.ok(events.some(e => e.type === 'Rush'));
});

test('events carry period, clock and score', () => {
  const events = parseNflSummary(fixture);
  const e = events.find(x => x.type === 'Rush');
  assert.equal(e.sport, 'nfl');
  assert.equal(typeof e.period.number, 'number');
  assert.ok(e.score && typeof e.score.home === 'number');
});

test('malformed input returns an empty array rather than throwing', () => {
  assert.deepEqual(parseNflSummary(null), []);
  assert.deepEqual(parseNflSummary({}), []);
  assert.deepEqual(parseNflSummary({ drives: {} }), []);
});

test('feed builds the correct endpoint url', () => {
  assert.equal(
    EspnNflFeed.url('401873298'),
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873298'
  );
});

test('does not throw when text is present but not a string', () => {
  const json = {
    drives: {
      previous: [{ plays: [{ id: 'p1', text: 12345 }, { id: 'p2', text: {} }] }],
      current: null
    }
  };
  let events;
  assert.doesNotThrow(() => {
    events = parseNflSummary(json);
  });
  assert.equal(events.length, 2);
  assert.ok(events.every(e => e.text === ''));
});

test('fallback id for a play with no id is stable across the drive boundary', () => {
  const play = { sequenceNumber: 42, text: 'Run play' };
  const inCurrent = parseNflSummary({
    drives: { previous: [], current: { plays: [play] } }
  })[0];
  const inPrevious = parseNflSummary({
    drives: { previous: [{ plays: [play] }], current: null }
  })[0];
  assert.equal(inCurrent.id, inPrevious.id);
  assert.equal(inCurrent.id, 'seq-42');
});

// ESPN's summary endpoint is undocumented and may change without notice. A null
// element anywhere in it must not take the parser down — see the containment
// test in feed-registry.test.js for the layer above.
test('skips null and non-object plays and drives instead of throwing', () => {
  const events = parseNflSummary({
    drives: {
      previous: [
        null,
        'not a drive',
        { plays: [null, 42, { id: '7', text: 'Sack', type: { text: 'Sack' } }] }
      ],
      current: { plays: [null, { id: '8', text: 'Fumble', type: { text: 'Fumble Recovery' } }] }
    }
  });
  assert.deepEqual(events.map(e => e.id), ['7', '8']);
});

test('reads the game state from the summary header', () => {
  assert.equal(EspnNflFeed.gameState(fixture), 'in');
  assert.equal(EspnNflFeed.gameState({}), null);
  assert.equal(EspnNflFeed.gameState(null), null);
});
