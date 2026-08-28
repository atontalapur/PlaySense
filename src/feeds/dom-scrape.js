import { makeEvent } from '../events.js';

// Stable hash so the same scraped sentence always yields the same id and the
// poller's Set suppresses it. Scraped rows carry no feed-provided id.
function hashText(input) {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return `dom-${(h >>> 0).toString(36)}`;
}

export function createDomScrapeFeed(sport) {
  return {
    sport,
    url: () => 'dom://scrape',
    parse(rows) {
      if (!Array.isArray(rows)) return [];
      return rows
        .filter(r => r && typeof r.text === 'string' && r.text.trim().length > 0)
        .map(r => {
          const text = r.text.trim();
          const event = makeEvent({
            id: hashText(text),
            sport,
            type: r.type || null,
            text,
            period: null,
            clock: null,
            score: null,
            isScoring: false
          });
          // Marks provenance. The Claude explainer must refuse these — scraped
          // text has no schema and must never be sent to the model.
          event.degraded = true;
          return event;
        });
    }
  };
}

export function createTabScrapeFetch(tabId, sendMessageImpl) {
  return async function scrapeFetch() {
    let reply;
    try {
      reply = await sendMessageImpl(tabId, { action: 'legacyScrape' });
    } catch {
      return { ok: false, status: 0, json: async () => [] };
    }
    if (!reply || !Array.isArray(reply.rows)) {
      return { ok: false, status: 0, json: async () => [] };
    }
    return { ok: true, status: 200, json: async () => reply.rows };
  };
}
