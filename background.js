// background.js — service worker (ES module; manifest sets "type": "module")
import { createSession } from './src/session.js';
import { once } from './src/once.js';
import {
  RuleExplainer, createClaudeExplainer, createDailyBudget, createExplainerChain
} from './src/explainers/index.js';

const sessions = new Map(); // tabId -> session (lost if the worker restarts)
// tabId -> in-flight session-construction promise. Guards against two
// messages for the same tab (two poll beats, start racing a poll, a burst
// delivered as the worker wakes from termination) each building and pumping
// their own session before either reaches sessions.set — see Task 9 fix
// round 1. Concurrent callers must all receive the same session object.
const inFlight = new Map();

const seenKey = (tabId) => `seen-${tabId}`;

const localStorageGet = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve));
const localStorageSet = (items) => new Promise((resolve) => chrome.storage.local.set(items, resolve));

// One ledger for the whole worker. DAILY_CALL_CAP is a per-install spending
// limit, so it must not follow the per-tab explainer lifetime below: two tabs
// each holding their own counter would spend 2x the cap and overwrite each
// other's stored count.
const claudeBudget = createDailyBudget({
  getBudget: async () => (await localStorageGet(['claudeBudget'])).claudeBudget || null,
  setBudget: async (budget) => localStorageSet({ claudeBudget: budget })
});

// Built per tab inside ensureSession, so isCancelled can be bound to THIS
// tab's liveness. stopSession deletes the map entry, so an in-flight call is
// cancelled the moment the user stops monitoring.
function buildExplainer(tabId) {
  const claude = createClaudeExplainer({
    getKey: async () => (await localStorageGet(['anthropicApiKey'])).anthropicApiKey || null,
    budget: claudeBudget,
    isCancelled: () => !sessions.has(tabId)
  });
  return createExplainerChain([claude, RuleExplainer]);
}

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
  // A stop mid-construction must not leave a stale in-flight promise that a
  // later message would be handed back.
  inFlight.delete(tabId);
}

// Rebuilds the session if the worker was terminated since the last message,
// seeding it with the ids already shown so the game is not replayed.
// Construction is memoised per tab via `once` so that two messages for the
// same tab arriving before the first session finishes building (two poll
// beats, start racing a poll, a burst on worker wake) share the same
// in-progress construction instead of each building — and pumping — their
// own session.
async function ensureSession(tabId, url) {
  const existing = sessions.get(tabId);
  if (existing) return existing;

  return once(inFlight, tabId, async () => {
    const stored = await storageGet([seenKey(tabId)]);
    const seed = stored[seenKey(tabId)] || [];
    const session = createSession({
      tabId,
      url,
      deps: { fetchImpl: (u) => fetch(u), sendToTab, explainer: buildExplainer(tabId) },
      seed
    });
    const started = await session.start();
    if (!started) return null;
    sessions.set(tabId, session);
    return session;
  });
}

async function pumpAndSave(session, tabId) {
  await session.pump();
  await storageSet({ [seenKey(tabId)]: session.seenIds() });
  // The game ended during this pump. Drop the session so the next beat cannot
  // rebuild and re-poll it; the content script stops its clock off the
  // `finished` flag in the reply, and this is the belt to that braces.
  if (session.state().finished) {
    stopSession(tabId);
    await storageRemove([seenKey(tabId)]);
  }
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
      })
      // Without this, a rejected storage call, session.start(), or fetch
      // never reaches sendResponse and the caller's callback silently hangs.
      .catch((err) => {
        sendResponse({ ok: false, reason: 'error', message: String(err && err.message || err) });
      });
    return true;
  }

  // The content script owns the clock and beats every 10s. Each beat both
  // drives one poll cycle and resets this worker's 30s idle timer.
  if (request.action === 'poll') {
    ensureSession(tabId, request.url)
      .then(async (session) => {
        if (!session) {
          sendResponse({ ok: false, reason: 'not-a-game' });
          return;
        }
        await pumpAndSave(session, tabId);
        sendResponse({ ok: true, state: session.state() });
      })
      .catch((err) => {
        sendResponse({ ok: false, reason: 'error', message: String(err && err.message || err) });
      });
    return true;
  }

  if (request.action === 'stop') {
    stopSession(tabId);
    storageRemove([seenKey(tabId)])
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        sendResponse({ ok: false, reason: 'error', message: String(err && err.message || err) });
      });
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
