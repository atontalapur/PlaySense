# PlaySense Production-Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PlaySense publishable on the Chrome Web Store by fixing compliance gaps, security issues, branding inconsistencies, and UX polish.

**Architecture:** Three sequential sprints — CWS Compliance first (unblocks submission), then Production Hardening (security + quality), then UX Improvements (overlay/popup polish). Each sprint ends with a commit and a code review subagent pass before the next sprint begins.

**Tech Stack:** Chrome Extension MV3, vanilla JavaScript ES6+, CSS3, `chrome.storage.local`, `sips` (macOS built-in) for icon resizing.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `manifest.json` | Modify | Icons, permissions, CSP, metadata |
| `assets/icon16.png` | Create | 16×16 extension icon |
| `assets/icon48.png` | Create | 48×48 extension icon |
| `assets/icon128.png` | Create | 128×128 extension icon |
| `privacy.html` | Create | CWS-required privacy disclosure |
| `popup.html` | Modify | Fix Google Fonts CSP violation, ESPN link, button states |
| `popup.js` | Modify | Strip console.log, disable buttons on unsupported page, ESPN link logic |
| `background.js` | Modify | Strip dead listeners and console.log |
| `content.js` | Modify | Strip 81 console.log, fix XSS in updateLog(), rename IDs, fix branding, fix error handling, add onboarding, expand explanations, overlay polish |
| `styles.css` | Modify | Rename all 30 `#understand-game-*` selectors to `#playsense-*` |

---

## Sprint 1 — Chrome Web Store Compliance

---

### Task 1: Create the production-ready branch

**Files:** none (git operation)

- [ ] **Step 1: Create and switch to branch**

```bash
git checkout -b production-ready
```

Expected output: `Switched to a new branch 'production-ready'`

---

### Task 2: Generate icon assets

**Files:**
- Create: `assets/icon16.png`
- Create: `assets/icon48.png`
- Create: `assets/icon128.png`

- [ ] **Step 1: Generate all three sizes from logo.png using sips (macOS built-in)**

```bash
sips -z 16 16 assets/logo.png --out assets/icon16.png
sips -z 48 48 assets/logo.png --out assets/icon48.png
sips -z 128 128 assets/logo.png --out assets/icon128.png
```

Expected: three new PNG files appear in `assets/`.

- [ ] **Step 2: Verify files exist and are non-zero**

```bash
ls -lh assets/icon16.png assets/icon48.png assets/icon128.png
```

Expected: all three files listed with sizes > 0 bytes.

---

### Task 3: Update manifest.json

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Replace manifest.json with production-ready version**

Replace the entire contents of `manifest.json` with:

```json
{
  "manifest_version": 3,
  "name": "PlaySense",
  "short_name": "PlaySense",
  "version": "1.0.0",
  "description": "Real-time plain-English explanations of live NFL, MLB, and F1 events on ESPN.",
  "homepage_url": "https://github.com/atontalapur/PlaySense",
  "icons": {
    "16": "assets/icon16.png",
    "48": "assets/icon48.png",
    "128": "assets/icon128.png"
  },
  "permissions": [
    "activeTab",
    "storage",
    "scripting"
  ],
  "host_permissions": [
    "https://www.espn.com/*",
    "https://espn.com/*"
  ],
  "content_scripts": [
    {
      "matches": [
        "https://www.espn.com/*",
        "https://espn.com/*"
      ],
      "js": ["content.js"],
      "css": ["styles.css"]
    }
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_title": "PlaySense",
    "default_icon": {
      "16": "assets/icon16.png",
      "48": "assets/icon48.png",
      "128": "assets/icon128.png"
    }
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

- [ ] **Step 2: Verify manifest is valid JSON**

```bash
python3 -m json.tool manifest.json > /dev/null && echo "Valid JSON"
```

Expected: `Valid JSON`

---

### Task 4: Create privacy.html

**Files:**
- Create: `privacy.html`

- [ ] **Step 1: Create the privacy page**

Create `privacy.html` with this content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PlaySense — Privacy Policy</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 680px;
      margin: 48px auto;
      padding: 0 24px;
      color: #1a1a1a;
      line-height: 1.6;
    }
    h1 { font-size: 24px; margin-bottom: 8px; }
    h2 { font-size: 16px; margin-top: 32px; }
    p { margin: 8px 0; color: #444; }
    .updated { color: #888; font-size: 13px; }
  </style>
</head>
<body>
  <h1>PlaySense Privacy Policy</h1>
  <p class="updated">Last updated: April 20, 2026</p>

  <h2>What PlaySense does</h2>
  <p>PlaySense is a Chrome extension that reads ESPN game pages and displays plain-English explanations of live sports events in an overlay on your screen.</p>

  <h2>Data collection</h2>
  <p>PlaySense does not collect, transmit, or store any personal information. No data is ever sent to any external server. All processing happens locally in your browser.</p>

  <h2>ESPN page content</h2>
  <p>PlaySense reads the text content of ESPN game pages to detect live game events. This content is processed in memory only and is discarded when you close the tab or deactivate monitoring. It is never stored beyond your active session.</p>

  <h2>Browser storage</h2>
  <p>PlaySense uses <code>chrome.storage.local</code> to remember whether you have seen the first-run onboarding message. No other data is stored.</p>

  <h2>Third-party services</h2>
  <p>PlaySense does not use any third-party analytics, advertising, or tracking services.</p>

  <h2>Contact</h2>
  <p>Questions about this policy can be directed to the extension's GitHub repository.</p>
</body>
</html>
```

