import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPoller } from '../src/poller.js';

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
