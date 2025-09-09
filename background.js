// Background service worker for UnderstandThisGame extension

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('UnderstandThisGame extension installed');
});

// Handle messages between different parts of the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'log_event') {
    // Could store events in chrome.storage if needed for persistence
    console.log('Game event:', request.event);
  }
  
  // Always return true for async message handling
  return true;
});

// Optional: Handle tab updates to re-inject content script if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('espn.com')) {
    // Content script should already be injected via manifest
    // This is just a placeholder for any additional logic
  }
});

// Handle browser action (extension icon) click
chrome.action.onClicked.addListener((tab) => {
  // This won't fire if we have a popup, but kept for completeness
  chrome.tabs.sendMessage(tab.id, {action: 'toggle'});
});