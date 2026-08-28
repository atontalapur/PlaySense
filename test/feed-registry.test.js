import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectGame, feedForSport, fetchEvents } from '../src/feeds/index.js';
import { EspnNflFeed } from '../src/feeds/espn-nfl.js';

test('detects nfl game pages in path form, with and without a slug', () => {
  for (const url of [
    'https://www.espn.com/nfl/game/_/gameId/401873298',
    'https://www.espn.com/nfl/game/_/gameId/401873298/pit-buf'
  ]) {
    const got = detectGame(url);
    assert.equal(got.sport, 'nfl', url);
    assert.equal(got.eventId, '401873298', url);
  }
});

test('detects the nfl live link, which puts gameId in the query string', () => {
  // ESPN's own scoreboard "live" link is /nfl/game?gameId=N, not a path.
  const got = detectGame('https://www.espn.com/nfl/game?gameId=401873299');
  assert.equal(got.sport, 'nfl');
  assert.equal(got.eventId, '401873299');
});

test('detects playbyplay and boxscore pages', () => {
  for (const [url, sport] of [
    ['https://www.espn.com/nfl/playbyplay/_/gameId/401873298', 'nfl'],
    ['https://www.espn.com/nfl/boxscore/_/gameId/401873298', 'nfl'],
    ['https://www.espn.com/mlb/playbyplay/_/gameId/401816696', 'mlb']
  ]) {
    const got = detectGame(url);
    assert.ok(got, url);
    assert.equal(got.sport, sport, url);
  }
});

test('detects mlb game pages', () => {
  const got = detectGame('https://www.espn.com/mlb/game/_/gameId/401816696/rockies-nationals');
  assert.equal(got.sport, 'mlb');
  assert.equal(got.eventId, '401816696');
});

test('detects f1 race pages using ESPNs real /_/id/ shape', () => {
  const got = detectGame('https://www.espn.com/f1/race/_/id/600057442');
  assert.equal(got.sport, 'f1');
  assert.equal(got.pageId, '600057442');
});

test('f1 eventId is the OpenF1 session key, not the ESPN race id', () => {
  // ESPN race ids and OpenF1 session keys are different id spaces: passing
  // ESPN's 600057442 to OpenF1 returns 404 "No results found". The ESPN id
  // only tells us the user is on an F1 page; the data comes from OpenF1's
  // current session.
  const got = detectGame('https://www.espn.com/f1/race/_/id/600057442');
  assert.equal(got.eventId, 'latest');
  assert.notEqual(got.eventId, got.pageId);
});

test('nfl and mlb eventId and pageId are the same ESPN id', () => {
  const got = detectGame('https://www.espn.com/nfl/game/_/gameId/401873298');
  assert.equal(got.eventId, got.pageId);
});

test('returns null for non-game pages', () => {
  assert.equal(detectGame('https://www.espn.com/'), null);
  assert.equal(detectGame('https://www.espn.com/nfl/scoreboard'), null);
  assert.equal(detectGame('https://example.com/nfl/game/_/gameId/1'), null);
  assert.equal(detectGame(''), null);
  assert.equal(detectGame(null), null);
});

test('feedForSport maps sports to feeds', () => {
  assert.equal(feedForSport('nfl').sport, 'nfl');
  assert.equal(feedForSport('mlb').sport, 'mlb');
  assert.equal(feedForSport('f1').sport, 'f1');
  assert.equal(feedForSport('nhl'), null);
});

test('fetchEvents returns parsed events on success', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ drives: { previous: [{ plays: [{ id: '1', text: 'x', type: { text: 'Rush' } }] }] } })
  });
  const res = await fetchEvents(EspnNflFeed, '123', fakeFetch);
  assert.equal(res.ok, true);
  assert.equal(res.events.length, 1);
});

test('fetchEvents reports failure on non-200 rather than throwing', async () => {
  const fakeFetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const res = await fetchEvents(EspnNflFeed, '123', fakeFetch);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'http-404');
});

test('fetchEvents reports failure on malformed json rather than throwing', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => { throw new Error('bad json'); } });
  const res = await fetchEvents(EspnNflFeed, '123', fakeFetch);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'parse-error');
});

test('fetchEvents reports failure on network error rather than throwing', async () => {
  const fakeFetch = async () => { throw new Error('offline'); };
  const res = await fetchEvents(EspnNflFeed, '123', fakeFetch);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'network-error');
});

test('fetchEvents returns failure when fetchImpl resolves to non-Response rather than throwing', async () => {
  const fakeFetch = async () => undefined;
  const res = await fetchEvents(EspnNflFeed, '123', fakeFetch);
  assert.equal(res.ok, false);
  assert.equal(typeof res.reason, 'string', 'reason must be a string');
});