---

### Task 5: Fix Google Fonts CSP violation in popup.html

**Files:**
- Modify: `popup.html`

The current `popup.html` uses `@import url('https://fonts.googleapis.com/...')` inside an inline `<style>` tag. The new CSP (`script-src 'self'`) will not block CSS external requests directly, but CWS reviewers flag `@import` in inline styles as bad practice. Replace with a `<link>` tag.

- [ ] **Step 1: Replace the inline @import with a link tag**

Find this in `popup.html`:
```html
<head>
  <meta charset="utf-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
```

Replace with:
```html
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap">
  <style>
```

---

### Task 6: Commit Sprint 1

- [ ] **Step 1: Stage and commit**

```bash
git add manifest.json assets/icon16.png assets/icon48.png assets/icon128.png privacy.html popup.html
git commit -m "feat: Chrome Web Store compliance — icons, permissions, CSP, privacy page"
```

- [ ] **Step 2: Verify commit landed**

```bash
git log --oneline -3
```

---

## Sprint 2 — Production Hardening

---

### Task 7: Clean up background.js

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Replace background.js with the cleaned version**

Replace the entire contents of `background.js` with:

```js
chrome.runtime.onInstalled.addListener(() => {
  // Extension installed or updated
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'log_event') {
    // Event relay placeholder — reserved for future persistence
  }
  return true;
});
```

---

### Task 8: Strip console.log from popup.js

**Files:**
- Modify: `popup.js`

- [ ] **Step 1: Remove all console.log calls in popup.js**

Find and remove every `console.log(...)` line in `popup.js`. There are approximately 4. Keep `console.log` inside `catch` blocks only if they are the only error reporting (replace with `console.error`).

The two `console.log` calls to keep as `console.error`:
- In `updateStatus()` callback: `console.log('Chrome runtime error:', chrome.runtime.lastError)` → change to `console.error('Chrome runtime error:', chrome.runtime.lastError.message)`
- The `console.log('No response received from content script')` → remove entirely (already shown in UI via `showError`)

After editing, `popup.js` should contain zero `console.log` calls. Verify:

```bash
grep -c "console.log" popup.js
```

Expected: `0`

---

### Task 9: Strip console.log from content.js (81 instances)

**Files:**
- Modify: `content.js`

- [ ] **Step 1: Remove all console.log calls**

Run this to confirm count before editing:
```bash
grep -c "console.log" content.js
```
Expected: `81`

Remove every `console.log(...)` line. Rules:
- `console.error(...)` → keep as-is (these are legitimate error paths)
- `console.warn(...)` → keep as-is (legitimate warnings)
- `console.log(...)` → delete the line entirely

After editing, verify:
```bash
grep -c "console.log" content.js
```
Expected: `0`

---

### Task 10: Fix XSS vulnerability in updateLog()

**Files:**
- Modify: `content.js`

The `updateLog()` method uses `innerHTML` with event data. Even though `sanitizeString()` cleans input on the way in, using `innerHTML` is unsafe by design. Replace with safe DOM node construction.

- [ ] **Step 1: Replace the updateLog() method**

Find this method in `content.js`:

```js
updateLog() {
  const logElement = document.getElementById('understand-game-log');
  if (logElement) {
    logElement.innerHTML = this.eventLog.map(event =>
      `<div class="log-entry">
        <span class="log-time">${event.timestamp}</span>
        <span class="log-type">[${event.type}]</span>
        <span class="log-desc">${event.description}</span>
      </div>`
    ).reverse().join('');
  }
}
```

Replace with:

```js
updateLog() {
  const logElement = document.getElementById('playsense-log');
  if (!logElement) return;

  logElement.textContent = '';
  const reversed = [...this.eventLog].reverse();
  reversed.forEach(event => {
    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = event.timestamp;

    const type = document.createElement('span');
    type.className = 'log-type';
    type.textContent = `[${event.type}]`;

    const desc = document.createElement('span');
    desc.className = 'log-desc';
    desc.textContent = event.description;

    entry.appendChild(time);
    entry.appendChild(type);
    entry.appendChild(desc);
    logElement.appendChild(entry);
  });
}
```

---

### Task 11: Fix branding — rename all element IDs in content.js

**Files:**
- Modify: `content.js`

- [ ] **Step 1: Rename the overlay title text**

Find in `content.js`:
```js
title.textContent = 'UnderstandThisGame';
```
Replace with:
```js
title.textContent = 'PlaySense';
```

- [ ] **Step 2: Rename all element IDs (15 occurrences)**

Do a find-and-replace across `content.js` for each of these pairs:

| Find | Replace |
|------|---------|
| `understand-game-overlay` | `playsense-overlay` |
| `understand-game-header` | `playsense-header` |
| `understand-game-content` | `playsense-content` |
| `understand-game-current` | `playsense-current` |
| `understand-game-log` | `playsense-log` |
| `understand-game-toggle-log` | `playsense-toggle-log` |
| `understand-game-minimize` | `playsense-minimize` |
| `understand-game-close` | `playsense-close` |

After editing, verify no old IDs remain:
```bash
grep -c "understand-game" content.js
```
Expected: `0`

---

### Task 12: Fix branding — rename all selectors in styles.css

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Rename all 30 CSS selectors**

Do a find-and-replace in `styles.css` for each pair from Task 11. Same mapping applies (e.g., `#understand-game-overlay` → `#playsense-overlay`).

After editing, verify:
```bash
grep -c "understand-game" styles.css
```
Expected: `0`

---

### Task 13: Tighten error handling in content.js

**Files:**
- Modify: `content.js`

- [ ] **Step 1: Remove stack trace from handleError() return value**

Find in `content.js`:
```js
return {
  context,
  message: error.message || error,
  stack: error.stack,
  timestamp: new Date().toISOString()
};
```
Replace with:
```js
return {
  context,
  message: error.message || String(error),
  timestamp: new Date().toISOString()
};
```

---

### Task 14: Commit Sprint 2

- [ ] **Step 1: Stage and commit**

```bash
git add content.js popup.js background.js styles.css
git commit -m "feat: production hardening — strip debug logs, fix XSS, fix branding, tighten error handling"
```

- [ ] **Step 2: Verify commit landed**

```bash
git log --oneline -3
```

---

## Sprint 3 — UX Improvements

---

### Task 15: First-run onboarding in content.js

**Files:**
- Modify: `content.js`

- [ ] **Step 1: Add showOnboardingIfNeeded() method**

Add this method to the `PlaySense` class, after the `createOverlay()` method:

```js
showOnboardingIfNeeded() {
  chrome.storage.local.get(['hasSeenOnboarding'], (result) => {
    if (result.hasSeenOnboarding) return;

    const currentEl = document.getElementById('playsense-current');
    if (!currentEl) return;

    currentEl.textContent = '';

    const msg = document.createElement('p');
    msg.textContent = 'PlaySense explains live sports events in plain English as they happen.';
    msg.style.cssText = 'margin:0 0 8px 0; font-size:13px;';

    const sports = document.createElement('p');
    sports.textContent = 'Supported: NFL, MLB, Formula 1 on ESPN.';
    sports.style.cssText = 'margin:0 0 12px 0; font-size:12px; opacity:0.8;';

    const btn = document.createElement('button');
    btn.textContent = 'Got it';
    btn.style.cssText = 'background:#4f46e5; color:white; border:none; padding:6px 16px; border-radius:6px; cursor:pointer; font-size:12px;';
    btn.onclick = () => {
      chrome.storage.local.set({ hasSeenOnboarding: true });
      currentEl.textContent = 'Click the extension icon to start monitoring.';
    };

    currentEl.appendChild(msg);
    currentEl.appendChild(sports);
    currentEl.appendChild(btn);
  });
}
```

