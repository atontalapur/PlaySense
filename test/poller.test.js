import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPoller, EMPTY_POLLS_BEFORE_DEGRADE, UNPARSED_POLLS_BEFORE_DEGRADE
} from '../src/poller.js';

function feedReturning(batches) {
  let i = 0;
  return {
    sport: 'nfl',
    url: () => 'https://example.test/x',
    parse: () => (i < batches.length ? batches[i++] : [])
  };
}
const okFetch = async () => ({ ok: true, json: async () => ({}) });

test('emits only events not seen before', async () => {
  const feed = feedReturning([
    [{ id: 'a' }, { id: 'b' }],
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  ]);
  const seen = [];
  const poller = createPoller({
    feed, eventId: '1', fetchImpl: okFetch,
    onEvents: (evts) => seen.push(...evts.map(e => e.id))
  });

  await poller.tick();
  await poller.tick();

  assert.deepEqual(seen, ['a', 'b', 'c']);
});

test('a repeated identical description is not dropped when the id differs', async () => {
  const feed = feedReturning([
    [{ id: '1', text: 'K.Johnson up the middle for 2 yards.' }],
    [{ id: '2', text: 'K.Johnson up the middle for 2 yards.' }]
  ]);
  const seen = [];
  const poller = createPoller({
    feed, eventId: '1', fetchImpl: okFetch,
    onEvents: (evts) => seen.push(...evts.map(e => e.id))
  });

  await poller.tick();
  await poller.tick();

  assert.deepEqual(seen, ['1', '2'], 'identical text with distinct ids must both emit');
});

test('duplicate ids inside one batch are emitted once', async () => {
  const feed = feedReturning([[{ id: 'a' }, { id: 'a' }, { id: 'b' }]]);
  const seen = [];
  const poller = createPoller({
    feed, eventId: '1', fetchImpl: okFetch,
    onEvents: (evts) => seen.push(...evts.map(e => e.id))
  });
  await poller.tick();
  assert.deepEqual(seen, ['a', 'b']);
});

test('the first tick emits the full backlog', async () => {
  const feed = feedReturning([[{ id: 'a' }, { id: 'b' }, { id: 'c' }]]);
  let count = 0;
  const poller = createPoller({
    feed, eventId: '1', fetchImpl: okFetch,
    onEvents: (evts) => { count += evts.length; }
  });
  await poller.tick();
  assert.equal(count, 3);
});

test('a failed fetch emits nothing and reports the reason', async () => {
  const feed = feedReturning([[{ id: 'a' }]]);
  const failures = [];
  const poller = createPoller({
    feed, eventId: '1',
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    onEvents: () => { throw new Error('should not emit'); },
    onFailure: (reason) => failures.push(reason)
  });
  await poller.tick();
  assert.deepEqual(failures, ['http-503']);
});

test('stop prevents further ticks', async () => {
  const feed = feedReturning([[{ id: 'a' }], [{ id: 'b' }]]);
  const seen = [];
  const poller = createPoller({
    feed, eventId: '1', fetchImpl: okFetch,
    onEvents: (evts) => seen.push(...evts.map(e => e.id))
  });
  await poller.tick();
  poller.stop();
  await poller.tick();
  assert.deepEqual(seen, ['a']);
});

test('a tick in flight when stop is called emits nothing', async () => {
  const feed = feedReturning([[{ id: 'a' }]]);
  let fetchResolve;
  const controlledFetch = async () => {
    return new Promise(resolve => {
      fetchResolve = resolve;
    });
  };
  const emitted = [];
  const poller = createPoller({
    feed, eventId: '1', fetchImpl: controlledFetch,
    onEvents: (evts) => emitted.push(...evts.map(e => e.id))
  });

  const tickPromise = poller.tick();
  poller.stop();
  fetchResolve({ ok: true, json: async () => ({}) });
  await tickPromise;

  assert.deepEqual(emitted, [], 'in-flight tick after stop must not emit');
});

