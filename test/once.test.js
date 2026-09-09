import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from '../src/once.js';

test('concurrent callers for the same key share one factory call and one result', async () => {
  const inFlight = new Map();
  let calls = 0;
  const factory = () => new Promise((resolve) => {
    calls++;
    setTimeout(() => resolve(calls), 0);
  });

  const [a, b] = await Promise.all([
    once(inFlight, 'tab-1', factory),
    once(inFlight, 'tab-1', factory)
  ]);

  assert.equal(calls, 1, 'the factory must run at most once per key while in flight');
  assert.equal(a, b, 'concurrent callers must receive the same settled value');
  assert.equal(inFlight.has('tab-1'), false, 'the key is cleared once the promise settles');
});

test('a later call after settlement constructs again', async () => {
  const inFlight = new Map();
  let calls = 0;
  const factory = () => Promise.resolve(++calls);

  const first = await once(inFlight, 'tab-1', factory);
  const second = await once(inFlight, 'tab-1', factory);

  assert.equal(first, 1);
  assert.equal(second, 2, 'a call after the prior one settled must run the factory again');
});

test('a rejected factory clears the key so a retry can construct again', async () => {
  const inFlight = new Map();
  let calls = 0;
  const factory = () => {
    calls++;
    return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve('ok');
  };

  await assert.rejects(once(inFlight, 'tab-1', factory));
  assert.equal(inFlight.has('tab-1'), false, 'a rejection must clear the in-flight entry');

  const retried = await once(inFlight, 'tab-1', factory);
  assert.equal(retried, 'ok');
  assert.equal(calls, 2);
});

test('different keys do not share a factory call', async () => {
  const inFlight = new Map();
  let calls = 0;
  const factory = () => Promise.resolve(++calls);

  const [a, b] = await Promise.all([
    once(inFlight, 'tab-1', factory),
    once(inFlight, 'tab-2', factory)
  ]);

  assert.equal(calls, 2);
  assert.notEqual(a, b);
});
