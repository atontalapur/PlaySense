import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, RECAP_EVENTS } from '../src/session.js';

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
  // Degradation needs consecutive failures now, so one pump is not enough.
  await session.pump();
  assert.equal(session.state().degraded, false, 'one bad poll is not a broken feed');
  await session.pump();
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
  const afterPrime = ticks;
  assert.equal(afterPrime, 1, 'start() spends exactly one fetch priming');
  await session.pump();
  await session.pump();
  assert.equal(ticks - afterPrime, 2);
  session.stop();
  await session.pump();
  assert.equal(ticks - afterPrime, 2, 'a stopped session must not poll');
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

  // Seeded, so this is a worker that restarted mid-game and skips the priming
  // fetch. That is the only way a full backlog reaches emit() — a fresh session
  // swallows it — and a backlog in flight is exactly what this regression is
  // about. The id is not in the feed, so nothing is suppressed by it.
  const session = createSession({
    tabId: 1, url: 'https://www.espn.com/nfl/game/_/gameId/401873298',
    deps: d, seed: ['resumed']
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

  // Seeded for the same reason as the test above: a resumed session skips
  // priming, so the whole backlog reaches emit() and stop() has something left
  // to halt.
  session = createSession({
    tabId: 1, url: 'https://www.espn.com/nfl/game/_/gameId/401873298',
    deps: d, seed: ['resumed']
  });
  await session.start();
  await session.pump();

  assert.deepEqual(delivered, ['s0'], 'only the play explained before stop is delivered');
});

// The headline regression. ESPN's summary endpoint returns every play since
// kickoff, so before priming, clicking "Start Monitoring" in the fourth quarter
// replayed the whole game: 146 events and 32 serial paid explainer calls on the
// recorded NFL fixture, with a blank overlay for the minute those calls took.
test('a fresh session does not replay the backlog it starts in the middle of', async () => {
  const backlog = Array.from({ length: 40 }, (_, i) => ({
    id: `b${i}`,
    type: { text: 'Touchdown' },
    text: `Touchdown number ${i}`,
    scoringPlay: true
  }));
  const live = { id: 'live', type: { text: 'Sack' }, text: 'Sack for a loss of 6' };

  let plays = backlog;
  const delivered = [];
  let explainCalls = 0;
  const d = deps({
    fetchImpl: async () => ({ ok: true, json: async () => ({ drives: { previous: [{ plays }] } }) }),
    explainer: { explain: async () => { explainCalls += 1; return 'explained'; } },
    sendToTab: async (tabId, msg) => {
      if (msg.action === 'events') delivered.push(...msg.events.map(e => e.id));
      return {};
    }
  });

  const session = createSession({
    tabId: 1, url: 'https://www.espn.com/nfl/game/_/gameId/401873298', deps: d
  });
  await session.start();
  await session.pump();

  assert.equal(delivered.length, RECAP_EVENTS, 'only the recap, not the whole game');
  assert.deepEqual(delivered, ['b38', 'b39'], 'the recap is the most recent plays');
  assert.equal(explainCalls, RECAP_EVENTS, 'the backlog must not be paid for');

  plays = [...backlog, live];
  await session.pump();
  assert.deepEqual(delivered.slice(-1), ['live'], 'what happens next still arrives');
  session.stop();
});

test('the recap skips plays that are not worth interrupting for', async () => {
  const delivered = [];
  const d = deps({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ drives: { previous: [{ plays: [
        { id: '1', text: 'Sack', type: { text: 'Sack' } },
        { id: '2', text: 'Timeout', type: { text: 'Timeout' } },
        { id: '3', text: 'K.Johnson up the middle for 2 yards', type: { text: 'Rush' } }
      ] }] } })
    }),
    sendToTab: async (tabId, msg) => {
      if (msg.action === 'events') delivered.push(...msg.events.map(e => e.id));
      return {};
    }
  });

  const session = createSession({
    tabId: 1, url: 'https://www.espn.com/nfl/game/_/gameId/401873298', deps: d
  });
  await session.start();
  await session.pump();

  assert.deepEqual(delivered, ['1'], 'a timeout and a routine rush are not recap material');
  session.stop();
});

// The other half of the contract: priming must not eat a restarted worker's gap.
test('a resumed session does not prime, so plays missed while it was down still arrive', async () => {
  const delivered = [];
  const d = deps({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ drives: { previous: [{ plays: [
        { id: 'before', text: 'Sack', type: { text: 'Sack' } },
        { id: 'during', text: 'Intercepted', type: { text: 'Pass Interception Return' } }
      ] }] } })
    }),
    sendToTab: async (tabId, msg) => {
      if (msg.action === 'events') delivered.push(...msg.events.map(e => e.id));
      return {};
    }
  });

  const session = createSession({
    tabId: 1, url: 'https://www.espn.com/nfl/game/_/gameId/401873298',
    deps: d, seed: ['before']
  });
  await session.start();
  await session.pump();

  assert.deepEqual(delivered, ['during'], 'the play that landed while the worker was down');
  session.stop();
});

test('stopping before the first pump discards the recap rather than paying for it', async () => {
  const delivered = [];
  let explainCalls = 0;
  const d = deps({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ drives: { previous: [{ plays: [
        { id: '1', text: 'Sack', type: { text: 'Sack' } }
      ] }] } })
    }),
    explainer: { explain: async () => { explainCalls += 1; return 'explained'; } },
    sendToTab: async (tabId, msg) => {
      if (msg.action === 'events') delivered.push(...msg.events.map(e => e.id));
      return {};
    }
  });

  const session = createSession({
    tabId: 1, url: 'https://www.espn.com/nfl/game/_/gameId/401873298', deps: d
  });
  await session.start();
  session.stop();
  await session.pump();

  assert.deepEqual(delivered, []);
  assert.equal(explainCalls, 0);
});
