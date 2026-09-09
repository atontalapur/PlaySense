// Content script for PlaySense extension
class PlaySense {
  constructor() {
    try {

      this.isActive = false;
      this.gameType = null;
      this.lastUpdate = null;
      this.eventLog = [];
      this.overlay = null;
      this.checkInterval = null;
      this.pollTimer = null;
      this.errorCount = 0;
      this.maxErrors = 10;
      this.initRetryCount = 0;
      this.maxInitRetries = 5;
      this.isInitialized = false;
      this.onboardingDismissed = false;
      this.performanceMetrics = {
        detectionTime: 0,
        updateTime: 0,
        errorRate: 0
      };

      this.init();

    } catch (error) {
      console.error('PlaySense: Constructor error:', error);
      this.handleError('Constructor', error);
    }
  }

  init() {
    try {
      // Wait for environment to be ready
      if (!this.validateEnvironment()) {
        this.initRetryCount++;
        if (this.initRetryCount >= this.maxInitRetries) {
          console.error('Max initialization retries reached, giving up');
          this.handleError('InitRetryLimit', new Error('Max initialization retries reached'));
          return;
        }

        setTimeout(() => {
          this.init();
        }, 1000);
        return;
      }

      this.createOverlay();
      this.showOnboardingIfNeeded();

      // Listen for messages from popup and the background service worker
      this.messageListener = (request, sender, sendResponse) => {
        try {
          // Returned, not discarded: a handler that replies asynchronously has
          // to answer `true` here or Chrome closes the channel underneath it.
          return this.handleMessage(request, sender, sendResponse);
        } catch (error) {
          this.handleError('MessageHandler', error);
          sendResponse({ error: 'Message handling failed' });
        }
      };
      chrome.runtime.onMessage.addListener(this.messageListener);

      this.isInitialized = true;
    } catch (error) {
      this.handleError('Init', error);
    }
  }

  validateEnvironment() {
    try {
      if (typeof window === 'undefined') {
        console.warn('Window object not available');
        return false;
      }
      if (typeof document === 'undefined') {
        console.warn('Document object not available');
        return false;
      }
      if (typeof chrome === 'undefined') {
        console.warn('Chrome object not available');
        return false;
      }
      if (!chrome.runtime) {
        console.warn('Chrome runtime not available');
        return false;
      }
      if (!document.body) {
        console.warn('Document body not ready');
        return false;
      }
      return true;
    } catch (error) {
      console.warn('Environment validation error:', error);
      return false;
    }
  }

  handleMessage(request, sender, sendResponse) {
    if (!request || typeof request !== 'object') {
      throw new Error('Invalid request format');
    }

    switch (request.action) {
      case 'toggle':
        this.toggle();
        sendResponse({ success: true });
        break;
      case 'getStatus':
        this.handleStatusRequest(sendResponse);
        break;
      case 'showOverlay':
        this.showOverlay();
        sendResponse({ success: true });
        break;
      case 'hideOverlay':
        this.hideOverlay();
        sendResponse({ success: true });
        break;
      case 'reset':
        this.reset();
        sendResponse({ success: true });
        break;
      case 'events':
        // The card has served its purpose the moment real explanations start
        // arriving, and until it is dismissed updateOverlay refuses to write.
        this.dismissOnboarding();
        this.rememberSport(request.events);
        request.events.forEach((event) => {
          const description = event.explanation || event.text;
          this.addEvent(this.labelFor(event), description);
        });
        sendResponse({ ok: true });
        break;
      case 'status':
        this.updateStatusLine(request.status);
        sendResponse({ ok: true });
        break;
      case 'degraded':
        this.addEvent('System', 'Live data feed unavailable. Falling back to page reading.');
        sendResponse({ ok: true });
        break;
      case 'finished':
        this.stopPollTimer();
        this.isActive = false;
        this.addEvent('System', 'This game has finished. Monitoring stopped.');
        sendResponse({ ok: true });
        break;
      case 'legacyScrape':
        sendResponse({ rows: this.legacyScrape() });
        break;
      case 'probeNano':
        // Async: the listener must keep the channel open, so this is the one
        // case that returns true (see the listener in init()).
        this.probeNano().then((probe) => sendResponse({ probe }));
        return true;
      default:
        // Never throw here. A throw reaches handleError, which logs a visible
        // error and resets the extension after maxErrors.
        sendResponse({ ok: false, reason: `unknown action: ${request.action}` });
        break;
    }
  }

