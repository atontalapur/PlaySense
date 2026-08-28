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

  function updateStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const currentUrl = tabs[0] ? tabs[0].url : '';
      const isSupportedPage = currentUrl.includes('espn.com');

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
