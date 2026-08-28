import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/session.js';

function deps(overrides = {}) {
  return {
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    sendToTab: async () => ({ rows: [] }),
    sent: [],
    ...overrides
  };
}

test('refuses to start on a non-game url', async () => {
  const d = deps();
  const session = createSession({ tabId: 1, url: 'https://www.espn.com/', deps: d });
  const started = await session.start();
  assert.equal(started, false);
  assert.equal(session.state().sport, null);
});

test('starts on a recognised game url and reports the sport', async () => {
  const d = deps();
  const session = createSession({
    tabId: 1, url: 'https://www.espn.com/nfl/game/_/gameId/401873298', deps: d
  });
  const started = await session.start();
  assert.equal(started, true);
  assert.equal(session.state().sport, 'nfl');
  assert.equal(session.state().eventId, '401873298');
  session.stop();
});

test('falls back to dom scraping when the structured feed fails', async () => {
  const messages = [];
  const d = deps({
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    sendToTab: async (tabId, msg) => {
      messages.push(msg);
      return { rows: [{ text: 'Touchdown' }] };
    }
  });
  const session = createSession({
    tabId: 1, url: 'https://www.espn.com/nfl/game/_/gameId/401873298', deps: d
  });
  await session.start();
  await session.pump();

  assert.equal(session.state().degraded, true);
  assert.ok(messages.some(m => m.action === 'degraded'), 'must notify the content script');
  session.stop();
});

test('emits events to the tab', async () => {
  const messages = [];
  const d = deps({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ drives: { previous: [{ plays: [{ id: '9', text: 'Sack', type: { text: 'Sack' } }] }] } })
    }),
    sendToTab: async (tabId, msg) => { messages.push(msg); return {}; }
  });
  const session = createSession({
    tabId: 1, url: 'https://www.espn.com/nfl/game/_/gameId/401873298', deps: d
  });
  await session.start();
  await session.pump();

  const evtMsg = messages.find(m => m.action === 'events');
  assert.ok(evtMsg, 'expected an events message');
  assert.equal(evtMsg.events[0].text, 'Sack');
  session.stop();
});

test('low importance events are never sent to the tab', async () => {
  const messages = [];
  const d = deps({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        drives: { previous: [{ plays: [
          { id: '1', text: 'Timeout', type: { text: 'Timeout' } },
          { id: '2', text: 'Sack', type: { text: 'Sack' } }
        ] }] }
      })
    }),
    sendToTab: async (tabId, msg) => { messages.push(msg); return {}; }
  });
  const session = createSession({
    tabId: 1, url: 'https://www.espn.com/nfl/game/_/gameId/401873298', deps: d
  });
  await session.start();
  await session.pump();

  const evtMsg = messages.find(m => m.action === 'events');
  assert.equal(evtMsg.events.length, 1);
  assert.equal(evtMsg.events[0].text, 'Sack');
  session.stop();
});

test('each pump performs one poll cycle', async () => {
  let ticks = 0;
  const d = deps({
    fetchImpl: async () => { ticks++; return { ok: true, json: async () => ({}) }; }
  });
  const session = createSession({
    tabId: 1, url: 'https://www.espn.com/nfl/game/_/gameId/401873298', deps: d
  });
  await session.start();
  await session.pump();
  await session.pump();
  assert.equal(ticks, 2);
  session.stop();
  await session.pump();
  assert.equal(ticks, 2, 'a stopped session must not poll');
});

test('a rebuilt session seeded with prior ids does not replay them', async () => {
  const messages = [];
  const d = deps({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ drives: { previous: [{ plays: [
        { id: '1', text: 'Sack', type: { text: 'Sack' } },
        { id: '2', text: 'Interception', type: { text: 'Pass Interception Return' } }
      ] }] } })
    }),
    sendToTab: async (tabId, msg) => { messages.push(msg); return {}; }
  });
  const session = createSession({
    tabId: 1, url: 'https://www.espn.com/nfl/game/_/gameId/401873298',
    deps: d, seed: ['1']
  });
  await session.start();
  await session.pump();
  const evt = messages.find(m => m.action === 'events');
  assert.equal(evt.events.length, 1);
  assert.equal(evt.events[0].id, '2');
  session.stop();
});

