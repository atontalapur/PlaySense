// test/dom-scrape.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDomScrapeFeed, createTabScrapeFetch } from '../src/feeds/dom-scrape.js';
import { fetchEvents } from '../src/feeds/index.js';

test('normalizes raw scraped rows into GameEvents', () => {
  const feed = createDomScrapeFeed('nfl');
  const events = feed.parse([
    { text: 'Touchdown Bills', type: 'NFL Play' },
    { text: 'Score: 21 - 17', type: 'Score Update' }
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0].sport, 'nfl');
  assert.equal(events[0].text, 'Touchdown Bills');
  assert.ok(events.every(e => typeof e.id === 'string' && e.id.length > 0));
});

test('scraped events are marked as degraded provenance', () => {
  const feed = createDomScrapeFeed('nfl');
  const events = feed.parse([{ text: 'Touchdown Bills' }]);
  assert.equal(events[0].degraded, true);
});

test('ids are stable across repeated identical scrapes', () => {
  const feed = createDomScrapeFeed('nfl');
  const a = feed.parse([{ text: 'Touchdown Bills' }]);
  const b = feed.parse([{ text: 'Touchdown Bills' }]);
  assert.equal(a[0].id, b[0].id, 'same text must yield same id so dedup suppresses it');
});

test('malformed scrape payloads return empty array', () => {
  const feed = createDomScrapeFeed('nfl');
  assert.deepEqual(feed.parse(null), []);
  assert.deepEqual(feed.parse('nope'), []);
});

test('tab scrape fetch wraps a content script reply in a fetch-shaped object', async () => {
  const sendMessage = async () => ({ rows: [{ text: 'Sack' }] });
  const fetchImpl = createTabScrapeFetch(7, sendMessage);
  const res = await fetchImpl('dom://scrape');
  assert.equal(res.ok, true);
  assert.deepEqual(await res.json(), [{ text: 'Sack' }]);
});

test('tab scrape fetch reports not-ok when the content script does not answer', async () => {
  const fetchImpl = createTabScrapeFetch(7, async () => undefined);
  const res = await fetchImpl('dom://scrape');
  assert.equal(res.ok, false);
});

test('dom scrape feed works end to end through fetchEvents', async () => {
  const feed = createDomScrapeFeed('nfl');
  const fetchImpl = createTabScrapeFetch(7, async () => ({ rows: [{ text: 'Interception' }] }));
  const result = await fetchEvents(feed, 'ignored', fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(result.events[0].text, 'Interception');
});

// classifyImportance returns LOW for an F1 event with no flag and no category,
// which is every event this feed produces. emit() drops LOW, so a degraded F1
// session announced the fallback and then said nothing at all for the rest of
// the session, with the poller still beating every 10 seconds.
test('scraped f1 events survive the importance filter', async () => {
  const events = createDomScrapeFeed('f1').parse([
    { text: 'SAFETY CAR DEPLOYED — INCIDENT TURN 4' },
    { text: 'YELLOW FLAG IN TRACK SECTOR 12 — DEBRIS ON TRACK' }
  ]);

  assert.equal(events.length, 2);
  for (const event of events) {
    assert.notEqual(event.importance, 'low', `"${event.text}" must reach the overlay`);
  }
});
