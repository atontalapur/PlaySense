// background.js — service worker (ES module; manifest sets "type": "module")
import { createSession } from './src/session.js';

const sessions = new Map(); // tabId -> session (lost if the worker restarts)

const seenKey = (tabId) => `seen-${tabId}`;

// chrome.storage.session is in-memory and cleared when the browser session ends,
// but it SURVIVES a service worker restart — which the in-memory Map does not.
const storageGet = (keys) => new Promise((r) => chrome.storage.session.get(keys, r));
const storageSet = (items) => new Promise((r) => chrome.storage.session.set(items, r));
const storageRemove = (keys) => new Promise((r) => chrome.storage.session.remove(keys, r));

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (reply) => {
      // Reading lastError suppresses the unchecked-error warning when the
      // content script is not present on the page.
      void chrome.runtime.lastError;
      resolve(reply);
    });
  });
}

function stopSession(tabId) {
  const session = sessions.get(tabId);
  if (session) {
    session.stop();
    sessions.delete(tabId);
  }
}

// Rebuilds the session if the worker was terminated since the last message,
// seeding it with the ids already shown so the game is not replayed.
async function ensureSession(tabId, url) {
  const existing = sessions.get(tabId);
  if (existing) return existing;

  const stored = await storageGet([seenKey(tabId)]);
  const seed = stored[seenKey(tabId)] || [];
  const session = createSession({
    tabId,
    url,
    deps: { fetchImpl: (u) => fetch(u), sendToTab },
    seed
  });
  const started = await session.start();
  if (!started) return null;
  sessions.set(tabId, session);
  return session;
}

async function pumpAndSave(session, tabId) {
  await session.pump();
  await storageSet({ [seenKey(tabId)]: session.seenIds() });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : request.tabId;
  if (typeof tabId !== 'number') {
    sendResponse({ ok: false, reason: 'no-tab' });
    return false;
  }

  if (request.action === 'start') {
    stopSession(tabId);
    storageRemove([seenKey(tabId)])
      .then(() => ensureSession(tabId, request.url))
      .then(async (session) => {
        if (session) await pumpAndSave(session, tabId);
        sendResponse({ ok: Boolean(session), state: session ? session.state() : null });
      });
    return true;
  }

  // The content script owns the clock and beats every 10s. Each beat both
  // drives one poll cycle and resets this worker's 30s idle timer.
  if (request.action === 'poll') {
    ensureSession(tabId, request.url).then(async (session) => {
      if (!session) {
        sendResponse({ ok: false, reason: 'not-a-game' });
        return;
      }
      await pumpAndSave(session, tabId);
      sendResponse({ ok: true, state: session.state() });
    });
    return true;
  }

  if (request.action === 'stop') {
    stopSession(tabId);
    storageRemove([seenKey(tabId)]).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (request.action === 'getStatus') {
    const session = sessions.get(tabId);
    sendResponse({ ok: true, state: session ? session.state() : null });
    return false;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  stopSession(tabId);
  chrome.storage.session.remove(seenKey(tabId));
});
