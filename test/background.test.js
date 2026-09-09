import { test } from 'node:test';
import assert from 'node:assert/strict';

// background.js touches chrome.* at module scope, so the stub has to exist
// before the import and the module can only be loaded once per process.
function installChromeStub() {
  const session = new Map();
  const local = new Map();
  const listeners = [];
  const sent = [];

  const area = (store) => ({
    get: (keys, cb) => {
      const out = {};
      for (const k of [].concat(keys)) if (store.has(k)) out[k] = store.get(k);
      cb(out);
    },
    set: (items, cb) => {
      for (const [k, v] of Object.entries(items)) store.set(k, v);
      cb();
    },
    remove: (keys, cb) => {
      for (const k of [].concat(keys)) store.delete(k);
      cb();
    }
  });

  globalThis.chrome = {
    runtime: {
      lastError: null,
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: (fn) => listeners.push(fn) }
    },
    tabs: {
      onRemoved: { addListener: () => {} },
      sendMessage: (tabId, msg, cb) => {
        sent.push({ tabId, msg });
        if (cb) cb({ rows: [] });
      }
    },
    storage: { session: area(session), local: area(local) }
  };

  return { session, local, listeners, sent };
}

const stub = installChromeStub();
await import('../background.js');

const send = (request, sender) =>
  new Promise((resolve) => {
    stub.listeners[0](request, sender, resolve);
  });

const finishedSummary = (plays) => ({
  header: { competitions: [{ status: { type: { state: 'post' } } }] },
  drives: { previous: [{ plays }] }
});

// N2 regression: pumpAndSave used to clear the tab's seen ids when a game
// finished. A beat already in flight then rebuilt the session with an empty
// seed and replayed the whole game as fresh events, billing a Claude call for
// every high-importance play in it.
test('a finished game keeps its seen ids so a late beat cannot replay it', async () => {
  const plays = [
    {
      id: 'tdA',
      type: { text: 'Touchdown' },
      text: 'Touchdown on the final play',
      scoringPlay: true,
      period: { number: 4 },
      clock: { displayValue: '0:00' },
      homeScore: 21,
      awayScore: 14
    }
  ];
  globalThis.fetch = async () => ({ ok: true, json: async () => finishedSummary(plays) });

  const url = 'https://www.espn.com/nfl/game/_/gameId/401873298';
  const reply = await send({ action: 'start', url }, { tab: { id: 42 } });

  assert.equal(reply.ok, true);
  assert.equal(reply.state.finished, true, 'the post state should finish the session');

  const stored = stub.session.get('seen-42');
  assert.ok(Array.isArray(stored) && stored.includes('tdA'),
    'the finished game\'s seen ids must survive so a late beat re-emits nothing');

  const delivered = stub.sent.filter(s => s.msg.action === 'events');
  assert.equal(delivered.length, 1, 'the final play is delivered exactly once');

  // A beat that was already in flight when the game ended lands now.
  stub.sent.length = 0;
  await send({ action: 'poll', url }, { tab: { id: 42 } });
  const replayed = stub.sent.filter(s => s.msg.action === 'events');
  assert.deepEqual(replayed, [], 'the late beat must not replay the game');
});

const liveSummary = (plays) => ({
  header: { competitions: [{ status: { type: { state: 'in' } } }] },
  drives: { previous: [{ plays }] }
});

// A session under construction is not in `sessions` yet, so stopSession could
// not reach it and the factory installed it anyway: it went on polling and
// emitting, and read as live to the Claude explainer's isCancelled — the check
// that is meant to stop a stopped user being billed for the rest of a backlog.
test('a stop that lands mid-construction cancels the session being built', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const plays = [{
    id: 'p1',
    type: { text: 'Pass Reception' },
    text: 'W.Howard pass short right to K.Coleman to BUF 40 for 12 yards',
    period: { number: 1 },
    clock: { displayValue: '10:00' },
    homeScore: 0,
    awayScore: 0
  }];
  globalThis.fetch = async () => {
    await held;
    return { ok: true, json: async () => liveSummary(plays) };
  };

  const url = 'https://www.espn.com/nfl/game/_/gameId/401873299';
  stub.sent.length = 0;
  const polling = send({ action: 'poll', url }, { tab: { id: 77 } });

  // Let construction reach its first fetch, then stop monitoring.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await send({ action: 'stop', url }, { tab: { id: 77 } });
  release();

  const reply = await polling;
  assert.equal(reply.ok, false, 'a cancelled construction must not report success');
  assert.deepEqual(
    stub.sent.filter(s => s.msg.action === 'events'), [],
    'and must not deliver events to a tab that has stopped'
  );

  const status = await send({ action: 'getStatus' }, { tab: { id: 77 } });
  assert.equal(status.state, null, 'and must not be installed as the tab\'s session');
});
