# PlaySense — Production-Ready Design Spec
**Date:** 2026-04-20  
**Target:** Chrome Web Store public release  
**Scope:** Full Production Hardening + UX Improvements (Option B+C)

---

## 1. Chrome Web Store Compliance

### Icons
Generate three sizes from `assets/logo.png`:
- `assets/icon16.png` (16×16)
- `assets/icon48.png` (48×48)  
- `assets/icon128.png` (128×128)

Register all three in `manifest.json` under `"icons"` and `"action.default_icon"`.

### Permissions Cleanup
Remove from both `host_permissions` and `content_scripts.matches`:
- `http://localhost/*`
- `http://127.0.0.1/*`
- `file:///*`

Production permissions: `https://www.espn.com/*` and `https://espn.com/*` only.

### Content Security Policy
Add to `manifest.json`:
```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'"
}
```
Move the Google Fonts `@import` in `popup.html` to a `<link rel="stylesheet">` tag — CWS blocks `@import` in inline styles.

### Privacy Page
Add `privacy.html` at the extension root. Content: factual disclosure that PlaySense reads ESPN page content locally in the browser, stores events in memory only during the session, sends no data to external servers, and collects no personal information.

### Manifest Metadata
- `"version"`: `"1.0.0"` (semantic versioning)
- `"short_name"`: `"PlaySense"`
- `"homepage_url"`: to be filled before CWS submission
- Description remains accurate and under 132 characters (CWS limit)

---

## 2. Production Hardening

### Strip Debug Logging
Remove all `console.log` calls across `content.js`, `popup.js`, and `background.js`. Retain `console.error` only for genuine runtime failures (uncaught errors, initialization failures).

Affected files: ~50+ statements in `content.js`, ~10 in `popup.js`, ~3 in `background.js`.

### Fix XSS Vulnerability
`updateLog()` in `content.js` builds log entries via `innerHTML` using event data. Replace with safe DOM node construction (same approach used in `createOverlay()`). The existing `sanitizeString()` method already exists but is not applied before this render path.

### Fix Branding Inconsistency
The overlay title text currently reads `"UnderstandThisGame"` (content.js line 211). Rename to `"PlaySense"`.

Rename all element IDs from `understand-game-*` prefix to `playsense-*` throughout `content.js` and `styles.css`:
- `understand-game-overlay` → `playsense-overlay`
- `understand-game-header` → `playsense-header`
- `understand-game-content` → `playsense-content`
- `understand-game-current` → `playsense-current`
- `understand-game-log` → `playsense-log`
- `understand-game-toggle-log` → `playsense-toggle-log`
- `understand-game-minimize` → `playsense-minimize`
- `understand-game-close` → `playsense-close`

### Tighten Error Handling
Remove `error.stack` exposure from `handleError()` return value — stack traces expose internal implementation details. Return message only. Do not surface raw error objects to the event log.

### Background.js Cleanup
Remove:
- Dead `chrome.action.onClicked` listener (never fires when a popup is configured)
- Empty `chrome.tabs.onUpdated` listener with no-op body

Keep only `chrome.runtime.onInstalled` and the message relay handler.

---

## 3. UX Improvements

### First-Run Onboarding
On first install, show a welcome state in the overlay before the user activates monitoring:
- Brief single-sentence description of what PlaySense does
- Supported sports listed as text (NFL, MLB, Formula 1)
- "Got it" button to dismiss

Use `chrome.storage.local` with a `hasSeenOnboarding` flag to show this only once. After dismissal, the overlay shows the standard "Click the extension icon to start" idle state.

### Expanded Explanation Coverage
Add specific explanation cases currently falling through to the generic fallback:

**NFL additions:** punt, kickoff return, two-point conversion, safety, penalty (with type), fourth-down conversion fail.

**MLB additions:** strikeout, walk (base on balls), stolen base, double play, error, home run (with distance if available).

**F1 additions:** fastest lap, virtual safety car, DRS enabled/disabled, driver retirement (DNF), pit stop (with tire compound if available).

### Overlay Polish
- Add a small sport label (text, not emoji) below the header showing the detected sport: "NFL", "MLB", or "F1"
- Add a "Last updated: HH:MM:SS" line below the current event text
- Add the PlaySense wordmark (text, not image) to the overlay header, replacing the current "UnderstandThisGame" text

### Popup Improvements
- Disable "Show Window" and "Hide Window" buttons when `isSupportedPage` is false, with `disabled` attribute and reduced opacity
- Add a "Go to ESPN" anchor link in the popup footer pointing to `https://www.espn.com` for users who land on the popup from a non-ESPN page

---

## Out of Scope
- AI-generated explanations (requires backend + billing)
- NBA, NHL, Soccer support (deferred to Phase 2)
- Mobile or cross-browser support
- User accounts or settings sync

---

## Implementation Order (Agile Sprints)
1. **Sprint 1:** CWS compliance — icons, permissions, CSP, privacy page, manifest metadata
2. **Sprint 2:** Production hardening — strip logs, fix XSS, fix branding, tighten error handling, background.js cleanup
3. **Sprint 3:** UX improvements — onboarding, expanded explanations, overlay polish, popup improvements

Each sprint ends with a commit and a code review pass before starting the next.