  // The live state of the game: clock, what is happening right now, and the
  // score. Updated on every poll, unlike the explanation below it — the MLB
  // feed only yields a narrative play when an at-bat completes, so without this
  // the overlay sat still for minutes while the ESPN page kept redrawing.
  updateStatusLine(status) {
    if (typeof status !== 'string' || status.length === 0) return;
    const el = document.getElementById('playsense-status');
    if (el) el.textContent = status;
  }

  labelFor(event) {
    const sport = (event.sport || '').toUpperCase();
    return event.type ? `${sport} ${event.type}` : sport || 'Event';
  }

  // Sport is no longer detected here; it arrives with the events.
  rememberSport(events) {
    const withSport = events.find(e => e.sport);
    if (withSport) this.gameType = withSport.sport;

    const labelEl = document.getElementById('playsense-sport-label');
    if (labelEl && this.gameType) labelEl.textContent = this.gameType.toUpperCase();
  }

  handleStatusRequest(sendResponse) {
    sendResponse({
      isActive: this.isActive,
      gameType: this.gameType || null,
      eventCount: this.eventLog.length
    });
  }

  // Mirrors probeLanguageModel in src/explainers/nano-probe.js, which the
  // service worker uses on its own global. Written out here rather than
  // imported: a content script reaching a module by dynamic import has to clear
  // both web_accessible_resources and the host page's CSP, and a diagnostic
  // that fails to load tells us nothing about the question it was asked. The
  // shape of the result is the contract; keep the two in step.
  async probeNano() {
    try {
      const api = typeof LanguageModel === 'undefined' ? undefined : LanguageModel;
      if (!api || typeof api.availability !== 'function') {
        return { present: false, availability: null, usable: false, reason: 'not-exposed' };
      }
      const availability = await api.availability();
      return {
        present: true,
        availability: typeof availability === 'string' ? availability : null,
        usable: ['available', 'downloading', 'downloadable'].includes(availability),
        reason: null
      };
    } catch (error) {
      return {
        present: true,
        availability: null,
        usable: false,
        reason: 'availability-threw',
        message: String((error && error.message) || error)
      };
    }
  }

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

  handleError(context, error) {
    this.errorCount++;
    const errorMessage = `Error in ${context}: ${error.message || error}`;
    console.error(errorMessage, error);

    // Add to event log
    this.addEvent('Error', errorMessage);

    // Update performance metrics
    this.performanceMetrics.errorRate = this.errorCount / (this.errorCount + 1);

    // If too many errors, reset
    if (this.errorCount >= this.maxErrors) {
      console.warn('Too many errors, resetting extension');
      this.reset();
    }

    // Return error info for debugging
    return {
      context,
      message: error.message || String(error),
      timestamp: new Date().toISOString()
    };
  }

  reset() {
    try {

      this.stopPollTimer();
      this.cleanup();
      this.errorCount = 0;
      this.eventLog = [];
      this.isInitialized = false;
      this.addEvent('System', 'Extension reset due to errors');
    } catch (error) {
      console.error('Error during reset:', error);
    }
  }

