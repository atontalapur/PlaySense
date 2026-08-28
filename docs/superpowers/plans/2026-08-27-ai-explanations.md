# PlaySense Reliable Feeds + AI Explanations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PlaySense's DOM scraping with structured sport feeds, then add LLM-generated explanations behind a provider interface with the existing keyword rules as fallback.

**Architecture:** All network and parsing move into `background.js` (an ES module service worker) behind two interfaces — `GameFeed` and `ExplanationProvider`. `content.js` is reduced to UI: it renders normalized events and owns the overlay, and never calls `fetch`. Feeds and explainers never touch the DOM.

**Tech Stack:** Chrome Extension MV3, vanilla JS ES modules, `node --test` (Node 18+, zero dependencies), `chrome.storage.local`, Anthropic Messages API (`claude-haiku-4-5`).

**Spec:** `docs/superpowers/specs/2026-08-27-ai-explanations-design.md`

## Global Constraints

- Branch: `feat/ai-explanations`. Never commit to `main` or `production-ready`.
- Model ID is exactly `claude-haiku-4-5`. No date suffix.
- No emojis in code, UI copy, commit messages, or docs.
- No new runtime dependencies. Tests use `node --test` only. The shipped extension stays dependency-free.
- Run the suite with `npm test` (bare `node --test`, which auto-discovers). Do **not** write `node --test test/` — Node 24 resolves the directory as a module path and fails with `MODULE_NOT_FOUND`. Single files are fine: `node --test test/events.test.js`.
- `content.js` must never call `fetch`. All network lives in the service worker.
- Feed and explainer modules must never reference `document`, `window`, or any DOM API.
- The NFL/MLB `type.text` taxonomy is **open, not closed**. Unknown type values must classify as `normal` and never throw.
- Only `high`-importance events may reach the Anthropic API. `normal` uses rules only; `low` is suppressed.
- Anthropic API keys are read from `chrome.storage.local`, never logged, and never sent anywhere but `api.anthropic.com`.
- Conventional Commits. Commit at the end of every task.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Create | `{"type":"module"}` so Node and the SW both treat `src/` as ESM. Not shipped to CWS. |
| `src/events.js` | Create | `GameEvent` shape, `classifyImportance`, `IMPORTANCE` constants |
| `src/feeds/espn-nfl.js` | Create | ESPN NFL summary → `GameEvent[]` |
| `src/feeds/espn-mlb.js` | Create | ESPN MLB summary → `GameEvent[]` |
| `src/feeds/openf1.js` | Create | OpenF1 race control → `GameEvent[]` |
| `src/feeds/dom-scrape.js` | Create | Fallback feed; delegates to content script via messaging |
| `src/feeds/index.js` | Create | `detectGame(url)`, feed registry, fallback selection |
| `src/poller.js` | Create | Poll loop, id-based dedup, event dispatch |
| `src/explainers/rules.js` | Create | Keyword explanations extracted from `content.js` |
| `src/explainers/claude.js` | Create | Haiku 4.5 explainer, prompts, budget guard |
| `src/explainers/index.js` | Create | Provider chain: Claude → rules → null |
| `background.js` | Modify | Service worker orchestrator; owns poller and explainer chain |
| `content.js` | Modify | Strip scraping/explaining; UI only; legacy scrape kept behind a message handler |
| `popup.html` | Modify | API key entry, disclosure copy |
| `popup.js` | Modify | Key save/clear wiring |
| `manifest.json` | Modify | `host_permissions`, `background.type: module` |
| `privacy.html` | Rewrite | Truthful third-party disclosure |
| `test/fixtures/*.json` | Create | Recorded live responses |
| `test/*.test.js` | Create | Unit tests |

---

# Sprint 1 — Data Layer

---

### Task 1: Test harness and recorded fixtures

**Files:**
- Create: `package.json`
- Create: `test/fixtures/nfl-summary.json`
- Create: `test/fixtures/mlb-summary.json`
- Create: `test/fixtures/openf1-race-control.json`
- Create: `test/fixtures/README.md`

**Interfaces:**
- Consumes: nothing
- Produces: fixture files loaded by every later test via `JSON.parse(readFileSync(...))`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "playsense",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Record the fixtures**

These exact event IDs were verified live on 2026-08-27. Completed games return a stable full play list, so this is reproducible.

```bash
mkdir -p test/fixtures
curl -s "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873298" \
  -o test/fixtures/nfl-summary.json
curl -s "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=401816696" \
  -o test/fixtures/mlb-summary.json
curl -s "https://api.openf1.org/v1/race_control?session_key=11353" \
  -o test/fixtures/openf1-race-control.json
```

- [ ] **Step 3: Verify the fixtures have the expected shape**

```bash
node -e "
const fs=require('fs');
const nfl=JSON.parse(fs.readFileSync('test/fixtures/nfl-summary.json'));
const drives=nfl.drives;
const n=(drives.previous||[]).reduce((a,d)=>a+(d.plays||[]).length,0)+((drives.current&&drives.current.plays)||[]).length;
console.log('nfl plays:',n,'scoringPlays:',(nfl.scoringPlays||[]).length);
const mlb=JSON.parse(fs.readFileSync('test/fixtures/mlb-summary.json'));
console.log('mlb plays:',mlb.plays.length);
const f1=JSON.parse(fs.readFileSync('test/fixtures/openf1-race-control.json'));
console.log('f1 messages:',f1.length);
"
```

Expected: `nfl plays:` over 100, `mlb plays:` over 300, `f1 messages:` over 100. If any is 0, the endpoint changed — stop and report rather than proceeding with empty fixtures.

- [ ] **Step 4: Write `test/fixtures/README.md`**

```markdown
# Test fixtures

Recorded from live endpoints on 2026-08-27. Do not regenerate casually —
tests assert against specific counts in these files.

| File | Source |
|---|---|
| `nfl-summary.json` | `site.api.espn.com/.../football/nfl/summary?event=401873298` |
| `mlb-summary.json` | `site.api.espn.com/.../baseball/mlb/summary?event=401816696` |
| `openf1-race-control.json` | `api.openf1.org/v1/race_control?session_key=11353` |

Tests must never hit the network. If a fixture must be re-recorded, update
the asserted counts in the corresponding `.test.js` in the same commit.
```

- [ ] **Step 5: Verify the test runner works on an empty suite**

```bash
npm test
```

Expected: exits 0 with `tests 0`.

- [ ] **Step 6: Commit**

```bash
git add package.json test/
git commit -m "test: add node --test harness and recorded sport feed fixtures"
```

---

### Task 2: Event normalization and importance filter

**Files:**
- Create: `src/events.js`
- Test: `test/events.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `IMPORTANCE` — `{HIGH:'high', NORMAL:'normal', LOW:'low'}`
  - `classifyImportance(raw) -> 'high'|'normal'|'low'` where `raw` is `{sport, type, text, isScoring, scoreValue, downDistanceText, flag, category}`
  - `makeEvent(fields) -> GameEvent` — normalizes and attaches `importance`

- [ ] **Step 1: Write the failing test**

```js
// test/events.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyImportance, makeEvent, IMPORTANCE } from '../src/events.js';

test('scoring plays are high importance', () => {
  assert.equal(classifyImportance({ sport: 'nfl', type: 'Rush', isScoring: true }), IMPORTANCE.HIGH);
});

test('nfl turnovers and penalties are high importance', () => {
  for (const type of ['Penalty', 'Sack', 'Pass Interception Return', 'Muffed Punt Recovery (Opponent)']) {
    assert.equal(classifyImportance({ sport: 'nfl', type }), IMPORTANCE.HIGH, type);
  }
  assert.equal(
    classifyImportance({ sport: 'nfl', type: 'Rush', text: 'J.Allen FUMBLES, recovered by PIT' }),
    IMPORTANCE.HIGH
  );
});

test('nfl fourth down attempts are high importance', () => {
  assert.equal(
    classifyImportance({ sport: 'nfl', type: 'Rush', downDistanceText: '4th & 2 at PIT 40' }),
    IMPORTANCE.HIGH
  );
});

test('clock and administrative plays are low importance', () => {
  for (const type of ['Official Timeout', 'Timeout', 'End Period', 'End of Half', 'Two-minute warning']) {
    assert.equal(classifyImportance({ sport: 'nfl', type }), IMPORTANCE.LOW, type);
  }
});

test('routine nfl plays are normal importance', () => {
  assert.equal(classifyImportance({ sport: 'nfl', type: 'Rush' }), IMPORTANCE.NORMAL);
  assert.equal(classifyImportance({ sport: 'nfl', type: 'Pass Reception' }), IMPORTANCE.NORMAL);
});

test('unknown types classify as normal and never throw', () => {
  assert.equal(classifyImportance({ sport: 'nfl', type: 'Zamboni Interference' }), IMPORTANCE.NORMAL);
  assert.equal(classifyImportance({ sport: 'nfl' }), IMPORTANCE.NORMAL);
  assert.equal(classifyImportance({}), IMPORTANCE.NORMAL);
});

test('mlb non play-results are low, scoring is high', () => {
  assert.equal(classifyImportance({ sport: 'mlb', type: 'End Batter/Pitcher' }), IMPORTANCE.LOW);
  assert.equal(classifyImportance({ sport: 'mlb', type: 'Play Result', scoreValue: 2 }), IMPORTANCE.HIGH);
  assert.equal(
    classifyImportance({ sport: 'mlb', type: 'Play Result', text: 'Judge walked.' }),
    IMPORTANCE.HIGH
  );
  assert.equal(
    classifyImportance({ sport: 'mlb', type: 'Play Result', text: 'Paredes flied out to center.' }),
    IMPORTANCE.NORMAL
  );
});

