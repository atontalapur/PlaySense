# PlaySense — Reliable Feeds + AI Explanations Design Spec

**Date:** 2026-08-27
**Branch target:** feature branch off `production-ready`
**Scope:** Replace DOM scraping with structured sport feeds (Sprint 1), then add LLM-generated explanations behind a provider interface (Sprint 2)
**Supersedes:** the "AI-generated explanations — out of scope" line in `2026-04-20-production-ready-design.md`

---

## 1. Why

PlaySense today scrapes ESPN's rendered DOM with broad selectors (`document.querySelectorAll('*')`), infers the sport from keyword counts, then maps play text to canned strings via `String.includes` chains in `explainNFLPlay` (`content.js:1867`), `explainMLBPlay` (`content.js:1480`), and `explainF1Event` (`content.js:1796`).

Three consequences:

1. **Coverage is a hand-written list.** NFL has 13 branches. Anything else returns `null` and the user sees nothing.
2. **Input is unreliable.** Scraped text has no schema, no provenance, and breaks whenever ESPN ships a layout change.
3. **F1 barely works.** `detectF1PositionChanges` (`content.js:1926`) returns one generic string for any position change.

Adding an LLM on top of (2) would produce fluent, authoritative-sounding wrong answers — strictly worse than a canned string. **Reliable structured input is a precondition for the AI layer, not a follow-up to it.** Hence Sprint 1 before Sprint 2.

---

## 2. Spike findings (verified 2026-08-27 against live games)

### 2.1 ESPN JSON endpoints

Undocumented but public: no auth, no key, `access-control-allow-origin: *`, `cache-control: max-age=3`.

| Sport | Endpoint | Result |
|---|---|---|
| NFL | `site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={id}` | 129 typed plays |
| MLB | `site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event={id}` | 388 typed plays |
| F1 | `site.api.espn.com/apis/site/v2/sports/racing/f1/summary?event={id}` | **Returns `{code, message}` — no play-by-play** |

Scoreboard endpoints (`.../{sport}/scoreboard`) list live events with `id`, `shortName`, and `status.type.state` (`pre` / `in` / `post`).

**NFL play shape** — `drives.current.plays[]` and `drives.previous[].plays[]`:
`text`, `type.text`, `clock.displayValue`, `period.number`, `awayScore`, `homeScore`, `scoringPlay`, `start.downDistanceText`. Top-level `scoringPlays[]` also present.

Observed `type.text` taxonomy (one live game, 129 plays): `Rush`, `Pass Reception`, `Pass Incompletion`, `Official Timeout`, `Kickoff`, `Punt`, `Sack`, `Penalty`, `Rushing Touchdown`, `Passing Touchdown`, `Field Goal Good`, `Muffed Punt Recovery (Opponent)`, `End Period`, `Pass Interception Return`, `Two-minute warning`, `Timeout`, `End of Half`.

This taxonomy is treated as **open, not closed** — it comes from one game and will contain values not seen here. Unknown types must not throw; they fall through to the importance filter's default.

**MLB play shape** — top-level `plays[]`:
`id`, `text`, `type.text`, `scoringPlay`, `scoreValue`, `period.{type,number,displayValue}`, `outs`, `resultCount.{balls,strikes}`, `atBatId`, `participants`, `sequenceNumber`, `wallclock`, `team`.
Filtering `type.text == "Play Result"` yields 57 of 388 — the natural at-bat-outcome filter.

### 2.2 F1 requires a different source

ESPN's F1 scoreboard exposes sessions (`FP1`, `FP2`, `FP3`, `Qual`, `Race`) each with a `competitors[]` leaderboard, but no event feed — no overtakes, pit stops, or safety cars as discrete records.

**OpenF1** (`api.openf1.org`, free, no auth) serves the official race-control feed:
`GET /v1/race_control?session_key=latest` → `[{meeting_key, session_key, date, driver_number, lap_number, category, flag, scope, sector, qualifying_phase, message}]`

`GET /v1/sessions?year=2026` resolves the current session. These are the stewards' own messages — a genuine event stream, better than diffing positions.

### 2.3 CORS asymmetry drives the architecture

ESPN sends `access-control-allow-origin: *`. **OpenF1 sends no CORS header at all.** A content-script `fetch` from the `espn.com` origin would therefore be blocked for F1.

In MV3, service-worker fetches covered by `host_permissions` are not subject to CORS. **All network calls therefore go through `background.js`.** This is also the cleaner boundary independent of the CORS constraint.

---

## 3. Architecture

`background.js` is currently a 12-line stub. It becomes the data and inference layer. `content.js` becomes UI only.