- [ ] **Step 2: Call showOnboardingIfNeeded() from init()**

In the `init()` method, after `this.createOverlay()`, add:
```js
this.showOnboardingIfNeeded();
```

---

### Task 16: Add sport label and last-updated timestamp to overlay

**Files:**
- Modify: `content.js`
- Modify: `styles.css`

- [ ] **Step 1: Add sport label and timestamp elements in createOverlay()**

After the `content` div is built in `createOverlay()`, before `this.overlay.appendChild(header)`, add two new elements. Insert after:
```js
content.appendChild(current);
content.appendChild(log);
```

Add:
```js
const sportLabel = document.createElement('div');
sportLabel.id = 'playsense-sport-label';
sportLabel.style.cssText = 'font-size:10px; text-transform:uppercase; letter-spacing:1px; opacity:0.6; margin-top:4px;';

const lastUpdated = document.createElement('div');
lastUpdated.id = 'playsense-last-updated';
lastUpdated.style.cssText = 'font-size:10px; opacity:0.5; margin-top:2px;';

content.appendChild(sportLabel);
content.appendChild(lastUpdated);
```

- [ ] **Step 2: Update sport label when game type is detected**

In `detectGameType()`, after `this.gameType` is set and validated, add:
```js
const labelEl = document.getElementById('playsense-sport-label');
if (labelEl) {
  labelEl.textContent = this.gameType ? this.gameType.toUpperCase() : '';
}
```

- [ ] **Step 3: Update last-updated timestamp in updateOverlay()**

Find:
```js
updateOverlay(message) {
  const content = document.getElementById('playsense-current');
  if (content) {
    content.textContent = message;
  }
}
```

Replace with:
```js
updateOverlay(message) {
  const content = document.getElementById('playsense-current');
  if (content) content.textContent = message;

  const ts = document.getElementById('playsense-last-updated');
  if (ts) ts.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
}
```

---

### Task 17: Expand NFL explanation coverage

**Files:**
- Modify: `content.js`

- [ ] **Step 1: Replace explainNFLPlay() with expanded version**

Find the existing `explainNFLPlay()` method and replace it entirely with:

```js
explainNFLPlay(playText) {
  const text = playText.toLowerCase();

  if (text.includes('touchdown')) {
    return 'Touchdown! A player reached the end zone and scored 6 points for their team.';
  }
  if (text.includes('two-point conversion') || text.includes('two point conversion')) {
    return 'Two-point conversion attempt! Instead of kicking for 1 extra point, they are trying to run or pass into the end zone for 2 points.';
  }
  if (text.includes('extra point') || text.includes('pat')) {
    return 'Extra point! After a touchdown, the kicker attempts a short kick through the goalposts for 1 bonus point.';
  }
  if (text.includes('field goal')) {
    return 'Field goal! The kicker scored 3 points by kicking the ball through the goalposts.';
  }
  if (text.includes('safety')) {
    return 'Safety! The defense tackled an offensive player in their own end zone — worth 2 points for the defense.';
  }
  if (text.includes('interception')) {
    return 'Interception! The defense caught a pass meant for the offense and took control of the ball.';
  }
  if (text.includes('fumble')) {
    return 'Fumble! A player dropped the ball — whichever team recovers it gets possession.';
  }
  if (text.includes('sack')) {
    return 'Sack! The quarterback was tackled behind the line before he could throw the ball.';
  }
  if (text.includes('punt')) {
    return 'Punt! The offense kicked the ball away on 4th down rather than risk losing possession at this field position.';
  }
  if (text.includes('kickoff return') || text.includes('kick return')) {
    return 'Kickoff return! After a score, the receiving team is running the kicked ball back up the field.';
  }
  if (text.includes('fourth down') || text.includes('4th down')) {
    return '4th down! This is the offense\'s last chance to gain the yards needed for a first down before potentially losing the ball.';
  }
  if (text.includes('penalty') || text.includes('flag')) {
    return 'Penalty! A referee spotted a rule violation and is moving the ball to penalize the offending team.';
  }
  return `Play update: ${playText}`;
}
```

