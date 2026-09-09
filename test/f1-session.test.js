import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findEspnRace, pickSession, resolveF1Session, describeF1Unavailable,
  espnScoreboardUrl, openF1SessionsUrl
} from '../src/feeds/f1-session.js';

// Shapes taken from the real responses. ESPN dates an event to the start of the
// race weekend; OpenF1 dates each session inside it.
const ESPN = {
  events: [
    { id: '600057442', name: 'Pirelli Italian Grand Prix', date: '2026-09-04T10:30Z' },
    { id: '600057443', name: 'Next Grand Prix', date: '2026-09-18T10:30Z' }
  ]
};
const SESSIONS = [
  { session_key: 11358, session_name: 'Practice 1', session_type: 'Practice', circuit_short_name: 'Monza', date_start: '2026-09-04T11:30:00+00:00', date_end: '2026-09-04T12:30:00+00:00' },
  { session_key: 11359, session_name: 'Qualifying', session_type: 'Qualifying', circuit_short_name: 'Monza', date_start: '2026-09-05T14:00:00+00:00', date_end: '2026-09-05T15:00:00+00:00' },
  { session_key: 11361, session_name: 'Race', session_type: 'Race', circuit_short_name: 'Monza', date_start: '2026-09-06T13:00:00+00:00', date_end: '2026-09-06T15:00:00+00:00' },
  { session_key: 11400, session_name: 'Race', session_type: 'Race', circuit_short_name: 'Baku', date_start: '2026-09-20T13:00:00+00:00', date_end: '2026-09-20T15:00:00+00:00' }
];
const race = () => findEspnRace(ESPN, '600057442');

test('finds the espn race and its weekend start', () => {
  const found = race();
  assert.equal(found.id, '600057442');
  assert.equal(found.name, 'Pirelli Italian Grand Prix');
  assert.equal(found.startsAt, Date.parse('2026-09-04T10:30Z'));

  assert.equal(findEspnRace(ESPN, '999'), null, 'an unknown id resolves to nothing');
  assert.equal(findEspnRace(null, '600057442'), null);
  assert.equal(findEspnRace({ events: [{ id: '600057442' }] }, '600057442'), null, 'no date, no match');
});

test('a session running now wins, whatever its type', () => {
  // Mid-qualifying on the Saturday: that is what the viewer is watching, not
  // Sunday's race.
  const picked = pickSession(SESSIONS, race(), new Date('2026-09-05T14:30:00Z'));
  assert.equal(picked.phase, 'live');
  assert.equal(picked.session.session_key, 11359);
});

test('with nothing live, the weekend main race says which way it is', () => {
  const before = pickSession(SESSIONS, race(), new Date('2026-09-04T06:00:00Z'));
  assert.equal(before.phase, 'upcoming');
  assert.equal(before.session.session_key, 11361, "the weekend's Race, not its first practice");

  const after = pickSession(SESSIONS, race(), new Date('2026-09-07T09:00:00Z'));
  assert.equal(after.phase, 'finished');
  assert.equal(after.session.session_key, 11361);
});

test('sessions from another weekend are never picked', () => {
  // The Baku race is live, but the page is the Monza page. Answering with Baku
  // is exactly the bug this module exists to remove.
  const picked = pickSession(SESSIONS, race(), new Date('2026-09-20T14:00:00Z'));
  assert.equal(picked.phase, 'finished');
  assert.equal(picked.session.circuit_short_name, 'Monza');
  assert.notEqual(picked.session.session_key, 11400);
});

test('a weekend with no sessions at all resolves to nothing', () => {
  assert.equal(pickSession([], race(), new Date('2026-09-06T14:00:00Z')), null);
  assert.equal(pickSession(null, race(), new Date('2026-09-06T14:00:00Z')), null);
});

const fakeFetch = (routes) => async (url) => {
  const hit = Object.keys(routes).find((k) => url.includes(k));
  if (!hit) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => routes[hit] };
};

test('resolves a live race end to end', async () => {
  const resolved = await resolveF1Session({
    raceId: '600057442',
    fetchImpl: fakeFetch({ 'dates=2026': ESPN, 'year=2026': SESSIONS }),
    now: new Date('2026-09-06T14:00:00Z')
  });
  assert.equal(resolved.sessionKey, '11361', 'a real OpenF1 key, not "latest"');
  assert.equal(resolved.phase, 'live');
  assert.equal(resolved.circuit, 'Monza');
});

test('a race that is not running resolves, but not as live', async () => {
  const resolved = await resolveF1Session({
    raceId: '600057442',
    fetchImpl: fakeFetch({ 'dates=2026': ESPN, 'year=2026': SESSIONS }),
    now: new Date('2026-10-01T00:00:00Z')
  });
  assert.equal(resolved.phase, 'finished');
  assert.match(describeF1Unavailable(resolved), /already finished/i);
});

test('never throws when either service is unreachable', async () => {
  const dead = async () => { throw new Error('offline'); };
  assert.equal(await resolveF1Session({ raceId: '600057442', fetchImpl: dead }), null);

  const noSessions = fakeFetch({ 'dates=2026': ESPN });
  assert.equal(
    await resolveF1Session({
      raceId: '600057442', fetchImpl: noSessions, now: new Date('2026-09-06T14:00:00Z')
    }),
    null,
    'ESPN answered but OpenF1 did not'
  );
});

test('urls are built for the year being asked about', () => {
  assert.match(espnScoreboardUrl(2026), /dates=2026$/);
  assert.match(openF1SessionsUrl(2026), /year=2026$/);
});

test('the unavailable message is specific about why', () => {
  assert.match(describeF1Unavailable(null), /could not work out which race/i);
  assert.match(
    describeF1Unavailable({ phase: 'upcoming', sessionName: 'Race', startsAt: '2026-09-06T13:00:00+00:00' }),
    /has not started yet/i
  );
});