test('a seeded poller does not re-emit ids it was told were already seen', async () => {
  const feed = feedReturning([[{ id: 'a' }, { id: 'b' }, { id: 'c' }]]);
  const seen = [];
  const poller = createPoller({
    feed, eventId: '1', fetchImpl: okFetch, seed: ['a', 'b'],
    onEvents: (evts) => seen.push(...evts.map(e => e.id))
  });
  await poller.tick();
  assert.deepEqual(seen, ['c'], 'a restarted worker must not replay the game');
  assert.deepEqual(poller.seenIds().sort(), ['a', 'b', 'c']);
});

// --- spec 4.2: an empty play list is a degradation signal ---------------------

const emptyFeed = (state) => ({
  sport: 'nfl',
  url: () => 'https://example.test/x',
  parse: () => [],
  gameState: () => state
});

test('one empty poll is not enough to degrade', async () => {
  const failures = [];
  const poller = createPoller({
    feed: emptyFeed('in'), eventId: '1', fetchImpl: okFetch,
    onEvents: () => {}, onFailure: (r) => failures.push(r)
  });
  await poller.tick();
  assert.deepEqual(failures, [], 'a single empty poll is normal mid-game jitter');
});

test('repeated empty polls on a live game trigger the degraded fallback', async () => {
  const failures = [];
  const poller = createPoller({
    feed: emptyFeed('in'), eventId: '1', fetchImpl: okFetch,
    onEvents: () => {}, onFailure: (r) => failures.push(r)
  });
  for (let i = 0; i < EMPTY_POLLS_BEFORE_DEGRADE; i++) await poller.tick();
  assert.deepEqual(failures, ['empty-feed']);
});

test('a not-yet-started game never degrades on its empty play list', async () => {
  const failures = [];
  const poller = createPoller({
    feed: emptyFeed('pre'), eventId: '1', fetchImpl: okFetch,
    onEvents: () => {}, onFailure: (r) => failures.push(r)
  });
  for (let i = 0; i < EMPTY_POLLS_BEFORE_DEGRADE * 2; i++) await poller.tick();
  assert.deepEqual(failures, [], 'a pre game legitimately has zero plays');
});

test('the empty-poll run resets as soon as the feed returns events', async () => {
  let empty = true;
  const failures = [];
  const feed = {
    sport: 'nfl',
    url: () => 'https://example.test/x',
    parse: () => (empty ? [] : [{ id: `p${Math.random()}` }]),
    gameState: () => 'in'
  };
  const poller = createPoller({
    feed, eventId: '1', fetchImpl: okFetch,
    onEvents: () => {}, onFailure: (r) => failures.push(r)
  });
  for (let i = 0; i < EMPTY_POLLS_BEFORE_DEGRADE - 1; i++) await poller.tick();
  empty = false;
  await poller.tick();
  empty = true;
  for (let i = 0; i < EMPTY_POLLS_BEFORE_DEGRADE - 1; i++) await poller.tick();
  assert.deepEqual(failures, [], 'the run must be consecutive, not cumulative');
});

// --- spec 4.3: polling stops when the game is over ---------------------------

test('a finished game reports onFinished and stops polling', async () => {
  let parses = 0;
  const feed = {
    sport: 'nfl',
    url: () => 'https://example.test/x',
    parse: () => { parses++; return [{ id: `last-${parses}` }]; },
    gameState: () => 'post'
  };
  const seen = [];
  let finished = 0;
  const poller = createPoller({
    feed, eventId: '1', fetchImpl: okFetch,
    onEvents: (evts) => seen.push(...evts.map(e => e.id)),
    onFinished: () => { finished++; }
  });

  await poller.tick();
  assert.equal(finished, 1);
  assert.deepEqual(seen, ['last-1'], 'the final poll must still deliver its events');

  await poller.tick();
  assert.equal(parses, 1, 'a finished poller must not fetch again');
  assert.equal(finished, 1);
});