---

### Task 18: Expand MLB explanation coverage

**Files:**
- Modify: `content.js`

- [ ] **Step 1: Find existing MLB explain call sites**

```bash
grep -n "explainMLB" content.js
```

Note the line numbers. `explainMLBEvent()` will be called from these same sites wherever raw event text needs explaining.

- [ ] **Step 2: Expand the MLB explanation logic**

Find the existing `explainMLBInning()` method and add a new `explainMLBEvent()` method directly after it:

```js
explainMLBEvent(eventText) {
  const text = eventText.toLowerCase();

  if (text.includes('home run') || text.includes('homerun')) {
    return 'Home run! The batter hit the ball out of the park — all runners on base score, plus the batter.';
  }
  if (text.includes('strikeout') || text.includes('struck out')) {
    return 'Strikeout! The batter got three strikes and is out. The pitcher wins this matchup.';
  }
  if (text.includes('walk') || text.includes('base on balls')) {
    return 'Walk! The pitcher threw 4 balls outside the strike zone, so the batter gets a free trip to first base.';
  }
  if (text.includes('stolen base')) {
    return 'Stolen base! A runner sprinted to the next base while the pitcher was winding up — risky but it worked.';
  }
  if (text.includes('double play')) {
    return 'Double play! The defense got two outs on a single play — a huge momentum swing.';
  }
  if (text.includes('error')) {
    return 'Error! A fielder made a mistake (dropped the ball or threw it badly), giving the batter or runners extra bases they did not earn.';
  }
  if (text.includes('single')) {
    return 'Single! The batter hit the ball and safely reached first base.';
  }
  if (text.includes('double') && !text.includes('double play')) {
    return 'Double! The batter hit the ball far enough to reach second base safely.';
  }
  if (text.includes('triple')) {
    return 'Triple! The batter hit the ball and made it all the way to third base — a rare and exciting hit.';
  }
  return `Play update: ${eventText}`;
}
```

---

### Task 19: Expand F1 explanation coverage

**Files:**
- Modify: `content.js`

- [ ] **Step 1: Expand explainF1Event() with new cases**

Find the existing `explainF1Event()` method and replace it with:

```js
explainF1Event(eventText) {
  const text = eventText.toLowerCase();

  if (text.includes('overtake') || text.includes('passed') || text.includes('position change')) {
    return 'Position change! A driver has passed another, moving up in the race standings.';
  }
  if (text.includes('pit stop') || text.includes('pitting')) {
    const compound = text.includes('soft') ? ' (soft tyres — fast but wear quickly)' :
                     text.includes('medium') ? ' (medium tyres — balanced choice)' :
                     text.includes('hard') ? ' (hard tyres — slow but last longer)' : '';
    return `Pit stop! A car pulled into the garage to change tyres${compound} and potentially refuel. This costs about 2–3 seconds.`;
  }
  if (text.includes('safety car') && !text.includes('virtual')) {
    return 'Safety car deployed! All cars must slow down and follow the safety car while an incident on track is cleared.';
  }
  if (text.includes('virtual safety car') || text.includes('vsc')) {
    return 'Virtual safety car! Drivers must slow to a set speed limit without a physical safety car. Used for minor incidents.';
  }
  if (text.includes('fastest lap')) {
    return 'Fastest lap! A driver just set the quickest single lap of the race — worth 1 bonus championship point if they finish in the top 10.';
  }
  if (text.includes('drs')) {
    return 'DRS (Drag Reduction System) activated! A car opened a flap on its rear wing to reduce drag and gain speed on a straight — used to help overtaking.';
  }
  if (text.includes('retire') || text.includes('dnf') || text.includes('out of the race')) {
    return 'Retirement (DNF — Did Not Finish)! A car has dropped out of the race due to a mechanical failure or incident.';
  }
  if (text.includes('penalty')) {
    return 'Penalty! A driver broke a rule (unsafe driving, exceeding track limits, etc.) and will serve a time penalty added to their race time.';
  }
  if (text.includes('lap')) {
    return `Race update: ${eventText}`;
  }
  return `Race event: ${eventText}`;
}
```

---

### Task 20: Popup improvements — disable buttons and add ESPN link

**Files:**
- Modify: `popup.js`
- Modify: `popup.html`

