chrome.runtime.onInstalled.addListener(() => {
  // Extension installed or updated
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'log_event') {
    // Event relay placeholder — reserved for future persistence
  }
  return true;
});