```
content.js  (UI only)                        background.js  (service worker)
  overlay / drag / log        message         ├── GameFeed    → Espn{Nfl,Mlb} | OpenF1 | DomScrape
  renders GameEvent[]      ◀───passing───▶    └── Explainer   → Claude | Rules
  no network, no parsing                          all fetch(), all API keys
```

Neither a feed nor an explainer may touch the DOM. `content.js` may not `fetch`.

### 3.1 Normalized event

Every feed emits the same shape:

```js
{
  id,          // stable feed-provided id — dedup key
  sport,       // 'nfl' | 'mlb' | 'f1'
  type,        // feed's own classification, verbatim
  text,        // feed's own description, verbatim
  period,      // {type, number, display}
  clock,       // display string, nullable
  score,       // {home, away} — null for f1
  isScoring,   // bool
  importance   // 'high' | 'normal' | 'low' — computed, gates the LLM
}
```

### 3.2 Dedup fix

`isDuplicateEvent` (`content.js:2003`) compares description strings inside a 5-second window. It drops legitimately repeated plays and double-fires slow ones. Every feed supplies a stable `id`, so dedup becomes a `Set` membership test and the heuristic is deleted.

---

## 4. Sprint 1 — data layer

### 4.1 `GameFeed` interface

```
detect(url) → {sport, eventId} | null
poll(eventId) → GameEvent[]        // newest last; caller dedups by id
```

Implementations:

| Class | Source | Notes |
|---|---|---|
| `EspnNflFeed` | ESPN summary | flattens `drives.previous[].plays[]` + `drives.current.plays[]` |
| `EspnMlbFeed` | ESPN summary | filters `type.text == "Play Result"` |
| `OpenF1Feed` | OpenF1 race_control | resolves session via `/v1/sessions`, polls `/v1/race_control` |
| `DomScrapeFeed` | today's scraping | **retained** as fallback |

### 4.2 Feed selection and fallback

Sport and event id come from the URL (`espn.com/nfl/game/_/gameId/401873298`). If the structured feed returns non-200, malformed JSON, or an empty play list for a game whose `status.type.state` is `in`, fall back to `DomScrapeFeed` for that session and surface a degraded-mode note in the overlay. The undocumented endpoints can be changed or blocked by ESPN without notice; the scraper is the insurance and is not deleted.

### 4.3 Polling

Single 10s interval in the service worker (feed `cache-control` is `max-age=3`), replacing the several `setInterval` timers in `content.js`. Polling stops when the game state is `post` or the user stops monitoring.

### 4.4 Importance filter

Computed per event. It drives overlay display in Sprint 1 and **is the sole gate on LLM calls** in Sprint 2.

- `high` — `isScoring`; turnovers (`Pass Interception Return`, fumble recovery, `Muffed Punt Recovery (Opponent)`); `Penalty`; `Sack`; 4th-down attempts; MLB `scoreValue > 0`, walks, strikeouts ending an inning; F1 `flag` non-null or `category` in {`SafetyCar`, `Flag`, `Drs`}
- `low` — `Official Timeout`, `Timeout`, `End Period`, `End of Half`, `Two-minute warning`, MLB non-`Play Result`
- `normal` — everything else, **including unrecognized types**

Routing by tier:

| Tier | Explainer | Cost | ~count/NFL game |
|---|---|---|---|
| `high` | Claude, falling back to rules | ~$0.0008 each | ~25-30 |
| `normal` | rules only — never reaches the API | free | ~80 |
| `low` | suppressed, not shown | free | ~20 |

`normal` plays (a routine 6-yard rush) are the bulk of a game and are neither interesting to a newcomer nor worth a paid call; the existing rules cover them where a branch exists. This routing is what holds the per-game cost at §5.2's figure — widening the LLM gate to `normal` would take one NFL game from roughly 30 calls to 110.

---

## 5. Sprint 2 — AI explanations

### 5.1 `ExplanationProvider` interface

```
explain(event, gameContext) → string | null
```

Tried in order, first non-null wins:

1. **`ClaudeExplainer`** — `claude-haiku-4-5`, key from `chrome.storage.local`
2. **`RuleExplainer`** — today's keyword branches, extracted from the god class unchanged in behavior

If Claude is unconfigured, rate-limited, over budget, or errors, the rules answer. If the rules have no branch, the user sees nothing — exactly today's behavior. **The AI layer is strictly additive: no path degrades below current behavior.**

### 5.2 Model and cost

`claude-haiku-4-5` — $1/1M input, $5/1M output.

