import { validateKey } from './src/explainers/claude.js';
import { describeProbe } from './src/explainers/nano-probe.js';

document.addEventListener('DOMContentLoaded', function () {
  const toggleBtn = document.getElementById('toggleBtn');
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const gameType = document.getElementById('gameType');
  const eventCount = document.getElementById('eventCount');
  const showOverlayBtn = document.getElementById('showOverlayBtn');
  const hideOverlayBtn = document.getElementById('hideOverlayBtn');
  const apiKeyInput = document.getElementById('apiKey');
  const saveKeyBtn = document.getElementById('saveKeyBtn');
  const clearKeyBtn = document.getElementById('clearKeyBtn');
  const keyStatus = document.getElementById('keyStatus');
  const probeNanoBtn = document.getElementById('probeNanoBtn');
  const nanoStatus = document.getElementById('nanoStatus');

  // A saved-but-unverified key is its own state, not the same as no key: it is
  // what a key saved by an older build looks like, and what the extension used
  // to report as "enabled" whether or not it worked.
  function renderKeyStatus(hasKey, verified) {
    if (!hasKey) {
      keyStatus.textContent = 'No key saved. Using built-in explanations.';
      return;
    }
    keyStatus.textContent = verified
      ? 'Key saved and verified. AI explanations enabled for major plays.'
      : 'Key saved but never verified. Re-save it to check that it works.';
  }

  const KEY_FAILURES = {
    rejected: 'Anthropic rejected that key. Nothing was saved.',
    network: 'Could not reach Anthropic to check the key. Nothing was saved.',
    unavailable: 'Anthropic could not be reached to check the key. Nothing was saved.',
    empty: 'Enter a key first.'
  };

  chrome.storage.local.get(['anthropicApiKey', 'anthropicKeyVerified'], (result) => {
    renderKeyStatus(Boolean(result.anthropicApiKey), result.anthropicKeyVerified === true);
  });

  saveKeyBtn.addEventListener('click', async () => {
    const value = apiKeyInput.value.trim();
    if (!value) return;

    // Verify BEFORE storing. Storing an unusable key is the exact failure this
    // replaces: the explainer chain falls through to the rules tier on a bad
    // key without saying anything, so the popup used to promise AI explanations
    // the user was never going to get.
    saveKeyBtn.disabled = true;
    keyStatus.textContent = 'Checking key with Anthropic...';

    const result = await validateKey(value);

    if (!result.ok) {
      saveKeyBtn.disabled = false;
      keyStatus.textContent = KEY_FAILURES[result.reason] || 'Could not verify that key. Nothing was saved.';
      return;
    }

    chrome.storage.local.set({ anthropicApiKey: value, anthropicKeyVerified: true }, () => {
      saveKeyBtn.disabled = false;
      apiKeyInput.value = '';
      renderKeyStatus(true, true);
    });
  });

  clearKeyBtn.addEventListener('click', () => {
    chrome.storage.local.remove(['anthropicApiKey', 'anthropicKeyVerified'], () => {
      apiKeyInput.value = '';
      renderKeyStatus(false, false);
    });
  });

  // Answers whether Chrome's built-in Prompt API is reachable, and from where.
  // The service worker is where PlaySense's explainer chain runs, so a model
  // that only the page can see needs a different design than one the worker can
  // call directly. See src/explainers/nano-probe.js.
  probeNanoBtn.addEventListener('click', () => {
    probeNanoBtn.disabled = true;
    nanoStatus.textContent = 'Checking...';

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0] ? tabs[0].id : null;
      chrome.runtime.sendMessage({ action: 'probeNano', tabId }, (reply) => {
        probeNanoBtn.disabled = false;
        if (chrome.runtime.lastError || !reply || !reply.ok) {
          nanoStatus.textContent = 'Could not run the check. Reload the extension and retry.';
          return;
        }
        const lines = [
          describeProbe('Service worker', reply.worker),
          describeProbe('Page', reply.page)
        ];
        nanoStatus.textContent = lines.join(' ');
        console.log('PlaySense: on-device AI probe', reply);
      });
    });
  });

  let currentStatus = {
    isActive: false,
    gameType: null,
    eventCount: 0
  };

  updateStatus();

  toggleBtn.addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'toggle' }, function () {
        setTimeout(updateStatus, 500);
      });
    });
  });

  showOverlayBtn.addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'showOverlay' }, function () {
        if (chrome.runtime.lastError) {
          console.error('PlaySense: showOverlay failed —', chrome.runtime.lastError.message);
        }
      });
    });
  });

  hideOverlayBtn.addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'hideOverlay' }, function () {
        if (chrome.runtime.lastError) {
          console.error('PlaySense: hideOverlay failed —', chrome.runtime.lastError.message);
        }
      });
    });
  });

  // Anchored on the hostname, matching detectGame in src/feeds/index.js. A
  // substring test also accepts https://evil.com/?ref=espn.com and
  // https://espn.com.evil.net/.
  function isEspnPage(rawUrl) {
    try {
      return /(^|\.)espn\.com$/i.test(new URL(rawUrl).hostname);
    } catch {
      return false;
    }
  }

  function updateStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const currentUrl = tabs[0] ? tabs[0].url : '';
      const isSupportedPage = isEspnPage(currentUrl);

      const espnLink = document.getElementById('espnLink');
      if (!isSupportedPage) {
        if (espnLink) espnLink.style.display = 'inline';
        toggleBtn.disabled = true;
        toggleBtn.style.opacity = '0.4';
        showOverlayBtn.disabled = true;
        showOverlayBtn.style.opacity = '0.4';
        hideOverlayBtn.disabled = true;
        hideOverlayBtn.style.opacity = '0.4';
      } else {
        if (espnLink) espnLink.style.display = 'none';
        toggleBtn.disabled = false;
        toggleBtn.style.opacity = '1';
        showOverlayBtn.disabled = false;
        showOverlayBtn.style.opacity = '1';
        hideOverlayBtn.disabled = false;
        hideOverlayBtn.style.opacity = '1';
      }

      if (!tabs[0] || !isSupportedPage) {
        showError('Please navigate to ESPN.com to use PlaySense');
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, { action: 'getStatus' }, function (response) {
        if (chrome.runtime.lastError) {
          console.error('PlaySense: runtime error —', chrome.runtime.lastError.message);
          showError('Please refresh the page or reload the extension');
          return;
        }

        if (response) {
          currentStatus = response;
          updateUI();
        } else {
          showError('Extension not loaded on this page');
        }
      });
    });
  }

  function updateUI() {
    if (currentStatus.isActive) {
      statusIndicator.className = 'status-indicator active';
      statusText.textContent = 'Monitoring Active';
      toggleBtn.textContent = 'Stop Monitoring';
      toggleBtn.className = 'btn';
    } else {
      statusIndicator.className = 'status-indicator inactive';
      statusText.textContent = 'Monitoring Inactive';
      toggleBtn.textContent = 'Start Monitoring';
      toggleBtn.className = 'btn primary';
    }

    if (currentStatus.gameType) {
      gameType.textContent = currentStatus.gameType.toUpperCase();
      gameType.style.color = '#4CAF50';
    } else {
      gameType.textContent = 'UNKNOWN';
      gameType.style.color = '#f44336';
    }

    eventCount.textContent = currentStatus.eventCount || 0;
  }

  function showError(message) {
    statusIndicator.className = 'status-indicator inactive';
    statusText.textContent = message;
    gameType.textContent = 'N/A';
    gameType.style.color = '#f44336';
    eventCount.textContent = '0';
    toggleBtn.textContent = 'Unavailable';
    toggleBtn.disabled = true;
    toggleBtn.style.opacity = '0.5';
  }

  const statusInterval = setInterval(updateStatus, 2000);

  window.addEventListener('beforeunload', function () {
    clearInterval(statusInterval);
  });
});