- [ ] **Step 1: Add ESPN link to popup.html**

At the end of `popup.html`, before the closing `</body>` tag, replace the existing `<script src="popup.js"></script>` line's surrounding area with this footer before the script tag:

```html
  <div style="text-align:center; padding: 8px 20px 16px; font-size:11px;">
    <a id="espnLink" href="https://www.espn.com" target="_blank" style="color:#a78bfa; text-decoration:none; display:none;">Open ESPN</a>
  </div>
  <script src="popup.js"></script>
```

- [ ] **Step 2: Update updateStatus() in popup.js to manage button states and ESPN link**

In `popup.js`, find the `updateStatus()` function and add logic after the `isSupportedPage` check:

After this block:
```js
if (!tabs[0] || !isSupportedPage) {
  showError('Please navigate to ESPN.com or use the test page');
  return;
}
```

Add above that line (so it runs for ALL cases including unsupported):
```js
const espnLink = document.getElementById('espnLink');
const showOverlayBtn = document.getElementById('showOverlayBtn');
const hideOverlayBtn = document.getElementById('hideOverlayBtn');

if (!isSupportedPage) {
  if (espnLink) espnLink.style.display = 'inline';
  if (showOverlayBtn) { showOverlayBtn.disabled = true; showOverlayBtn.style.opacity = '0.4'; }
  if (hideOverlayBtn) { hideOverlayBtn.disabled = true; hideOverlayBtn.style.opacity = '0.4'; }
} else {
  if (espnLink) espnLink.style.display = 'none';
  if (showOverlayBtn) { showOverlayBtn.disabled = false; showOverlayBtn.style.opacity = '1'; }
  if (hideOverlayBtn) { hideOverlayBtn.disabled = false; hideOverlayBtn.style.opacity = '1'; }
}
```

---

### Task 21: Manual verification checklist

Before the final commit, load the extension in Chrome and verify:

- [ ] **Step 1: Load the extension**
  - Open Chrome → `chrome://extensions`
  - Enable Developer Mode
  - Click "Load unpacked" → select the `PlaySense` folder
  - Verify the extension icon appears in the toolbar using the 16×16 icon

- [ ] **Step 2: Verify popup**
  - Click the extension icon
  - Popup loads without errors
  - On a non-ESPN tab: "Show Window" and "Hide Window" buttons are grayed out, "Open ESPN" link is visible
  - On `https://www.espn.com`: buttons are enabled, ESPN link is hidden

- [ ] **Step 3: Verify overlay on ESPN**
  - Navigate to `https://www.espn.com`
  - Overlay appears in top-left corner with title "PlaySense"
  - First-run: onboarding message shown with "Got it" button
  - After "Got it": standard idle message shown
  - Second load (refresh): onboarding not shown again

- [ ] **Step 4: Verify no console.log output**
  - Open DevTools on ESPN page → Console tab
  - Only `console.error` messages (if any errors occur)
  - No `console.log` output from PlaySense

---

### Task 22: Commit Sprint 3

- [ ] **Step 1: Stage and commit**

```bash
git add content.js popup.js popup.html styles.css
git commit -m "feat: UX improvements — onboarding, expanded explanations, overlay sport label, popup polish"
```

- [ ] **Step 2: Verify final commit history**

```bash
git log --oneline production-ready
```

Expected output (3 feature commits + original commits):
```
<hash> feat: UX improvements — onboarding, expanded explanations, overlay sport label, popup polish
<hash> feat: production hardening — strip debug logs, fix XSS, fix branding, tighten error handling
<hash> feat: Chrome Web Store compliance — icons, permissions, CSP, privacy page
```

---

## Post-Implementation: CWS Submission Steps

After the branch is reviewed and merged to `main`:

1. **Zip the extension:** Include all files except `docs/`, `.git/`, `test-scraping.html`, and `demo/`.
2. **Chrome Web Store Developer Dashboard:** `https://chrome.google.com/webstore/devconsole`
3. **One-time $5 developer registration fee** (if not already paid)
4. **Required fields for submission:**
   - Screenshots: at least 1 (1280×800 or 640×400)
   - Privacy policy URL: host `privacy.html` publicly (GitHub Pages works)
   - Category: Productivity
   - Detailed description: expand from the manifest description
5. **Review time:** typically 1–3 business days for new extensions
