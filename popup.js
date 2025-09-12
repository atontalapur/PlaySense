// Popup script for PlaySense extension
document.addEventListener('DOMContentLoaded', function () {
  const toggleBtn = document.getElementById('toggleBtn');
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const gameType = document.getElementById('gameType');
  const eventCount = document.getElementById('eventCount');

  let currentStatus = {
    isActive: false,
    gameType: null,
    eventCount: 0
  };

  // Initialize popup
  updateStatus();

  // Toggle button event listener
  toggleBtn.addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'toggle' }, function (response) {
        // Update status after a short delay
        setTimeout(updateStatus, 500);
      });
    });
  });

  // Show overlay button
  document.getElementById('showOverlayBtn').addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'showOverlay' });
    });
  });

  // Hide overlay button
  document.getElementById('hideOverlayBtn').addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'hideOverlay' });
    });
  });

  function updateStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const currentUrl = tabs[0] ? tabs[0].url : '';
      console.log('Current tab URL:', currentUrl);

      // Allow extension to work on ESPN pages and test pages
      const isSupportedPage = currentUrl.includes('espn.com') ||
        currentUrl.includes('localhost') ||
        currentUrl.includes('127.0.0.1') ||
        currentUrl.startsWith('file://');

      if (!tabs[0] || !isSupportedPage) {
        showError('Please navigate to ESPN.com or use the test page');
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, { action: 'getStatus' }, function (response) {
        if (chrome.runtime.lastError) {
          console.log('Chrome runtime error:', chrome.runtime.lastError);
          showError('Please refresh the page or check if extension is loaded');
          return;
        }

        if (response) {
          console.log('Received status response:', response);
          currentStatus = response;
          updateUI();
        } else {
          console.log('No response received from content script');
          showError('Extension not loaded on this page');
        }
      });
    });
  }

  function updateUI() {
    // Update status indicator and text
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

    // Update game type
    if (currentStatus.gameType) {
      gameType.textContent = currentStatus.gameType.toUpperCase();
      gameType.style.color = '#4CAF50';
    } else {
      gameType.textContent = 'UNKNOWN';
      gameType.style.color = '#f44336';
    }

    // Update event count
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

  // Refresh status every 2 seconds when popup is open
  const statusInterval = setInterval(updateStatus, 2000);

  // Clean up interval when popup closes
  window.addEventListener('beforeunload', function () {
    clearInterval(statusInterval);
  });
});