  createOverlay() {
    // Remove any existing overlay first
    const existingOverlay = document.getElementById('playsense-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }

    this.overlay = document.createElement('div');
    this.overlay.id = 'playsense-overlay';

    // Create elements manually instead of innerHTML for better event handling
    const header = document.createElement('div');
    header.id = 'playsense-header';

    const title = document.createElement('span');
    title.textContent = 'PlaySense';

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'header-buttons';

    // Create toggle log button
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'playsense-toggle-log';
    toggleBtn.textContent = 'Log';
    toggleBtn.title = 'Show event history';
    toggleBtn.setAttribute('aria-label', 'Show event history');
    toggleBtn.onclick = () => {

      this.toggleLog();
    };

    // Create minimize button
    const minimizeBtn = document.createElement('button');
    minimizeBtn.id = 'playsense-minimize';
    minimizeBtn.textContent = '−';
    minimizeBtn.onclick = () => {

      this.overlay.classList.toggle('minimized');
    };

    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.id = 'playsense-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Hide overlay';
    closeBtn.setAttribute('aria-label', 'Hide overlay');
    closeBtn.onclick = () => {

      this.hideOverlay();
    };

    buttonContainer.appendChild(toggleBtn);
    buttonContainer.appendChild(minimizeBtn);
    buttonContainer.appendChild(closeBtn);

    header.appendChild(title);
    header.appendChild(buttonContainer);

    // Create content area
    const content = document.createElement('div');
    content.id = 'playsense-content';

    const status = document.createElement('div');
    status.id = 'playsense-status';

    const current = document.createElement('div');
    current.id = 'playsense-current';
    current.textContent = 'Extension loaded! Click the extension icon to start.';

    const log = document.createElement('div');
    log.id = 'playsense-log';
    log.style.display = 'none';

    const sportLabel = document.createElement('div');
    sportLabel.id = 'playsense-sport-label';
    sportLabel.style.cssText = 'font-size:10px; text-transform:uppercase; letter-spacing:1px; opacity:0.6; margin-top:4px;';

    const lastUpdated = document.createElement('div');
    lastUpdated.id = 'playsense-last-updated';
    lastUpdated.style.cssText = 'font-size:10px; opacity:0.5; margin-top:2px;';

    content.appendChild(status);
    content.appendChild(current);
    content.appendChild(sportLabel);
    content.appendChild(lastUpdated);
    content.appendChild(log);

    this.overlay.appendChild(header);
    this.overlay.appendChild(content);

    // Make sure overlay is visible
    this.overlay.style.display = 'block';
    this.overlay.style.visibility = 'visible';
    this.overlay.style.opacity = '1';

    // Append to body and log for debugging
    document.body.appendChild(this.overlay);

    // Make header draggable
    this.makeDraggable();

  }

  showOnboardingIfNeeded() {
    chrome.storage.local.get(['hasSeenOnboarding'], (result) => {
      if (chrome.runtime.lastError) {
        console.warn('PlaySense: storage read failed —', chrome.runtime.lastError.message);
        this.onboardingDismissed = true;
        return;
      }

      if (result.hasSeenOnboarding) {
        this.onboardingDismissed = true;
        return;
      }

      const currentEl = document.getElementById('playsense-current');
      if (!currentEl || !this.overlay) {
        this.onboardingDismissed = true;
        return;
      }

      currentEl.textContent = '';

      const msg = document.createElement('p');
      msg.textContent = 'PlaySense explains live sports events in plain English as they happen.';
      msg.className = 'playsense-onboarding-msg';

      const sports = document.createElement('p');
      sports.textContent = 'Supported: NFL, MLB, Formula 1 on ESPN.';
      sports.className = 'playsense-onboarding-sports';

      const btn = document.createElement('button');
      btn.textContent = 'Got it';
      btn.className = 'playsense-onboarding-btn';
      btn.onclick = () => {
        this.dismissOnboarding();
        currentEl.textContent = 'Click the extension icon to start monitoring.';
      };

      currentEl.appendChild(msg);
      currentEl.appendChild(sports);
      currentEl.appendChild(btn);
    });
  }

  // The onboarding card owns #playsense-current until it is dismissed, and
  // updateOverlay returns early until then. A user who started monitoring
  // without clicking "Got it" therefore watched the status line tick above a
  // frozen card while every explanation piled into the hidden log — which
  // reads exactly like the explanations having broken.
  dismissOnboarding() {
    if (this.onboardingDismissed) return;
    this.onboardingDismissed = true;
    chrome.storage.local.set({ hasSeenOnboarding: true }, () => {
      if (chrome.runtime.lastError) {
        console.warn('PlaySense: storage write failed —', chrome.runtime.lastError.message);
      }
    });
    const currentEl = document.getElementById('playsense-current');
    if (currentEl) currentEl.textContent = '';
  }

  makeDraggable() {
    const header = this.overlay.querySelector('#playsense-header');
    if (!header) {
      console.error('Header not found for dragging');
      return;
    }

    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return; // Don't drag when clicking buttons

      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;

      if (e.target === header || e.target.parentNode === header) {
        isDragging = true;
        header.style.cursor = 'grabbing';
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;

        xOffset = currentX;
        yOffset = currentY;

        // Ensure overlay stays within viewport bounds
        const rect = this.overlay.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width;
        const maxY = window.innerHeight - rect.height;

        currentX = Math.min(Math.max(0, currentX), maxX);
        currentY = Math.min(Math.max(0, currentY), maxY);

        this.overlay.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
      }
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        header.style.cursor = 'grab';
      }
    });

    // Set initial cursor
    header.style.cursor = 'grab';
  }

  showOverlay() {
    if (this.overlay) {

      this.overlay.style.display = 'block';
      this.overlay.style.visibility = 'visible';
      this.overlay.style.opacity = '1';
      this.overlay.style.transition = 'opacity 0.3s ease-in';
    } else {

      this.createOverlay();
    }
  }

  hideOverlay() {

    if (this.overlay) {

      // Add a fade-out animation
      this.overlay.style.transition = 'opacity 0.3s ease-out';
      this.overlay.style.opacity = '0';

      // Hide after animation completes
      setTimeout(() => {
        if (this.overlay) {
          this.overlay.style.display = 'none';
          this.overlay.style.visibility = 'hidden';

        }
      }, 300);

      // Also stop monitoring when hiding
      if (this.isActive) {
        this.stopPolling();
        this.isActive = false;

      }
    } else {

    }
  }

  POLL_INTERVAL_MS = 10000;

  toggle() {
    this.isActive = !this.isActive;
    if (this.isActive) {
      this.startPolling();
    } else {
      this.stopPolling();
    }
  }

  startPolling() {
    chrome.runtime.sendMessage(
      { action: 'start', url: window.location.href },
      (reply) => {
        void chrome.runtime.lastError;
        if (!reply || !reply.ok) {
          this.isActive = false;
          // An F1 page whose race is not running is a real, supported page with
          // nothing live on it. Saying "not supported" there is what hid the
          // wrong-session bug: the message was wrong in a believable way.
          this.addEvent('System', (reply && reply.reason) || 'This page is not a supported live game.');
          return;
        }
        if (!this.isActive) return;
        this.stopPollTimer();
        // Each beat drives one poll cycle in the worker AND resets its 30s
        // idle timer, which is what keeps the worker alive while monitoring.
        this.pollTimer = setInterval(() => {
          chrome.runtime.sendMessage(
            { action: 'poll', url: window.location.href },
            (pollReply) => {
              void chrome.runtime.lastError;
              // The game reached its final state. Stop the clock here rather
              // than beating at ESPN every 10s for the rest of the night and
              // holding the service worker awake with each beat.
              if (pollReply && pollReply.state && pollReply.state.finished) {
                this.stopPollTimer();
                this.isActive = false;
              }
            }
          );
        }, this.POLL_INTERVAL_MS);
      }
    );
  }

  stopPollTimer() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  stopPolling() {
    this.stopPollTimer();
    chrome.runtime.sendMessage({ action: 'stop' }, () => {
      void chrome.runtime.lastError;
    });
  }

  cleanup() {
    try {

      // Clear all intervals
      this.stopPollTimer();

      // Remove event listeners
      if (this.messageListener) {
        chrome.runtime.onMessage.removeListener(this.messageListener);
        this.messageListener = null;
      }

      // Clean up overlay
      if (this.overlay && this.overlay.parentNode) {
        this.overlay.parentNode.removeChild(this.overlay);
        this.overlay = null;
      }

      // Reset state
      this.isActive = false;
      this.isInitialized = false;

    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  // Enhanced initialization with better error recovery
  reinitialize() {
    try {

      this.cleanup();

      // Wait a bit before reinitializing
      setTimeout(() => {
        try {
          this.init();
          this.addEvent('System', 'Extension reinitialized successfully');
        } catch (error) {
          this.handleError('Reinitialization', error);
        }
      }, 1000);
    } catch (error) {
      this.handleError('Reinitialization', error);
    }
  }

  addEvent(type, description) {
    try {
      // Validate and sanitize inputs
      const sanitizedType = this.sanitizeString(type, 'Event Type');
      const sanitizedDescription = this.sanitizeString(description, 'Event Description');

      if (!sanitizedType || !sanitizedDescription) {
        console.warn('Invalid event data, skipping:', { type, description });
        return;
      }

      const event = {
        timestamp: new Date().toLocaleTimeString(),
        type: sanitizedType,
        description: sanitizedDescription,
        createdAt: Date.now()
      };

      // Duplicate suppression now happens upstream via id dedup in
      // src/poller.js, before events ever reach this content script.
      this.eventLog.push(event);

      // Keep only last 50 events (increased from 20)
      if (this.eventLog.length > 50) {
        this.eventLog = this.eventLog.slice(-50);
      }

      this.updateOverlay(sanitizedDescription);
      this.updateLog();

      // Log successful event addition

    } catch (error) {
      this.handleError('AddEvent', error);
    }
  }

  sanitizeString(input, fieldName) {
    if (!input || typeof input !== 'string') {
      console.warn(`PlaySense: Invalid ${fieldName} — expected non-empty string`);
      return null;
    }

    // Remove potentially dangerous content
    let sanitized = input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/javascript:/gi, '') // Remove javascript: protocols
      .replace(/on\w+\s*=/gi, '') // Remove event handlers
      .trim();

    // Limit length
    if (sanitized.length > 500) {
      sanitized = sanitized.substring(0, 500) + '...';
    }

    return sanitized || null;
  }

  updateOverlay(message) {
    if (!this.onboardingDismissed) return;

    const content = document.getElementById('playsense-current');
    if (content) content.textContent = message;

    const ts = document.getElementById('playsense-last-updated');
    if (ts) ts.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
  }

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

  toggleLog() {
    const logElement = document.getElementById('playsense-log');
    const currentElement = document.getElementById('playsense-current');

    if (logElement.style.display === 'none') {
      logElement.style.display = 'block';
      currentElement.style.display = 'none';
    } else {
      logElement.style.display = 'none';
      currentElement.style.display = 'block';
    }
  }
}

// Initialize when page loads with enhanced error handling

// Global error handler for uncaught errors
window.addEventListener('error', (event) => {
  console.error('Global error caught:', event.error);
  if (window.PlaySenseInstance) {
    window.PlaySenseInstance.handleError('GlobalError', event.error);
  }
});

// Global unhandled promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  if (window.PlaySenseInstance) {
    window.PlaySenseInstance.handleError('UnhandledRejection', event.reason);
  }
});

function initializeExtension() {
  try {

    window.PlaySenseInstance = new PlaySense();

  } catch (error) {
    console.error('PlaySense: Failed to initialize:', error);

    // Retry initialization after a delay (only once)
    if (!window.PlaySenseRetryAttempted) {
      window.PlaySenseRetryAttempted = true;
      setTimeout(() => {
        try {

          window.PlaySenseInstance = new PlaySense();
        } catch (retryError) {
          console.error('PlaySense: Retry failed:', retryError);
        }
      }, 2000);
    }
  }
}

if (document.readyState === 'loading') {

  document.addEventListener('DOMContentLoaded', () => {

    initializeExtension();
  });
} else {

  initializeExtension();
}