test('rows present but none parsed does not degrade at the empty threshold', async () => {
  // The MLB shape: the feed returns plenty of rows, but the parser keeps only
  // narrative 'Play Result' rows and the opening at-bat has produced none yet.
  const feed = {
    sport: 'mlb',
    url: () => 'https://example.test/x',
    parse: () => [],
    rowCount: () => 120,
    gameState: () => 'in'
  };
  const failures = [];
  const poller = createPoller({
    feed, eventId: '1', fetchImpl: okFetch,
    onEvents: () => {},
    onFailure: (reason) => failures.push(reason)
  });

  for (let i = 0; i < EMPTY_POLLS_BEFORE_DEGRADE + 2; i += 1) await poller.tick();

  assert.deepEqual(failures, []);
});

test('a feed whose rows have vanished degrades at the empty threshold', async () => {
  const feed = {
    sport: 'mlb',
    url: () => 'https://example.test/x',
    parse: () => [],
    rowCount: () => 0,
    gameState: () => 'in'
  };
  const failures = [];
  const poller = createPoller({
    feed, eventId: '1', fetchImpl: okFetch,
    onEvents: () => {},
    onFailure: (reason) => failures.push(reason)
  });

  for (let i = 0; i < EMPTY_POLLS_BEFORE_DEGRADE; i += 1) await poller.tick();

  assert.deepEqual(failures, ['empty-feed']);
});

test('rows that never parse eventually degrade, at the longer threshold', async () => {
  const feed = {
    sport: 'mlb',
    url: () => 'https://example.test/x',
    parse: () => [],
    rowCount: () => 120,
    gameState: () => 'in'
  };
  const failures = [];
  const poller = createPoller({
    feed, eventId: '1', fetchImpl: okFetch,
    onEvents: () => {},
    onFailure: (reason) => failures.push(reason)
  });

  for (let i = 0; i < UNPARSED_POLLS_BEFORE_DEGRADE; i += 1) await poller.tick();

  assert.deepEqual(failures, ['unparsed-feed']);
});

// The structured feeds return the whole game, not a delta, so the first fetch
// of a live game is a full backlog. prime() is what stops that backlog from
// being mistaken for news.
test('prime marks the current feed seen and returns it without emitting', async () => {
  const feed = feedReturning([
    [{ id: 'a' }, { id: 'b' }],
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  ]);
  const emitted = [];
  const poller = createPoller({
    feed, eventId: '1', fetchImpl: okFetch,
    onEvents: (evts) => emitted.push(...evts.map(e => e.id))
  });

  const primed = await poller.prime();

  assert.equal(primed.ok, true);
  assert.deepEqual(primed.events.map(e => e.id), ['a', 'b'], 'prime hands back what it swallowed');
  assert.deepEqual(emitted, [], 'prime must not emit');

  await poller.tick();
  assert.deepEqual(emitted, ['c'], 'only what arrived after priming is news');
});

test('prime reports the game state so a finished game is not primed into silence', async () => {
  const feed = {
    sport: 'nfl',
    url: () => 'https://example.test/x',
    parse: () => [{ id: 'a' }],
    gameState: () => 'post'
  };
  const poller = createPoller({ feed, eventId: '1', fetchImpl: okFetch, onEvents: () => {} });
  const primed = await poller.prime();
  assert.equal(primed.state, 'post');
});

test('a failed prime swallows nothing, so the backlog is still there to fall back on', async () => {
  const feed = feedReturning([[{ id: 'a' }]]);
  const poller = createPoller({
    feed, eventId: '1', fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    onEvents: () => {}
  });

  const primed = await poller.prime();

  assert.equal(primed.ok, false);
  assert.deepEqual(primed.events, []);
  assert.equal(poller.seenCount(), 0, 'nothing may be marked seen from a fetch that failed');
});

test('prime does not count toward the empty-feed degrade threshold', async () => {
  const feed = { sport: 'nfl', url: () => 'https://example.test/x', parse: () => [], rowCount: () => 0 };
  const failures = [];
  const poller = createPoller({
    feed, eventId: '1', fetchImpl: okFetch,
    onEvents: () => {}, onFailure: (r) => failures.push(r)
  });

  for (let i = 0; i < EMPTY_POLLS_BEFORE_DEGRADE; i += 1) await poller.prime();

  assert.deepEqual(failures, [], 'priming is not evidence about the feed being broken');
});