Per explanation ≈ 400 input + 70 output ≈ **$0.0008**. Only `high`-importance events reach the API (§4.4), so ~25-30 calls per game rather than 129: **~2-3¢ per game**.

Haiku is a deliberate choice, not a default. The task is short-form rewriting of an already-classified, already-described play into one or two plain sentences — narrow, well-specified, and a poor use of a larger model.

### 5.3 Prompt

- **System prompt, per sport:** rulebook context, target reader (newcomer), hard constraints — one to two sentences, no jargon, never invent detail absent from the input, never speculate about intent or outcome.
- **User message:** the normalized event as structured fields, not prose.

The model only ever describes typed feed data. Scraped DOM text is never sent to the API — under `DomScrapeFeed` fallback the rules explainer is used.

### 5.4 Key handling

`chrome.storage.local`, entered and cleared from the popup, never logged, never sent anywhere but `api.anthropic.com`. The popup states plainly that the key is stored locally and that play data is sent to Anthropic.

### 5.5 Budget guard

A per-install daily call cap in `chrome.storage.local`, default 500 calls/day (~$0.40). On cap, `ClaudeExplainer` returns `null` and the rules answer. Users are spending their own key; the cap prevents a runaway loop from quietly draining it.

---

## 6. Compliance changes (blocking)

**`privacy.html` is currently false.** It states PlaySense "sends no data to external servers." After Sprint 1 that is wrong (ESPN, OpenF1); after Sprint 2 it is materially wrong (play data to Anthropic).

It must be rewritten before **either** sprint ships, disclosing: which third parties receive data, what data (public game identifiers and play descriptions — no personal information), that the API key is stored locally only, and that no analytics or tracking exist. The Chrome Web Store listing's privacy section needs the same.

**`manifest.json`** — add to `host_permissions`: `https://site.api.espn.com/*`, `https://api.openf1.org/*`, `https://api.anthropic.com/*`.

---

## 7. Testing

The repo has no test infrastructure. Add a minimal runner plus **recorded fixtures captured from the live games used in the spike**: a 129-play NFL game with 6 scoring plays, a 388-play MLB game, and an OpenF1 race-control response.

Covers, without network or token spend:
- feed parsing per sport, including unknown `type` values
- dedup by id (the repeated-play and slow-play cases the old heuristic got wrong)
- importance filter classification
- explainer fallback chain: Claude error → rules → null
- `DomScrapeFeed` fallback triggering

Fixtures are committed. Live-endpoint calls are never made from tests.

---

## 8. Risks

**Direct browser access to `api.anthropic.com` is unverified.** The API may require the `anthropic-dangerous-direct-browser-access` header, or may reject browser-origin requests regardless. Service-worker fetches under `host_permissions` are CORS-exempt, so it may work as-is — but this is not confirmed.

**Sprint 2 task 1 is a probe of exactly this**, before any explainer code is written. If direct access is blocked, BYOK requires a thin proxy, which changes Phase 1's cost from $0 and must be raised with the user as a re-scoping decision rather than absorbed.

**ESPN endpoints are undocumented** and may change or be blocked without notice. Mitigated by the `DomScrapeFeed` fallback (§4.2), not eliminated.

**OpenF1 is a volunteer-run free service** with no uptime guarantee. F1 degrades to no explanations when it is down; NFL and MLB are unaffected.

---

## 9. Out of scope

- Hosted inference proxy and the free-tier/quota system (deferred Phase 2; the `ExplanationProvider` interface is the seam it drops into)
- User accounts, settings sync, telemetry
- NBA, NHL, soccer
- Streaming responses into the overlay
- Cross-browser and mobile support

---

## 10. Implementation order

**Sprint 1 — data layer**
1. Test harness + recorded fixtures
2. `GameEvent` shape, importance filter, id-based dedup
3. `EspnNflFeed`, `EspnMlbFeed`, `OpenF1Feed`
4. `DomScrapeFeed` — extract existing scraping behind the interface
5. Move polling and all `fetch` into `background.js`; reduce `content.js` to UI
6. `manifest.json` host permissions; `privacy.html` rewrite

**Sprint 2 — AI layer**
1. **Probe `api.anthropic.com` from a service worker** — stop and re-scope if blocked
2. `ExplanationProvider` interface; extract `RuleExplainer` with behavior unchanged
3. `ClaudeExplainer` — Haiku 4.5, per-sport prompts, budget guard
4. Popup key entry/clear UI and disclosure copy
5. `privacy.html` second revision covering Anthropic

Each sprint ends with a commit and a code review pass before the next begins.