test('f1 flags and safety cars are high, chatter is low', () => {
  assert.equal(classifyImportance({ sport: 'f1', category: 'Flag', flag: 'YELLOW' }), IMPORTANCE.HIGH);
  assert.equal(classifyImportance({ sport: 'f1', category: 'SafetyCar' }), IMPORTANCE.HIGH);
  assert.equal(classifyImportance({ sport: 'f1', category: 'Other', flag: null }), IMPORTANCE.LOW);
});

test('makeEvent attaches importance and preserves feed text verbatim', () => {
  const e = makeEvent({
    id: 'p1', sport: 'nfl', type: 'Rushing Touchdown',
    text: 'K.Johnson up the middle for 6 yards, TOUCHDOWN.',
    period: { type: 'Quarter', number: 3, display: '3rd Quarter' },
    clock: '2:14', score: { home: 21, away: 17 }, isScoring: true
  });
  assert.equal(e.importance, IMPORTANCE.HIGH);
  assert.equal(e.text, 'K.Johnson up the middle for 6 yards, TOUCHDOWN.');
  assert.equal(e.id, 'p1');
  assert.equal(e.sport, 'nfl');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/events.test.js`
Expected: FAIL — `Cannot find module '../src/events.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/events.js

export const IMPORTANCE = { HIGH: 'high', NORMAL: 'normal', LOW: 'low' };

const CLOCK_TYPES = new Set([
  'Official Timeout', 'Timeout', 'End Period', 'End of Half',
  'Two-minute warning', 'End Game'
]);

const NFL_HIGH_TYPES = new Set([
  'Penalty', 'Sack', 'Pass Interception Return',
  'Muffed Punt Recovery (Opponent)', 'Fumble Recovery (Opponent)', 'Safety'
]);

const F1_HIGH_CATEGORIES = new Set(['SafetyCar', 'Flag', 'Drs', 'VirtualSafetyCar']);

const NFL_TURNOVER_TEXT = /\bfumble|intercepted|interception\b/i;
const MLB_HIGH_TEXT = /\bwalk(?:ed|s)?\b|\bstruck out\b|\bhome run\b|\bhomer(?:ed|s)?\b|\bstole\b|\bdouble play\b|\berror\b/i;

// The feed taxonomies are open sets. Anything unrecognised must fall through
// to NORMAL rather than throw — a new ESPN play type must never break a game.
export function classifyImportance(raw = {}) {
  const type = raw.type || '';
  const text = raw.text || '';

  if (raw.isScoring === true) return IMPORTANCE.HIGH;

  if (raw.sport === 'f1') {
    if (raw.flag) return IMPORTANCE.HIGH;
    if (F1_HIGH_CATEGORIES.has(raw.category)) return IMPORTANCE.HIGH;
    return IMPORTANCE.LOW;
  }

  if (CLOCK_TYPES.has(type)) return IMPORTANCE.LOW;

  if (raw.sport === 'mlb') {
    if (type !== 'Play Result') return IMPORTANCE.LOW;
    if (Number(raw.scoreValue) > 0) return IMPORTANCE.HIGH;
    if (MLB_HIGH_TEXT.test(text)) return IMPORTANCE.HIGH;
    return IMPORTANCE.NORMAL;
  }

  if (raw.sport === 'nfl') {
    if (NFL_HIGH_TYPES.has(type)) return IMPORTANCE.HIGH;
    if (NFL_TURNOVER_TEXT.test(text)) return IMPORTANCE.HIGH;
    if (/^4th/i.test(raw.downDistanceText || '')) return IMPORTANCE.HIGH;
    return IMPORTANCE.NORMAL;
  }

  return IMPORTANCE.NORMAL;
}

export function makeEvent(fields) {
  return {
    id: String(fields.id),
    sport: fields.sport,
    type: fields.type || null,
    text: fields.text || '',
    period: fields.period || null,
    clock: fields.clock || null,
    score: fields.score || null,
    isScoring: fields.isScoring === true,
    importance: classifyImportance(fields)
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/events.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/events.js test/events.test.js
git commit -m "feat: add GameEvent normalization and importance filter"
```

---

### Task 3: ESPN NFL feed

**Files:**
- Create: `src/feeds/espn-nfl.js`
- Test: `test/espn-nfl.test.js`

**Interfaces:**
- Consumes: `makeEvent`, `IMPORTANCE` from `src/events.js`
- Produces:
  - `parseNflSummary(json) -> GameEvent[]` (pure, testable)
  - `EspnNflFeed` — object with `sport: 'nfl'`, `url(eventId) -> string`, `parse(json) -> GameEvent[]`

- [ ] **Step 1: Write the failing test**

```js
// test/espn-nfl.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNflSummary, EspnNflFeed } from '../src/feeds/espn-nfl.js';
import { IMPORTANCE } from '../src/events.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/nfl-summary.json', import.meta.url)));

test('parses every play from both current and previous drives', () => {
  const events = parseNflSummary(fixture);
  assert.ok(events.length > 100, `expected >100 plays, got ${events.length}`);
});

test('every event has a stable non-empty id and no duplicates', () => {
  const events = parseNflSummary(fixture);
  const ids = events.map(e => e.id);
  assert.ok(ids.every(id => typeof id === 'string' && id.length > 0));
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
});

test('the in-progress drive is not double-counted', () => {
  // ESPN repeats the current drive's plays inside drives.previous. The raw
  // flattened count is higher than the distinct count; parse must collapse it.
  const raw = (fixture.drives.previous || []).reduce((n, d) => n + (d.plays || []).length, 0)
    + ((fixture.drives.current && fixture.drives.current.plays) || []).length;
  const events = parseNflSummary(fixture);
  assert.ok(events.length < raw, `expected dedup: raw ${raw}, parsed ${events.length}`);
  assert.equal(events.length, new Set(events.map(e => e.id)).size);
});

test('scoring plays are detected and marked high importance', () => {
  const events = parseNflSummary(fixture);
  const scoring = events.filter(e => e.isScoring);
  assert.ok(scoring.length >= 4, `expected >=4 scoring plays, got ${scoring.length}`);
  assert.ok(scoring.every(e => e.importance === IMPORTANCE.HIGH));
});

test('play text and type are preserved verbatim from the feed', () => {
  const events = parseNflSummary(fixture);
  const withText = events.filter(e => e.text.length > 0);
  assert.ok(withText.length > 100);
  assert.ok(events.some(e => e.type === 'Rush'));
});

test('events carry period, clock and score', () => {
  const events = parseNflSummary(fixture);
  const e = events.find(x => x.type === 'Rush');
  assert.equal(e.sport, 'nfl');
  assert.equal(typeof e.period.number, 'number');
  assert.ok(e.score && typeof e.score.home === 'number');
});

test('malformed input returns an empty array rather than throwing', () => {
  assert.deepEqual(parseNflSummary(null), []);
  assert.deepEqual(parseNflSummary({}), []);
  assert.deepEqual(parseNflSummary({ drives: {} }), []);
});

test('feed builds the correct endpoint url', () => {
  assert.equal(
    EspnNflFeed.url('401873298'),
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873298'
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/espn-nfl.test.js`
Expected: FAIL — `Cannot find module '../src/feeds/espn-nfl.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/feeds/espn-nfl.js
import { makeEvent } from '../events.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';

function playToEvent(play, driveIndex, playIndex) {
  const id = play.id
    ? String(play.id)
    : `d${driveIndex}p${playIndex}-${play.sequenceNumber || ''}`;

  return makeEvent({
    id,
    sport: 'nfl',
    type: play.type && play.type.text ? play.type.text : null,
    text: (play.text || '').trim(),
    period: play.period
      ? { type: 'Quarter', number: play.period.number, display: `Q${play.period.number}` }
      : null,
    clock: play.clock ? play.clock.displayValue : null,
    score: {
      home: Number(play.homeScore) || 0,
      away: Number(play.awayScore) || 0
    },
    isScoring: play.scoringPlay === true,
    downDistanceText: play.start ? play.start.downDistanceText : ''
  });
}

export function parseNflSummary(json) {
  if (!json || typeof json !== 'object') return [];
  const drives = json.drives;
  if (!drives || typeof drives !== 'object') return [];

  const events = [];
  const previous = Array.isArray(drives.previous) ? drives.previous : [];

  previous.forEach((drive, di) => {
    const plays = Array.isArray(drive.plays) ? drive.plays : [];
    plays.forEach((play, pi) => events.push(playToEvent(play, di, pi)));
  });

  const currentPlays =
    drives.current && Array.isArray(drives.current.plays) ? drives.current.plays : [];
  currentPlays.forEach((play, pi) => events.push(playToEvent(play, 'cur', pi)));

  // ESPN lists the in-progress drive's plays in BOTH drives.previous and
  // drives.current, so the flattened list contains byte-identical repeats
  // sharing one id. Verified in the recorded fixture: 177 rows, 168 distinct.
  // Collapse them here, keeping first occurrence and preserving order.
  const seen = new Set();
  return events.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

export const EspnNflFeed = {
  sport: 'nfl',
  url: (eventId) => `${BASE}?event=${encodeURIComponent(eventId)}`,
  parse: parseNflSummary
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/espn-nfl.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/feeds/espn-nfl.js test/espn-nfl.test.js
git commit -m "feat: add ESPN NFL structured play feed"
```

---

### Task 4: ESPN MLB feed

**Files:**
- Create: `src/feeds/espn-mlb.js`
- Test: `test/espn-mlb.test.js`

**Interfaces:**
- Consumes: `makeEvent` from `src/events.js`
- Produces:
  - `parseMlbSummary(json) -> GameEvent[]`
  - `EspnMlbFeed` — `{sport:'mlb', url(eventId), parse(json)}`

- [ ] **Step 1: Write the failing test**

```js
// test/espn-mlb.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMlbSummary, EspnMlbFeed } from '../src/feeds/espn-mlb.js';
import { IMPORTANCE } from '../src/events.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/mlb-summary.json', import.meta.url)));

test('keeps only Play Result entries', () => {
  const events = parseMlbSummary(fixture);
  assert.ok(events.length > 20, `expected >20 play results, got ${events.length}`);
  assert.ok(events.length < fixture.plays.length, 'must filter out non-results');
  assert.ok(events.every(e => e.type === 'Play Result'));
});

test('ids are unique and stable', () => {
  const events = parseMlbSummary(fixture);
  const ids = events.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('period carries inning half and number', () => {
  const events = parseMlbSummary(fixture);
  const e = events[0];
  assert.equal(e.sport, 'mlb');
  assert.ok(['Top', 'Bottom'].includes(e.period.type));
  assert.equal(typeof e.period.number, 'number');
});

test('scoring at-bats are high importance', () => {
  const events = parseMlbSummary(fixture);
  const scoring = events.filter(e => e.isScoring);
  assert.ok(scoring.every(e => e.importance === IMPORTANCE.HIGH));
});

test('malformed input returns empty array', () => {
  assert.deepEqual(parseMlbSummary(null), []);
  assert.deepEqual(parseMlbSummary({}), []);
  assert.deepEqual(parseMlbSummary({ plays: 'nope' }), []);
});

test('feed builds the correct endpoint url', () => {
  assert.equal(
    EspnMlbFeed.url('401816696'),
    'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=401816696'
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/espn-mlb.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// src/feeds/espn-mlb.js
import { makeEvent } from '../events.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary';

export function parseMlbSummary(json) {
  if (!json || typeof json !== 'object') return [];
  const plays = json.plays;
  if (!Array.isArray(plays)) return [];

  return plays
    .filter(p => p && p.type && p.type.text === 'Play Result')
    .map((p, i) =>
      makeEvent({
        id: p.id ? String(p.id) : `${p.atBatId || 'ab'}-${p.sequenceNumber != null ? p.sequenceNumber : i}`,
        sport: 'mlb',
        type: p.type.text,
        text: (p.text || '').trim(),
        period: p.period
          ? {
              type: p.period.type || null,
              number: p.period.number,
              display: p.period.displayValue || `Inning ${p.period.number}`
            }
          : null,
        clock: null,
        score: {
          home: Number(p.homeScore) || 0,
          away: Number(p.awayScore) || 0
        },
        isScoring: p.scoringPlay === true || Number(p.scoreValue) > 0,
        scoreValue: Number(p.scoreValue) || 0
      })
    );
}

export const EspnMlbFeed = {
  sport: 'mlb',
  url: (eventId) => `${BASE}?event=${encodeURIComponent(eventId)}`,
  parse: parseMlbSummary
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/espn-mlb.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/feeds/espn-mlb.js test/espn-mlb.test.js
git commit -m "feat: add ESPN MLB structured play feed"
```

---

### Task 5: OpenF1 race control feed

**Files:**
- Create: `src/feeds/openf1.js`
- Test: `test/openf1.test.js`

**Interfaces:**
- Consumes: `makeEvent` from `src/events.js`
- Produces:
  - `parseRaceControl(json) -> GameEvent[]`
  - `OpenF1Feed` — `{sport:'f1', url(sessionKey), sessionsUrl(year), parse(json)}`

- [ ] **Step 1: Write the failing test**

```js
// test/openf1.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRaceControl, OpenF1Feed } from '../src/feeds/openf1.js';
import { IMPORTANCE } from '../src/events.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/openf1-race-control.json', import.meta.url)));

test('parses race control messages into events', () => {
  const events = parseRaceControl(fixture);
  assert.ok(events.length > 50, `expected >50 messages, got ${events.length}`);
  assert.ok(events.every(e => e.sport === 'f1'));
});

test('ids are unique', () => {
  const events = parseRaceControl(fixture);
  const ids = events.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('flagged messages are high importance, generic chatter is low', () => {
  const events = parseRaceControl(fixture);
  const flagged = events.filter(e => e.importance === IMPORTANCE.HIGH);
  const low = events.filter(e => e.importance === IMPORTANCE.LOW);
  assert.ok(flagged.length > 0, 'fixture should contain at least one flag or safety car');
  assert.ok(low.length > 0, 'fixture should contain generic Other messages');
});

test('message text is preserved verbatim', () => {
  const events = parseRaceControl(fixture);
  assert.ok(events.every(e => typeof e.text === 'string'));
  assert.ok(events.some(e => e.text.length > 0));
});

test('lap number is carried as period', () => {
  const events = parseRaceControl(fixture);
  const withLap = events.find(e => e.period && typeof e.period.number === 'number');
  assert.ok(withLap, 'at least one message should carry a lap number');
});

test('malformed input returns empty array', () => {
  assert.deepEqual(parseRaceControl(null), []);
  assert.deepEqual(parseRaceControl({}), []);
  assert.deepEqual(parseRaceControl('nope'), []);
});

test('feed builds correct urls', () => {
  assert.equal(
    OpenF1Feed.url('11353'),
    'https://api.openf1.org/v1/race_control?session_key=11353'
  );
  assert.equal(
    OpenF1Feed.sessionsUrl(2026),
    'https://api.openf1.org/v1/sessions?year=2026'
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/openf1.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// src/feeds/openf1.js
import { makeEvent } from '../events.js';

const BASE = 'https://api.openf1.org/v1';

export function parseRaceControl(json) {
  if (!Array.isArray(json)) return [];

  return json.map((m, i) =>
    makeEvent({
      id: `${m.session_key || 's'}-${m.date || i}-${i}`,
      sport: 'f1',
      type: m.category || null,
      text: (m.message || '').trim(),
      period:
        m.lap_number != null
          ? { type: 'Lap', number: m.lap_number, display: `Lap ${m.lap_number}` }
          : null,
      clock: m.date || null,
      score: null,
      isScoring: false,
      flag: m.flag || null,
      category: m.category || null
    })
  );
}

export const OpenF1Feed = {
  sport: 'f1',
  url: (sessionKey) => `${BASE}/race_control?session_key=${encodeURIComponent(sessionKey)}`,
  sessionsUrl: (year) => `${BASE}/sessions?year=${encodeURIComponent(year)}`,
  parse: parseRaceControl
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/openf1.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/feeds/openf1.js test/openf1.test.js
git commit -m "feat: add OpenF1 race control feed for F1 events"
```

---

### Task 6: Game detection and feed registry

**Files:**
- Create: `src/feeds/index.js`
- Test: `test/feed-registry.test.js`

**Interfaces:**
- Consumes: `EspnNflFeed`, `EspnMlbFeed`, `OpenF1Feed`
- Produces:
  - `detectGame(url) -> {sport, eventId, pageId} | null` where `eventId` is what the sport's feed needs (for F1 the OpenF1 session key `'latest'`, not the ESPN race id) and `pageId` is the ESPN id from the URL
  - `feedForSport(sport) -> feed | null`
  - `fetchEvents(feed, eventId, fetchImpl) -> Promise<{ok, events, reason}>`

- [ ] **Step 1: Write the failing test**

```js
// test/feed-registry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectGame, feedForSport, fetchEvents } from '../src/feeds/index.js';
import { EspnNflFeed } from '../src/feeds/espn-nfl.js';

test('detects nfl game pages in path form, with and without a slug', () => {
  for (const url of [
    'https://www.espn.com/nfl/game/_/gameId/401873298',
    'https://www.espn.com/nfl/game/_/gameId/401873298/pit-buf'
  ]) {
    const got = detectGame(url);
    assert.equal(got.sport, 'nfl', url);
    assert.equal(got.eventId, '401873298', url);
  }
});

test('detects the nfl live link, which puts gameId in the query string', () => {
  // ESPN's own scoreboard "live" link is /nfl/game?gameId=N, not a path.
  const got = detectGame('https://www.espn.com/nfl/game?gameId=401873299');
  assert.equal(got.sport, 'nfl');
  assert.equal(got.eventId, '401873299');
});

test('detects playbyplay and boxscore pages', () => {
  for (const [url, sport] of [
    ['https://www.espn.com/nfl/playbyplay/_/gameId/401873298', 'nfl'],
    ['https://www.espn.com/nfl/boxscore/_/gameId/401873298', 'nfl'],
    ['https://www.espn.com/mlb/playbyplay/_/gameId/401816696', 'mlb']
  ]) {
    const got = detectGame(url);
    assert.ok(got, url);
    assert.equal(got.sport, sport, url);
  }
});

test('detects mlb game pages', () => {
  const got = detectGame('https://www.espn.com/mlb/game/_/gameId/401816696/rockies-nationals');
  assert.equal(got.sport, 'mlb');
  assert.equal(got.eventId, '401816696');
});

test('detects f1 race pages using ESPNs real /_/id/ shape', () => {
  const got = detectGame('https://www.espn.com/f1/race/_/id/600057442');
  assert.equal(got.sport, 'f1');
  assert.equal(got.pageId, '600057442');
});

test('f1 eventId is the OpenF1 session key, not the ESPN race id', () => {
  // ESPN race ids and OpenF1 session keys are different id spaces: passing
  // ESPN's 600057442 to OpenF1 returns 404 "No results found". The ESPN id
  // only tells us the user is on an F1 page; the data comes from OpenF1's
  // current session.
  const got = detectGame('https://www.espn.com/f1/race/_/id/600057442');
  assert.equal(got.eventId, 'latest');
  assert.notEqual(got.eventId, got.pageId);
});

test('nfl and mlb eventId and pageId are the same ESPN id', () => {
  const got = detectGame('https://www.espn.com/nfl/game/_/gameId/401873298');
  assert.equal(got.eventId, got.pageId);
});

test('returns null for non-game pages', () => {
  assert.equal(detectGame('https://www.espn.com/'), null);
  assert.equal(detectGame('https://www.espn.com/nfl/scoreboard'), null);
  assert.equal(detectGame('https://example.com/nfl/game/_/gameId/1'), null);
  assert.equal(detectGame(''), null);
  assert.equal(detectGame(null), null);
});

test('feedForSport maps sports to feeds', () => {
  assert.equal(feedForSport('nfl').sport, 'nfl');
  assert.equal(feedForSport('mlb').sport, 'mlb');
  assert.equal(feedForSport('f1').sport, 'f1');
  assert.equal(feedForSport('nhl'), null);
});

test('fetchEvents returns parsed events on success', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ drives: { previous: [{ plays: [{ id: '1', text: 'x', type: { text: 'Rush' } }] }] } })
  });
  const res = await fetchEvents(EspnNflFeed, '123', fakeFetch);
  assert.equal(res.ok, true);
  assert.equal(res.events.length, 1);
});

test('fetchEvents reports failure on non-200 rather than throwing', async () => {
  const fakeFetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const res = await fetchEvents(EspnNflFeed, '123', fakeFetch);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'http-404');
});

test('fetchEvents reports failure on malformed json rather than throwing', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => { throw new Error('bad json'); } });
  const res = await fetchEvents(EspnNflFeed, '123', fakeFetch);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'parse-error');
});

test('fetchEvents reports failure on network error rather than throwing', async () => {
  const fakeFetch = async () => { throw new Error('offline'); };
  const res = await fetchEvents(EspnNflFeed, '123', fakeFetch);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'network-error');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/feed-registry.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// src/feeds/index.js
import { EspnNflFeed } from './espn-nfl.js';
import { EspnMlbFeed } from './espn-mlb.js';
import { OpenF1Feed } from './openf1.js';

const FEEDS = {
  nfl: EspnNflFeed,
  mlb: EspnMlbFeed,
  f1: OpenF1Feed
};

// Verified against ESPN's own scoreboard event links. Three shapes exist and
// all three are pages a viewer actually lands on:
//   /nfl/game/_/gameId/401873298[/pit-buf]   summary (path form)
//   /nfl/game?gameId=401873299               the scoreboard's "live" link
//   /nfl/playbyplay/_/gameId/401873298       play-by-play, and /boxscore/ too
// F1 uses /_/id/, NOT /_/raceId/.
const BALL_PATH = /^\/(nfl|mlb)\/(?:game|playbyplay|boxscore)\/_\/gameId\/(\d+)/i;
const BALL_QUERY = /^\/(nfl|mlb)\/(?:game|playbyplay|boxscore)\/?$/i;
const F1_PATH = /^\/f1\/(?:race|results)\/_\/id\/(\d+)/i;

// OpenF1 keys on its own session_key, a different id space from ESPN's race
// id (ESPN's 600057442 returns 404 from OpenF1). The ESPN id only tells us the
// viewer is on an F1 page; "latest" resolves to OpenF1's current session, which
// is the running one during a live race — exactly what this extension explains.
const F1_SESSION_KEY = 'latest';

export function detectGame(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!/(^|\.)espn\.com$/i.test(parsed.hostname)) return null;

  const f1 = parsed.pathname.match(F1_PATH);
  if (f1) {
    return { sport: 'f1', eventId: F1_SESSION_KEY, pageId: f1[1] };
  }

  const path = parsed.pathname.match(BALL_PATH);
  if (path) {
    const sport = path[1].toLowerCase();
    return { sport, eventId: path[2], pageId: path[2] };
  }

  const query = parsed.pathname.match(BALL_QUERY);
  if (query) {
    const gameId = parsed.searchParams.get('gameId');
    if (gameId && /^\d+$/.test(gameId)) {
      const sport = query[1].toLowerCase();
      return { sport, eventId: gameId, pageId: gameId };
    }
  }

  return null;
}

export function feedForSport(sport) {
  return FEEDS[sport] || null;
}

// Never throws. Callers branch on `ok` and fall back to the DOM scraper.
export async function fetchEvents(feed, eventId, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(feed.url(eventId));
  } catch {
    return { ok: false, events: [], reason: 'network-error' };
  }

  if (!response.ok) {
    return { ok: false, events: [], reason: `http-${response.status}` };
  }

  let json;
  try {
    json = await response.json();
  } catch {
    return { ok: false, events: [], reason: 'parse-error' };
  }

  return { ok: true, events: feed.parse(json), reason: null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/feed-registry.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, all tests across five files.

- [ ] **Step 6: Commit**

```bash
git add src/feeds/index.js test/feed-registry.test.js
git commit -m "feat: add game detection and feed registry with safe fetch"
```

---

### Task 7: Poller with id-based deduplication

**Files:**
- Create: `src/poller.js`
- Test: `test/poller.test.js`

**Interfaces:**
- Consumes: `fetchEvents` from `src/feeds/index.js`
- Produces:
  - `createPoller({feed, eventId, onEvents, fetchImpl, intervalMs}) -> {start(), stop(), tick(), seenCount()}`

**Why this replaces `isDuplicateEvent`:** `content.js:2003` compares description strings inside a 5-second window, so a legitimately repeated play is dropped and a slow one double-fires. Feed ids make dedup exact.

- [ ] **Step 1: Write the failing test**

```js
// test/poller.test.js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/poller.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// src/poller.js
import { fetchEvents } from './feeds/index.js';

export const DEFAULT_INTERVAL_MS = 10000;

export function createPoller({
  feed,
  eventId,
  onEvents,
  onFailure = () => {},
  fetchImpl = fetch,
  intervalMs = DEFAULT_INTERVAL_MS
}) {
  const seen = new Set();
  let timer = null;
  let stopped = false;

  async function tick() {
    if (stopped) return;

    const result = await fetchEvents(feed, eventId, fetchImpl);
    if (!result.ok) {
      onFailure(result.reason);
      return;
    }

    // Filter and mark in one pass. Computing `fresh` before marking would let
    // two copies of one id inside a single batch both survive the filter.
    const fresh = [];
    for (const e of result.events) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      fresh.push(e);
    }
    // Awaited: Task 15 makes the session's emit() async (it awaits the
    // explainer per event). A bare call would make emission fire-and-forget
    // and let two overlapping ticks deliver events out of order.
    if (fresh.length > 0) await onEvents(fresh);
  }

  return {
    tick,
    seenCount: () => seen.size,
    start() {
      stopped = false;
      tick();
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/poller.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/poller.js test/poller.test.js
git commit -m "feat: add poller with id-based dedup replacing text heuristic"
```

---

### Task 8: DOM scrape fallback feed

**Files:**
- Create: `src/feeds/dom-scrape.js`
- Test: `test/dom-scrape.test.js`

**Interfaces:**
- Consumes: `makeEvent` from `src/events.js`
- Produces:
  - `createDomScrapeFeed(sport) -> feed` with `{sport, url(), parse(rawArray)}`
  - `createTabScrapeFetch(tabId, sendMessageImpl) -> fetchImpl`

**Design note:** the service worker has no DOM, so this feed cannot scrape directly. It satisfies the same `{url, parse}` contract used by `fetchEvents` by supplying a custom `fetchImpl` that messages the content script and wraps the reply in a fetch-shaped object. That keeps a single code path in the poller — no branching on feed kind.

- [ ] **Step 1: Write the failing test**

```js
// test/dom-scrape.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDomScrapeFeed, createTabScrapeFetch } from '../src/feeds/dom-scrape.js';
import { fetchEvents } from '../src/feeds/index.js';

test('normalizes raw scraped rows into GameEvents', () => {
  const feed = createDomScrapeFeed('nfl');
  const events = feed.parse([
    { text: 'Touchdown Bills', type: 'NFL Play' },
    { text: 'Score: 21 - 17', type: 'Score Update' }
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0].sport, 'nfl');
  assert.equal(events[0].text, 'Touchdown Bills');
  assert.ok(events.every(e => typeof e.id === 'string' && e.id.length > 0));
});

test('scraped events are marked as degraded provenance', () => {
  const feed = createDomScrapeFeed('nfl');
  const events = feed.parse([{ text: 'Touchdown Bills' }]);
  assert.equal(events[0].degraded, true);
});

test('ids are stable across repeated identical scrapes', () => {
  const feed = createDomScrapeFeed('nfl');
  const a = feed.parse([{ text: 'Touchdown Bills' }]);
  const b = feed.parse([{ text: 'Touchdown Bills' }]);
  assert.equal(a[0].id, b[0].id, 'same text must yield same id so dedup suppresses it');
});

test('malformed scrape payloads return empty array', () => {
  const feed = createDomScrapeFeed('nfl');
  assert.deepEqual(feed.parse(null), []);
  assert.deepEqual(feed.parse('nope'), []);
});

test('tab scrape fetch wraps a content script reply in a fetch-shaped object', async () => {
  const sendMessage = async () => ({ rows: [{ text: 'Sack' }] });
  const fetchImpl = createTabScrapeFetch(7, sendMessage);
  const res = await fetchImpl('dom://scrape');
  assert.equal(res.ok, true);
  assert.deepEqual(await res.json(), [{ text: 'Sack' }]);
});

test('tab scrape fetch reports not-ok when the content script does not answer', async () => {
  const fetchImpl = createTabScrapeFetch(7, async () => undefined);
  const res = await fetchImpl('dom://scrape');
  assert.equal(res.ok, false);
});

test('dom scrape feed works end to end through fetchEvents', async () => {
  const feed = createDomScrapeFeed('nfl');
  const fetchImpl = createTabScrapeFetch(7, async () => ({ rows: [{ text: 'Interception' }] }));
  const result = await fetchEvents(feed, 'ignored', fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(result.events[0].text, 'Interception');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/dom-scrape.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// src/feeds/dom-scrape.js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/dom-scrape.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/feeds/dom-scrape.js test/dom-scrape.test.js
git commit -m "feat: add DOM scrape fallback feed behind the GameFeed contract"
```

---

### Task 9: Background service worker orchestrator

**Files:**
- Modify: `background.js` (replace entirely — currently a 12-line stub)
- Create: `src/session.js`
- Test: `test/session.test.js`

**Interfaces:**
- Consumes: `detectGame`, `feedForSport` from `src/feeds/index.js`; `createPoller` from `src/poller.js`; `createDomScrapeFeed`, `createTabScrapeFetch` from `src/feeds/dom-scrape.js`
- Produces:
  - `createSession({tabId, url, deps}) -> {start(), stop(), state()}`
  - Message protocol, fixed here and depended on by Task 10:
    - content to background: `{action:'start', url}` / `{action:'stop'}` / `{action:'getStatus'}`
    - background to content: `{action:'events', events:[GameEvent]}` / `{action:'degraded', reason}` / `{action:'legacyScrape'}` (reply `{rows:[{text,type}]}`)

- [ ] **Step 1: Write the failing test**

```js
// test/session.test.js
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

test('startPolling schedules repeated polls and stop cancels them', async () => {
  let ticks = 0;
  const d = deps({
    fetchImpl: async () => { ticks++; return { ok: true, json: async () => ({}) }; }
  });
  const session = createSession({
    tabId: 1, url: 'https://www.espn.com/nfl/game/_/gameId/401873298',
    deps: d, intervalMs: 10
  });
  await session.start();
  session.startPolling();
  await new Promise(r => setTimeout(r, 55));
  session.stop();
  const afterStop = ticks;
  assert.ok(ticks >= 2, `expected repeated polls, got ${ticks}`);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(ticks, afterStop, 'stop must cancel the interval');
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/session.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/session.js`**

```js
// src/session.js
import { detectGame, feedForSport } from './feeds/index.js';
import { createPoller, DEFAULT_INTERVAL_MS } from './poller.js';
import { createDomScrapeFeed, createTabScrapeFetch } from './feeds/dom-scrape.js';
import { IMPORTANCE } from './events.js';

export function createSession({ tabId, url, deps, intervalMs = DEFAULT_INTERVAL_MS }) {
  const detected = detectGame(url);
  let poller = null;
  let degraded = false;
  let timer = null;

  const state = () => ({
    sport: detected ? detected.sport : null,
    eventId: detected ? detected.eventId : null,
    degraded,
    active: poller !== null
  });

  // Low importance is suppressed entirely; it never reaches the overlay.
  function emit(events) {
    const shown = events.filter(e => e.importance !== IMPORTANCE.LOW);
    if (shown.length > 0) {
      deps.sendToTab(tabId, { action: 'events', events: shown });
    }
  }

  async function switchToDegraded(reason) {
    if (degraded) return;
    degraded = true;
    if (poller) poller.stop();
    deps.sendToTab(tabId, { action: 'degraded', reason });
    poller = createPoller({
      feed: createDomScrapeFeed(detected.sport),
      eventId: detected.eventId,
      fetchImpl: createTabScrapeFetch(tabId, deps.sendToTab),
      onEvents: emit,
      intervalMs
    });
  }

  return {
    state,
    async start() {
      if (!detected) return false;
      poller = createPoller({
        feed: feedForSport(detected.sport),
        eventId: detected.eventId,
        fetchImpl: deps.fetchImpl,
        onEvents: emit,
        onFailure: (reason) => switchToDegraded(reason),
        intervalMs
      });
      return true;
    },
    // One poll cycle. When the first tick trips the fallback, the second
    // drives the freshly-created degraded poller so no cycle is lost.
    async pump() {
      if (!poller) return;
      await poller.tick();
      if (degraded && poller) await poller.tick();
    },
    // Scheduling is separate from start() so tests can drive pump() by hand
    // without a live interval. background.js calls both.
    startPolling() {
      if (timer) clearInterval(timer);
      timer = setInterval(() => { this.pump(); }, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (poller) poller.stop();
      poller = null;
    }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/session.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Replace `background.js`**

```js
// background.js — service worker (ES module; manifest sets "type": "module")
import { createSession } from './src/session.js';

const sessions = new Map(); // tabId -> session

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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : request.tabId;
  if (typeof tabId !== 'number') {
    sendResponse({ ok: false, reason: 'no-tab' });
    return false;
  }

  if (request.action === 'start') {
    stopSession(tabId);
    const session = createSession({
      tabId,
      url: request.url,
      deps: { fetchImpl: (u) => fetch(u), sendToTab }
    });
    session.start().then((started) => {
      if (started) {
        sessions.set(tabId, session);
        session.pump();
        session.startPolling();
      }
      sendResponse({ ok: started, state: session.state() });
    });
    return true;
  }

  if (request.action === 'stop') {
    stopSession(tabId);
    sendResponse({ ok: true });
    return false;
  }

  if (request.action === 'getStatus') {
    const session = sessions.get(tabId);
    sendResponse({ ok: true, state: session ? session.state() : null });
    return false;
  }

  return false;
});

chrome.tabs.onRemoved.addListener(stopSession);
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS across all files.

- [ ] **Step 7: Commit**

```bash
git add src/session.js background.js test/session.test.js
git commit -m "feat: move polling and feed orchestration into the service worker"
```

---

### Task 10: Reduce content.js to UI only

**Files:**
- Modify: `content.js`

**Interfaces:**
- Consumes: background messages `{action:'events'|'degraded'|'legacyScrape'}` from Task 9
- Produces: `{action:'start'|'stop'|'getStatus'}` messages; `{rows:[{text,type}]}` reply to `legacyScrape`

- [ ] **Step 1: Delete the explanation methods**

Remove from `content.js`: `explainNFLPlay` (line ~1867), `explainMLBPlay` (~1480), `explainF1Event` (~1796), `explainMLBInning` (~1912), `detectF1PositionChanges` (~1926).

Task 13 inlines the ported bodies of these functions in full, so nothing is
lost by deleting them here. If a Task 13 test fails, diff against the
pre-refactor file rather than rewriting the branch from memory:

```bash
git show HEAD:content.js | sed -n '1480,1520p;1796,1832p;1867,1913p'
```

- [ ] **Step 2: Delete the detection and polling machinery**

Remove `detectGameType`, `calculateDynamicThreshold`, `validateGameType`, the NFL/MLB/F1 `detect*` helpers, `startMonitoring`/`stopMonitoring` interval logic, and `isDuplicateEvent` (superseded by id dedup in `src/poller.js`).

Keep: `createOverlay`, drag handling, onboarding, `updateOverlay`, `updateLog`, `toggleLog`, `sanitizeString`, `handleError`.

- [ ] **Step 3: Extend the EXISTING `handleMessage` switch — do not add a parallel handler**

`content.js` already has one `handleMessage(request, sender, sendResponse)` with a
`switch (request.action)` serving the popup (`toggle`, `getStatus`, `showOverlay`,
`hideOverlay`, `reset`). Its `default:` branch **throws**, and the listener that
wraps it routes the throw into `handleError`, which logs a visible "Error"
entry to the user's overlay, increments `errorCount`, and calls `reset()` once
`errorCount` reaches `maxErrors` (10) — wiping the event log and tearing the
extension down.

So the three new background actions MUST be cases in that same switch. Adding a
separate `handleBackgroundMessage` method would leave `default:` throwing on
every `events` message, and at a 10-second poll the extension would destroy
itself roughly every 100 seconds, permanently.

Add these cases alongside the existing ones, and make `default` benign:

```js
      case 'events':
        this.rememberSport(request.events);
        request.events.forEach((event) => {
          const description = event.explanation || event.text;
          this.addEvent(this.labelFor(event), description);
        });
        sendResponse({ ok: true });
        break;
      case 'degraded':
        this.addEvent('System', 'Live data feed unavailable. Falling back to page reading.');
        sendResponse({ ok: true });
        break;
      case 'legacyScrape':
        sendResponse({ rows: this.legacyScrape() });
        break;
      default:
        // Never throw here. A throw reaches handleError, which logs a visible
        // error and resets the extension after maxErrors.
        sendResponse({ ok: false, reason: `unknown action: ${request.action}` });
        break;
```

and add the label helper:

```js
  labelFor(event) {
    const sport = (event.sport || '').toUpperCase();
    return event.type ? `${sport} ${event.type}` : sport || 'Event';
  }
```

Keep the existing `toggle`, `showOverlay`, `hideOverlay` and `reset` cases exactly
as they are — `popup.js` sends all four.

- [ ] **Step 4: Collapse the retained scraping into `legacyScrape`**

Wrap the existing DOM-reading helpers so they return rows instead of calling `addEvent` directly:

```js
  legacyScrape() {
    const rows = [];
    try {
      const elements = document.querySelectorAll('[class*="play"], [class*="Play"]');
      elements.forEach((el) => {
        const text = (el.textContent || '').trim();
        if (text.length > 20 && text.length < 300) {
          rows.push({ text, type: 'Play' });
        }
      });
    } catch (error) {
      this.handleError('LegacyScrape', error);
    }
    return rows.slice(0, 20);
  }
```

- [ ] **Step 5: Replace the toggle path to talk to the background**

```js
  toggle() {
    this.isActive = !this.isActive;
    const action = this.isActive ? 'start' : 'stop';
    chrome.runtime.sendMessage({ action, url: window.location.href }, (reply) => {
      void chrome.runtime.lastError;
      if (this.isActive && (!reply || !reply.ok)) {
        this.isActive = false;
        this.addEvent('System', 'This page is not a supported live game.');
      }
    });
  }
```

- [ ] **Step 6: Preserve the popup status contract**

`popup.js:75` sends `{action:'getStatus'}` to this content script and
`popup.js:105-113` render `gameType` and `eventCount` from the reply. Step 2
deletes `detectGameType`, which is what sets `this.gameType` today. Keep the
handler answering the same shape, sourcing the sport from the events the
background sends:

```js
  // Sport is no longer detected here; it arrives with the events.
  rememberSport(events) {
    const withSport = events.find(e => e.sport);
    if (withSport) this.gameType = withSport.sport;
  }

  handleStatusRequest(sendResponse) {
    sendResponse({
      isActive: this.isActive,
      gameType: this.gameType || null,
      eventCount: this.eventLog.length
    });
  }
```

Call `this.rememberSport(request.events)` at the top of the `events` branch in
`handleBackgroundMessage`, and route `getStatus` to `handleStatusRequest`.

- [ ] **Step 7: Verify the message switch cannot throw on a background action**

```bash
grep -n "Unknown action" content.js
```

Expected: no output. If the throwing `default:` survives, the extension will
reset itself in a loop once the background starts polling.

- [ ] **Step 8: Verify no network calls remain in content.js**

```bash
grep -n "fetch(\|XMLHttpRequest\|site.api.espn\|openf1\|anthropic" content.js
```

Expected: no output. If anything matches, move it to the service worker.

- [ ] **Step 9: Load the extension and verify manually**

Load unpacked in Chrome, open an ESPN NFL game page from `site.api.espn.com/.../nfl/scoreboard` with `state: "in"`, click the extension icon, start monitoring. Confirm the overlay populates with real plays, that the popup still shows the
correct sport and a rising event count, and that the service worker console
shows no errors.

- [ ] **Step 10: Commit**

```bash
git add content.js
git commit -m "refactor: reduce content.js to UI, moving data and explanation to the worker"
```

---

### Task 11: Manifest permissions and truthful privacy policy

**Files:**
- Modify: `manifest.json`
- Rewrite: `privacy.html`

- [ ] **Step 1: Update `manifest.json`**

Set `background` to a module and add the two Sprint 1 hosts. `api.anthropic.com` is added in Task 15, not here — do not add it before the explainer exists.

```json
  "host_permissions": [
    "https://www.espn.com/*",
    "https://espn.com/*",
    "https://site.api.espn.com/*",
    "https://api.openf1.org/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  }
```

- [ ] **Step 2: Rewrite the body of `privacy.html`**

The current page states PlaySense "sends no data to external servers." That is false as of this task. Replace the disclosure section with:

```html
<h2>What PlaySense sends, and where</h2>
<p>
  To describe a live game, PlaySense requests public game data from two
  third-party services:
</p>
<ul>
  <li>
    <strong>ESPN</strong> (<code>site.api.espn.com</code>) — public scores and
    play-by-play for the game page you are viewing. PlaySense sends only the
    public game identifier from the page URL.
  </li>
  <li>
    <strong>OpenF1</strong> (<code>api.openf1.org</code>) — public Formula 1
    race-control messages. PlaySense sends only the public session identifier.
  </li>
</ul>
<p>
  These requests contain no personal information, no account identifiers, and
  no browsing history. PlaySense sends nothing about any page other than the
  live game you are actively monitoring.
</p>
<h2>What PlaySense stores</h2>
<p>
  A single flag recording whether you have seen the welcome message, kept in
  your browser via <code>chrome.storage.local</code>. Game events are held in
  memory for the current session and are discarded when the tab closes.
</p>
<h2>What PlaySense does not do</h2>
<p>
  No analytics, no tracking, no advertising, no accounts, and no transmission
  of data to the extension author. PlaySense has no server.
</p>
```

- [ ] **Step 3: Verify the false claim is gone**

```bash
grep -in "no data to external\|sends no data\|no external server" privacy.html
```

Expected: no output.

- [ ] **Step 4: Reload the extension and confirm permissions**

Reload unpacked. Chrome should prompt for the two new host permissions. Confirm the overlay still populates on a live game.

- [ ] **Step 5: Commit**

```bash
git add manifest.json privacy.html
git commit -m "feat: add feed host permissions and correct the privacy disclosure"
```

- [ ] **Step 6: Sprint 1 review gate**

Run the full suite and request a code review before starting Sprint 2.

```bash
npm test
```

Expected: all tests pass. Sprint 1 is independently shippable at this point — the extension is materially more reliable with no LLM and no spend.

---

# Sprint 2 — AI Explanations

---

### Task 12: Verify direct browser access to the Anthropic API

**Files:** none (probe only)

**This is a gate.** The spec records that calling `api.anthropic.com` from an extension service worker is unverified. Do not write explainer code until this passes.

- [ ] **Step 1: Add the host permission temporarily**

Add `"https://api.anthropic.com/*"` to `host_permissions` in `manifest.json` and reload the unpacked extension.

- [ ] **Step 2: Run the probe from the service worker console**

Open `chrome://extensions`, click the PlaySense service worker link, and paste — substituting a real key, and never committing it:

```js
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': 'PASTE_KEY_HERE',
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true'
  },
  body: JSON.stringify({
    model: 'claude-haiku-4-5',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }]
  })
});
console.log(res.status, await res.text());
```

- [ ] **Step 3: Record the outcome**

- **200** — direct access works. Note whether it also succeeds with the `anthropic-dangerous-direct-browser-access` header removed, and use the minimal working header set in Task 14.
- **401** — the key is wrong. Fix the key and re-run; this is not a blocker.
- **403 or a CORS error** — direct access is blocked. **Stop. Do not continue to Task 13.** Report to the user that BYOK requires a proxy, which changes Phase 1 from $0 and is a re-scoping decision for them, not an implementation detail to absorb.

- [ ] **Step 4: Revert the manifest change**

Remove the `api.anthropic.com` host permission again; it is added properly in Task 15. Leave the working tree clean.

```bash
git checkout manifest.json
git status --short
```

Expected: no output.

---

### Task 13: Extract the rules explainer

**Files:**
- Create: `src/explainers/rules.js`
- Test: `test/rules-explainer.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `RuleExplainer` — `{name:'rules', async explain(event) -> string|null}`

**Behaviour must not change.** This task is a move, not a rewrite. The full
ported code is given below; do not improve, reorder, or reword the branches.

- [ ] **Step 1: Write the failing test**

```js
// test/rules-explainer.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuleExplainer } from '../src/explainers/rules.js';

test('explains nfl touchdowns', async () => {
  const out = await RuleExplainer.explain({ sport: 'nfl', text: 'K.Johnson runs for a TOUCHDOWN' });
  assert.match(out, /end zone/i);
});

test('explains nfl sacks and interceptions', async () => {
  assert.match(await RuleExplainer.explain({ sport: 'nfl', text: 'J.Allen sacked at BUF 20' }), /quarterback/i);
  assert.match(await RuleExplainer.explain({ sport: 'nfl', text: 'INTERCEPTION by O.Reese' }), /defense/i);
});

test('explains mlb plays', async () => {
  const out = await RuleExplainer.explain({ sport: 'mlb', text: 'Judge hit a home run to left.' });
  assert.ok(typeof out === 'string' && out.length > 0);
});

test('returns null when no rule matches', async () => {
  assert.equal(await RuleExplainer.explain({ sport: 'nfl', text: 'The zamboni is on the field' }), null);
  assert.equal(await RuleExplainer.explain({ sport: 'nfl', text: '' }), null);
  assert.equal(await RuleExplainer.explain({}), null);
});

test('does not throw on malformed events', async () => {
  await RuleExplainer.explain(null);
  await RuleExplainer.explain({ sport: 'nfl' });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/rules-explainer.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/explainers/rules.js`**

Ported verbatim from `content.js`. Behaviour must be byte-identical to the
pre-refactor branches, including the order they are tested in — the order is
load-bearing (`double play` is checked before `double`, `safety car` before
`safety`, `virtual safety car` before `safety car`).

```js
// src/explainers/rules.js
// Ported verbatim from the pre-refactor content.js keyword chains.
// Zero cost, no network. Always available as the fallback tier.

function explainNfl(text) {
  const t = text.toLowerCase();

  if (t.includes('touchdown')) {
    return 'Touchdown! A player reached the end zone and scored 6 points for their team.';
  }
  if (t.includes('two-point conversion') || t.includes('two point conversion')) {
    return 'Two-point conversion attempt! Instead of kicking for 1 extra point, they are trying to run or pass into the end zone for 2 points.';
  }
  if (t.includes('extra point') || /\bpat\b/.test(t)) {
    return 'Extra point! After a touchdown, the kicker attempts a short kick through the goalposts for 1 bonus point.';
  }
  if (t.includes('field goal')) {
    return 'Field goal! The kicker scored 3 points by kicking the ball through the goalposts.';
  }
  if (t.includes('safety') && !t.includes('safety car') && !t.includes('player safety')) {
    return 'Safety! The defense tackled an offensive player in their own end zone — worth 2 points for the defense.';
  }
  if (t.includes('interception')) {
    return 'Interception! The defense caught a pass meant for the offense and took control of the ball.';
  }
  if (t.includes('fumble')) {
    return 'Fumble! A player dropped the ball — whichever team recovers it gets possession.';
  }
  if (t.includes('sack')) {
    return 'Sack! The quarterback was tackled behind the line before he could throw the ball.';
  }
  if (t.includes('punt')) {
    return 'Punt! The offense kicked the ball away on 4th down rather than risk losing possession at this field position.';
  }
  if (t.includes('kickoff return') || t.includes('kick return')) {
    return 'Kickoff return! After a score, the receiving team is running the kicked ball back up the field.';
  }
  if (t.includes('kickoff') || t.includes('kick off')) {
    return 'Kickoff! The ball is kicked to start the drive. If it reaches the end zone, the receiving team may take a touchback and start at their 25-yard line.';
  }
  if (t.includes('fourth down') || t.includes('4th down')) {
    return '4th down! This is the offense\'s last chance to gain the yards needed for a first down before potentially losing the ball.';
  }
  if (t.includes('penalty') || t.includes('flag')) {
    return 'Penalty! A referee spotted a rule violation and is moving the ball to penalize the offending team.';
  }
  return null;
}

function explainMlb(text) {
  const t = text.toLowerCase();

  if (t.includes('home run') || t.includes('homerun')) {
    return 'Home run! The batter hit the ball out of the park — all runners on base score, plus the batter.';
  }
  if (t.includes('strikeout') || t.includes('struck out')) {
    return 'Strikeout! The batter got three strikes and is out. The pitcher wins this matchup.';
  }
  if (/\bwalk(ed|s)?\b/.test(t) || t.includes('base on balls')) {
    return 'Walk! The pitcher threw 4 balls outside the strike zone, so the batter gets a free trip to first base.';
  }
  if (t.includes('stolen base')) {
    return 'Stolen base! A runner sprinted to the next base while the pitcher was winding up.';
  }
  if (t.includes('double play')) {
    return 'Double play! The defense got two outs on a single play — a huge momentum swing.';
  }
  if (t.includes('error')) {
    return 'Error! A fielder made a mistake (dropped the ball or threw it badly), giving the offense extra bases they did not earn.';
  }
  if (t.includes('single')) {
    return 'Single! The batter hit the ball and safely reached first base.';
  }
  if (t.includes('double') && !t.includes('double play')) {
    return 'Double! The batter hit the ball far enough to reach second base safely.';
  }
  if (t.includes('triple')) {
    return 'Triple! The batter hit the ball and made it all the way to third base — a rare and exciting hit.';
  }
  return null;
}

function explainF1(text) {
  const t = text.toLowerCase();

  if (t.includes('overtake') || t.includes('passed') || t.includes('position change')) {
    return 'Position change! A driver has passed another, moving up in the race standings.';
  }
  if (t.includes('pit stop') || t.includes('pitting')) {
    const compound = t.includes('soft') ? ' (soft tyres — fast but wear quickly)' :
                     t.includes('medium') ? ' (medium tyres — balanced choice)' :
                     t.includes('hard') ? ' (hard tyres — slow but last longer)' : '';
    return `Pit stop! A car pulled into the garage to change tyres${compound}. This costs about 2–3 seconds.`;
  }
  if (t.includes('virtual safety car') || t.includes('vsc')) {
    return 'Virtual safety car! Drivers must slow to a set speed limit without a physical safety car. Used for minor incidents.';
  }
  if (t.includes('safety car')) {
    return 'Safety car deployed! All cars must slow down and follow the safety car while an incident on track is cleared.';
  }
  if (t.includes('fastest lap')) {
    return 'Fastest lap! A driver just set the quickest single lap of the race — worth 1 bonus championship point if they finish in the top 10.';
  }
  if (t.includes('drs')) {
    return 'DRS activated! A car opened a flap on its rear wing to reduce drag and gain speed — used to help overtaking.';
  }
  if (t.includes('retire') || t.includes('dnf') || t.includes('out of the race')) {
    return 'Retirement (DNF)! A car has dropped out of the race due to a mechanical failure or incident.';
  }
  if (t.includes('crash') || t.includes('accident')) {
    return 'Incident on track! A driver has been in an accident and may be out of the race.';
  }
  if (t.includes('penalty')) {
    return 'Penalty! A driver broke a rule (unsafe driving, track limits, etc.) and will serve a time penalty.';
  }
  return null;
}

export const RuleExplainer = {
  name: 'rules',
  async explain(event) {
    if (!event || typeof event.text !== 'string' || event.text.length === 0) return null;
    if (event.sport === 'nfl') return explainNfl(event.text);
    if (event.sport === 'mlb') return explainMlb(event.text);
    if (event.sport === 'f1') return explainF1(event.text);
    return null;
  }
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/rules-explainer.test.js`
Expected: PASS, 5 tests. If an assertion fails, a branch was mis-ported — diff against `git show HEAD:content.js`.

- [ ] **Step 5: Commit**

```bash
git add src/explainers/rules.js test/rules-explainer.test.js
git commit -m "refactor: extract keyword rules into a standalone explainer"
```

---

### Task 14: Claude explainer with budget guard

**Files:**
- Create: `src/explainers/claude.js`
- Test: `test/claude-explainer.test.js`

**Interfaces:**
- Consumes: `IMPORTANCE` from `src/events.js`
- Produces:
  - `buildPrompt(event) -> {system, user}`
  - `createClaudeExplainer({getKey, getBudget, setBudget, fetchImpl, now}) -> {name:'claude', async explain(event)}`
  - `DAILY_CALL_CAP = 500`

- [ ] **Step 1: Write the failing test**

```js
// test/claude-explainer.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeExplainer, buildPrompt, DAILY_CALL_CAP } from '../src/explainers/claude.js';
import { IMPORTANCE } from '../src/events.js';

function harness(overrides = {}) {
  const calls = [];
  let budget = { day: '2026-08-27', count: 0 };
  return {
    calls,
    explainer: createClaudeExplainer({
      getKey: async () => 'sk-ant-test',
      getBudget: async () => budget,
      setBudget: async (b) => { budget = b; },
      now: () => new Date('2026-08-27T12:00:00Z'),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          json: async () => ({ content: [{ type: 'text', text: 'A touchdown is worth six points.' }] })
        };
      },
      ...overrides
    }),
    budget: () => budget
  };
}

const highEvent = {
  sport: 'nfl', type: 'Rushing Touchdown', text: 'K.Johnson up the middle, TOUCHDOWN.',
  importance: IMPORTANCE.HIGH, period: { display: 'Q3' }, clock: '2:14', score: { home: 21, away: 17 }
};

test('explains a high importance event', async () => {
  const h = harness();
  const out = await h.explainer.explain(highEvent);
  assert.equal(out, 'A touchdown is worth six points.');
  assert.equal(h.calls.length, 1);
});

test('uses the haiku model id exactly', async () => {
  const h = harness();
  await h.explainer.explain(highEvent);
  const body = JSON.parse(h.calls[0].init.body);
  assert.equal(body.model, 'claude-haiku-4-5');
});

test('never sends normal or low importance events', async () => {
  const h = harness();
  assert.equal(await h.explainer.explain({ ...highEvent, importance: IMPORTANCE.NORMAL }), null);
  assert.equal(await h.explainer.explain({ ...highEvent, importance: IMPORTANCE.LOW }), null);
  assert.equal(h.calls.length, 0, 'no API call may be made for non-high events');
});

test('never sends scraped events', async () => {
  const h = harness();
  const out = await h.explainer.explain({ ...highEvent, degraded: true });
  assert.equal(out, null);
  assert.equal(h.calls.length, 0, 'scraped text must never reach the model');
});

test('returns null with no key configured and makes no call', async () => {
  const h = harness({ getKey: async () => null });
  assert.equal(await h.explainer.explain(highEvent), null);
  assert.equal(h.calls.length, 0);
});

test('returns null on api error rather than throwing', async () => {
  const h = harness({ fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) });
  assert.equal(await h.explainer.explain(highEvent), null);
});

test('returns null on network failure rather than throwing', async () => {
  const h = harness({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(await h.explainer.explain(highEvent), null);
});

test('increments the daily budget on each successful call', async () => {
  const h = harness();
  await h.explainer.explain(highEvent);
  await h.explainer.explain({ ...highEvent, text: 'another' });
  assert.equal(h.budget().count, 2);
});

test('stops calling once the daily cap is reached', async () => {
  let budget = { day: '2026-08-27', count: DAILY_CALL_CAP };
  const h = harness({
    getBudget: async () => budget,
    setBudget: async (b) => { budget = b; }
  });
  assert.equal(await h.explainer.explain(highEvent), null);
  assert.equal(h.calls.length, 0, 'capped explainer must not call the API');
});

test('the budget resets on a new day', async () => {
  let budget = { day: '2026-08-26', count: DAILY_CALL_CAP };
  const h = harness({
    getBudget: async () => budget,
    setBudget: async (b) => { budget = b; }
  });
  const out = await h.explainer.explain(highEvent);
  assert.ok(out, 'a new day must reset the cap');
});

test('the prompt carries structured fields and never raw page text', () => {
  const { system, user } = buildPrompt(highEvent);
  assert.match(system, /one or two short sentences/i);
  assert.match(system, /do not invent/i);
  assert.ok(user.includes('Rushing Touchdown'));
  assert.ok(user.includes('K.Johnson up the middle, TOUCHDOWN.'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/claude-explainer.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/explainers/claude.js`**

Use the minimal working header set recorded in Task 12 Step 3.

```js
// src/explainers/claude.js
import { IMPORTANCE } from '../events.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';
export const DAILY_CALL_CAP = 500;

const SPORT_NAMES = { nfl: 'NFL football', mlb: 'Major League Baseball', f1: 'Formula 1' };

export function buildPrompt(event) {
  const sport = SPORT_NAMES[event.sport] || 'sports';
  const system = [
    `You explain ${sport} to someone who has never watched it before.`,
    'Write one or two short sentences in plain English. No jargon.',
    'Describe only what the play data states. Do not invent details, statistics,',
    'player intent, or consequences that are not present in the input.',
    'Do not speculate about what happens next. Do not use emojis.'
  ].join(' ');

  const lines = [
    `Play type: ${event.type || 'unknown'}`,
    `Description: ${event.text}`
  ];
  if (event.period && event.period.display) lines.push(`Period: ${event.period.display}`);
  if (event.clock) lines.push(`Clock: ${event.clock}`);
  if (event.score) lines.push(`Score: home ${event.score.home}, away ${event.score.away}`);

  return { system, user: lines.join('\n') };
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

export function createClaudeExplainer({
  getKey, getBudget, setBudget, fetchImpl = fetch, now = () => new Date()
}) {
  return {
    name: 'claude',
    async explain(event) {
      if (!event) return null;
      // Only high importance reaches the API. This gate is what holds cost
      // at roughly 2-3 cents per game.
      if (event.importance !== IMPORTANCE.HIGH) return null;
      // Scraped text has no schema and must never be sent to the model.
      if (event.degraded === true) return null;

      const key = await getKey();
      if (!key) return null;

      const today = dayKey(now());
      const budget = (await getBudget()) || { day: today, count: 0 };
      const count = budget.day === today ? budget.count : 0;
      if (count >= DAILY_CALL_CAP) return null;

      const { system, user } = buildPrompt(event);

      let response;
      try {
        response = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 150,
            system,
            messages: [{ role: 'user', content: user }]
          })
        });
      } catch {
        return null;
      }

      if (!response.ok) return null;

      let json;
      try {
        json = await response.json();
      } catch {
        return null;
      }

      const block = Array.isArray(json.content)
        ? json.content.find(b => b.type === 'text')
        : null;
      if (!block || !block.text) return null;

      await setBudget({ day: today, count: count + 1 });
      return block.text.trim();
    }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/claude-explainer.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/explainers/claude.js test/claude-explainer.test.js
git commit -m "feat: add Claude Haiku explainer with importance gate and daily cap"
```

---

### Task 15: Provider chain and background wiring

**Files:**
- Create: `src/explainers/index.js`
- Modify: `src/session.js`
- Modify: `background.js`
- Modify: `manifest.json`
- Test: `test/explainer-chain.test.js`

**Interfaces:**
- Consumes: `RuleExplainer`, `createClaudeExplainer`
- Produces: `createExplainerChain(providers) -> {async explain(event) -> string|null}`

- [ ] **Step 1: Write the failing test**

```js
// test/explainer-chain.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExplainerChain } from '../src/explainers/index.js';

const ok = (text) => ({ name: 'ok', explain: async () => text });
const nothing = { name: 'nothing', explain: async () => null };
const boom = { name: 'boom', explain: async () => { throw new Error('kaboom'); } };

test('returns the first non-null explanation', async () => {
  const chain = createExplainerChain([ok('claude says'), ok('rules say')]);
  assert.equal(await chain.explain({ text: 'x' }), 'claude says');
});

test('falls through to the next provider on null', async () => {
  const chain = createExplainerChain([nothing, ok('rules say')]);
  assert.equal(await chain.explain({ text: 'x' }), 'rules say');
});

test('a throwing provider does not break the chain', async () => {
  const chain = createExplainerChain([boom, ok('rules say')]);
  assert.equal(await chain.explain({ text: 'x' }), 'rules say');
});

test('returns null when no provider answers', async () => {
  const chain = createExplainerChain([nothing, nothing]);
  assert.equal(await chain.explain({ text: 'x' }), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/explainer-chain.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/explainers/index.js`**

```js
// src/explainers/index.js
export { RuleExplainer } from './rules.js';
export { createClaudeExplainer, DAILY_CALL_CAP } from './claude.js';

// Tries each provider in order; the first non-null answer wins. A provider
// that throws is skipped, so the AI tier can never make the extension worse
// than the rules tier alone.
export function createExplainerChain(providers) {
  return {
    async explain(event) {
      for (const provider of providers) {
        try {
          const result = await provider.explain(event);
          if (result) return result;
        } catch {
          // fall through to the next provider
        }
      }
      return null;
    }
  };
}
```

- [ ] **Step 4: Attach explanations in `src/session.js`**

Change `emit` to await explanations before sending, and accept the chain via `deps`:

```js
  async function emit(events) {
    const shown = events.filter(e => e.importance !== IMPORTANCE.LOW);
    if (shown.length === 0) return;

    const explained = [];
    for (const event of shown) {
      const explanation = deps.explainer ? await deps.explainer.explain(event) : null;
      explained.push({ ...event, explanation });
    }
    deps.sendToTab(tabId, { action: 'events', events: explained });
  }
```

Update the two `createPoller` calls to pass `onEvents: (evts) => { emit(evts); }`.

- [ ] **Step 5: Build the chain in `background.js`**

```js
import { createSession } from './src/session.js';
import { RuleExplainer, createClaudeExplainer, createExplainerChain } from './src/explainers/index.js';

const storageGet = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve));
const storageSet = (items) => new Promise((resolve) => chrome.storage.local.set(items, resolve));

const claude = createClaudeExplainer({
  getKey: async () => (await storageGet(['anthropicApiKey'])).anthropicApiKey || null,
  getBudget: async () => (await storageGet(['claudeBudget'])).claudeBudget || null,
  setBudget: async (budget) => storageSet({ claudeBudget: budget })
});

const explainer = createExplainerChain([claude, RuleExplainer]);
```

Pass `explainer` in the `deps` object given to `createSession`.

- [ ] **Step 6: Add the Anthropic host permission**

```json
  "host_permissions": [
    "https://www.espn.com/*",
    "https://espn.com/*",
    "https://site.api.espn.com/*",
    "https://api.openf1.org/*",
    "https://api.anthropic.com/*"
  ]
```

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS across all files.

- [ ] **Step 8: Commit**

```bash
git add src/explainers/index.js src/session.js background.js manifest.json test/explainer-chain.test.js
git commit -m "feat: wire the Claude to rules explainer chain into the session"
```

---

### Task 16: Popup key entry and final privacy disclosure

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`
- Modify: `privacy.html`

- [ ] **Step 1: Add the key controls to `popup.html`**

Insert before the footer:

```html
<div class="section">
  <label for="apiKey">Anthropic API key (optional)</label>
  <input type="password" id="apiKey" placeholder="sk-ant-..." autocomplete="off">
  <div class="row">
    <button class="btn" id="saveKeyBtn">Save key</button>
    <button class="btn" id="clearKeyBtn">Clear</button>
  </div>
  <p class="hint" id="keyStatus">No key saved. Using built-in explanations.</p>
  <p class="hint">
    With a key, PlaySense sends the play type and description of major plays to
    Anthropic to write a plain-English explanation. Your key is stored only in
    this browser. Without a key, PlaySense uses its built-in explanations and
    sends nothing to Anthropic.
  </p>
</div>
```

- [ ] **Step 2: Wire the controls in `popup.js`**

```js
  const apiKeyInput = document.getElementById('apiKey');
  const saveKeyBtn = document.getElementById('saveKeyBtn');
  const clearKeyBtn = document.getElementById('clearKeyBtn');
  const keyStatus = document.getElementById('keyStatus');

  function renderKeyStatus(hasKey) {
    keyStatus.textContent = hasKey
      ? 'Key saved. AI explanations enabled for major plays.'
      : 'No key saved. Using built-in explanations.';
  }

  chrome.storage.local.get(['anthropicApiKey'], (result) => {
    renderKeyStatus(Boolean(result.anthropicApiKey));
  });

  saveKeyBtn.addEventListener('click', () => {
    const value = apiKeyInput.value.trim();
    if (!value) return;
    chrome.storage.local.set({ anthropicApiKey: value }, () => {
      apiKeyInput.value = '';
      renderKeyStatus(true);
    });
  });

  clearKeyBtn.addEventListener('click', () => {
    chrome.storage.local.remove(['anthropicApiKey'], () => {
      apiKeyInput.value = '';
      renderKeyStatus(false);
    });
  });
```

- [ ] **Step 3: Confirm the key is never logged**

```bash
grep -rn "anthropicApiKey" popup.js background.js src/ | grep -i "console\."
```

Expected: no output.

- [ ] **Step 4: Add the Anthropic section to `privacy.html`**

```html
<h2>Optional AI explanations</h2>
<p>
  If you choose to save an Anthropic API key, PlaySense sends the play type and
  the public play description of major plays to Anthropic
  (<code>api.anthropic.com</code>) to generate a plain-English explanation. No
  personal information, browsing history, or page content beyond the play
  description is sent.
</p>
<p>
  Your API key is stored only in this browser via
  <code>chrome.storage.local</code>. It is never sent anywhere except Anthropic,
  and the extension author never receives it. Clearing the key in the popup
  disables this feature immediately; PlaySense then uses only its built-in
  explanations and contacts Anthropic not at all.
</p>
<p>
  PlaySense limits itself to 500 explanation requests per day to protect you
  from unexpected usage on your key.
</p>
```

- [ ] **Step 5: Manual end-to-end verification**

Load unpacked, save a real key, open a live NFL game, start monitoring. Confirm:
- major plays show AI-written explanations
- routine plays show either a built-in explanation or nothing, and never trigger a request (check the Network tab of the service worker: at most a handful of `api.anthropic.com` calls, not one per play)
- clearing the key returns the overlay to built-in explanations with no Anthropic requests

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add popup.html popup.js privacy.html
git commit -m "feat: add API key management to popup and disclose AI usage"
```

- [ ] **Step 8: Sprint 2 review gate**

Request a code review before opening a PR to `production-ready`.

---

## Verification Checklist

- [ ] `npm test` passes with zero failures
- [ ] `grep -n "fetch(" content.js` returns nothing
- [ ] `grep -rn "document\.\|window\." src/` returns nothing
- [ ] `grep -rn "claude-haiku-4-5" src/` shows the model id with no date suffix
- [ ] `privacy.html` contains no claim that data stays local
- [ ] A live game populates the overlay with real plays
- [ ] Clearing the API key stops all `api.anthropic.com` traffic
