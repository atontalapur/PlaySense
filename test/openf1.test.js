// test/openf1.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRaceControl, OpenF1Feed } from '../src/feeds/openf1.js';
import { IMPORTANCE } from '../src/events.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/openf1-race-control.json', import.meta.url)));

test('parses race control messages into events', () => {
  const events = parseRaceControl(fixture);
  assert.ok(events.length > 50, `expected >50 messages, got ${events.length}`);
  assert.ok(events.every(e => e.sport === 'f1'));
});

test('ids are unique', () => {
  const events = parseRaceControl(fixture);
  const ids = events.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('flagged messages are high importance, generic chatter is low', () => {
  const events = parseRaceControl(fixture);
  const flagged = events.filter(e => e.importance === IMPORTANCE.HIGH);
  const low = events.filter(e => e.importance === IMPORTANCE.LOW);
  assert.ok(flagged.length > 0, 'fixture should contain at least one flag or safety car');
  assert.ok(low.length > 0, 'fixture should contain generic Other messages');
});

test('message text is preserved verbatim', () => {
  const events = parseRaceControl(fixture);
  assert.ok(events.every(e => typeof e.text === 'string'));
  assert.ok(events.some(e => e.text.length > 0));
});

test('lap number is carried as period', () => {
  const events = parseRaceControl(fixture);
  const withLap = events.find(e => e.period && typeof e.period.number === 'number');
  assert.ok(withLap, 'at least one message should carry a lap number');
});

test('malformed input returns empty array', () => {
  assert.deepEqual(parseRaceControl(null), []);
  assert.deepEqual(parseRaceControl({}), []);
  assert.deepEqual(parseRaceControl('nope'), []);
});

test('feed builds correct urls', () => {
  assert.equal(
    OpenF1Feed.url('11353'),
    'https://api.openf1.org/v1/race_control?session_key=11353'
  );
  assert.equal(
    OpenF1Feed.sessionsUrl(2026),
    'https://api.openf1.org/v1/sessions?year=2026'
  );
});
