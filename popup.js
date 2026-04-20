document.addEventListener('DOMContentLoaded', function () {
  const toggleBtn = document.getElementById('toggleBtn');
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const gameType = document.getElementById('gameType');
  const eventCount = document.getElementById('eventCount');
  const showOverlayBtn = document.getElementById('showOverlayBtn');
  const hideOverlayBtn = document.getElementById('hideOverlayBtn');

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
      chrome.tabs.sendMessage(tabs[0].id, { action: 'showOverlay' });
    });
  });

  hideOverlayBtn.addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'hideOverlay' });
    });
  });

  function updateStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const currentUrl = tabs[0] ? tabs[0].url : '';
      const isSupportedPage = currentUrl.includes('espn.com');

      const espnLink = document.getElementById('espnLink');
      if (!isSupportedPage) {
        if (espnLink) espnLink.style.display = 'inline';
        showOverlayBtn.disabled = true;
        showOverlayBtn.style.opacity = '0.4';
        hideOverlayBtn.disabled = true;
        hideOverlayBtn.style.opacity = '0.4';
      } else {
        if (espnLink) espnLink.style.display = 'none';
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