// Regression: emit() is async (it awaits a paid explainer call per event), so
// onEvents must RETURN that promise or poller.tick()'s await awaits undefined.
// The mocks here resolve on macrotasks deliberately — a microtask-resolving
// mock passes whether or not the promise is returned.
test('pump does not resolve until emission has been delivered', async () => {
  const messages = [];
  const macrotask = () => new Promise(resolve => setTimeout(resolve, 5));
  const d = deps({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ drives: { previous: [{ plays: [
        { id: '9', text: 'Sack', type: { text: 'Sack' } }
      ] }] } })
    }),
    explainer: { explain: async () => { await macrotask(); return 'a sack'; } },
    sendToTab: async (tabId, msg) => { await macrotask(); messages.push(msg); return {}; }
  });
  const session = createSession({
    tabId: 1, url: 'https://www.espn.com/nfl/game/_/gameId/401873298', deps: d
  });
  await session.start();
  await session.pump();

  const evtMsg = messages.find(m => m.action === 'events');
  assert.ok(evtMsg, 'the events message must have been sent before pump() resolved');
  assert.equal(evtMsg.events[0].explanation, 'a sack');
  session.stop();
});

test('a finished game stops the session and notifies the tab', async () => {
  const messages = [];
  const d = deps({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        header: { competitions: [{ status: { type: { state: 'post' } } }] },
        drives: { previous: [{ plays: [{ id: '9', text: 'Sack', type: { text: 'Sack' } }] }] }
      })
    }),
    sendToTab: async (tabId, msg) => { messages.push(msg); return {}; }
  });
  const session = createSession({
    tabId: 1, url: 'https://www.espn.com/nfl/game/_/gameId/401873298', deps: d
  });
  await session.start();
  await session.pump();

  assert.ok(messages.some(m => m.action === 'events'), 'the final plays are still delivered');
  assert.ok(messages.some(m => m.action === 'finished'), 'the tab must be told to stop beating');
  assert.equal(session.state().finished, true);
  assert.equal(session.state().active, false, 'a finished session must not keep polling');
});

// N3 regression: switchToFinished nulls the poller, and emit()'s backlog guard
// used to read `!poller`. A second beat that lands while an earlier emit is
// still awaiting explainer calls finishes the game and nulls the poller, so the
// first emit truncated final plays whose ids tick() had already marked seen —
// losing them permanently, since the ids never come back as fresh.
test('finishing mid-backlog does not truncate the plays already marked seen', async () => {
  const plays = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i}`,
    type: { text: 'Touchdown' },
    text: `Touchdown number ${i}`,
    scoringPlay: true,
    period: { number: 4 },
    clock: { displayValue: '0:10' },
    homeScore: 7 * i,
    awayScore: 0
  }));
  const summary = {
    header: { competitions: [{ status: { type: { state: 'post' } } }] },
    drives: { previous: [{ plays }] }
  };

  const delivered = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  let firstCall = true;

  const d = deps({
    fetchImpl: async () => ({ ok: true, json: async () => summary }),
    sendToTab: async (tabId, msg) => {
      if (msg.action === 'events') delivered.push(...msg.events.map(e => e.id));
      return { rows: [] };
    },
    explainer: {
      // Hold the first explanation open so the emit loop is still in flight
      // when the second beat lands and finishes the game.
      async explain() {
        if (firstCall) { firstCall = false; await gate; }
        return 'explained';
      }
    }
  });

  const session = createSession({
    tabId: 1, url: 'https://www.espn.com/nfl/game/_/gameId/401873298', deps: d
  });
  await session.start();

  // Beat one stalls inside emit. Beat two sees every id already marked seen,
  // emits nothing, reads state 'post' and finishes the session out from under
  // the first beat.
  const first = session.pump();
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  const second = session.pump();
  await second;
  assert.equal(session.state().finished, true, 'the second beat should finish the game');

  release();
  await first;

  assert.deepEqual(delivered, ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
});

test('stop still halts the remaining backlog', async () => {
  const plays = Array.from({ length: 4 }, (_, i) => ({
    id: `s${i}`,
    type: { text: 'Touchdown' },
    text: `Touchdown number ${i}`,
    scoringPlay: true,
    period: { number: 2 },
    clock: { displayValue: '5:00' },
    homeScore: 7 * i,
    awayScore: 0
  }));
  const summary = { drives: { previous: [{ plays }] } };

  const delivered = [];
  let session;
  const d = deps({
    fetchImpl: async () => ({ ok: true, json: async () => summary }),
    sendToTab: async (tabId, msg) => {
      if (msg.action === 'events') delivered.push(...msg.events.map(e => e.id));
      return { rows: [] };
    },
    explainer: {
      async explain() {
        // The user stops monitoring partway through the paid backlog.
        session.stop();
        return 'explained';
      }
    }
  });

  session = createSession({
    tabId: 1, url: 'https://www.espn.com/nfl/game/_/gameId/401873298', deps: d
  });
  await session.start();
  await session.pump();

  assert.deepEqual(delivered, ['s0'], 'only the play explained before stop is delivered');
});
