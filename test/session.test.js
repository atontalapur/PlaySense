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
