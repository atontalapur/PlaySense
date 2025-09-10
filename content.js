// Content script for PlaySense extension
class PlaySense {
  constructor() {
    try {
      console.log('PlaySense: Constructor called');
      this.isActive = false;
      this.gameType = null;
      this.lastUpdate = null;
      this.eventLog = [];
      this.overlay = null;
      this.checkInterval = null;
      this.previousGameState = {};
      this.errorCount = 0;
      this.maxErrors = 10;
      this.retryCount = 0;
      this.maxRetries = 3;
      this.initRetryCount = 0;
      this.maxInitRetries = 5;
      this.isInitialized = false;
      this.performanceMetrics = {
        detectionTime: 0,
        updateTime: 0,
        errorRate: 0
      };

      console.log('PlaySense: Initializing...');
      this.init();
      console.log('PlaySense: Initialization complete');
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
        console.log(`Environment not ready, waiting... (retry ${this.initRetryCount}/${this.maxInitRetries})`);
        setTimeout(() => {
          this.init();
        }, 1000);
        return;
      }

      this.createOverlay();
      this.detectGameType();

      // Re-detect game type periodically in case page content changes
      this.gameTypeInterval = setInterval(() => {
        try {
          const previousGameType = this.gameType;
          this.detectGameType();

          // If game type changed, log it
          if (previousGameType !== this.gameType) {
            console.log(`Game type changed from ${previousGameType} to ${this.gameType}`);
            this.addEvent('System', `Game type changed to ${this.gameType ? this.gameType.toUpperCase() : 'Unknown'}`);
          }
        } catch (error) {
          this.handleError('GameTypeDetection', error);
        }
      }, 10000); // Check every 10 seconds

      // Listen for messages from popup
      this.messageListener = (request, sender, sendResponse) => {
        try {
          this.handleMessage(request, sender, sendResponse);
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
        sendResponse({
          isActive: this.isActive,
          gameType: this.gameType,
          eventCount: this.eventLog.length,
          errorCount: this.errorCount,
          isInitialized: this.isInitialized,
          performanceMetrics: this.performanceMetrics
        });
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
      default:
        throw new Error(`Unknown action: ${request.action}`);
    }
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
      message: error.message || error,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };
  }

  reset() {
    try {
      console.log('Resetting extension...');
      this.stopMonitoring();
      this.cleanup();
      this.errorCount = 0;
      this.retryCount = 0;
      this.previousGameState = {};
      this.eventLog = [];
      this.isInitialized = false;
      this.addEvent('System', 'Extension reset due to errors');
    } catch (error) {
      console.error('Error during reset:', error);
    }
  }

  createOverlay() {
    // Remove any existing overlay first
    const existingOverlay = document.getElementById('understand-game-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }

    this.overlay = document.createElement('div');
    this.overlay.id = 'understand-game-overlay';
    this.overlay.innerHTML = `
      <div id="understand-game-header">
        <span>PlaySense</span>
        <div class="header-buttons">
          <button id="understand-game-toggle-log">📋</button>
          <button id="understand-game-minimize">−</button>
          <button id="understand-game-close">✕</button>
        </div>
      </div>
      <div id="understand-game-content">
        <div id="understand-game-current">Extension loaded! Click the extension icon to start.</div>
        <div id="understand-game-log" style="display: none;"></div>
      </div>
    `;

    // Make sure overlay is visible
    this.overlay.style.display = 'block';
    this.overlay.style.visibility = 'visible';
    this.overlay.style.opacity = '1';

    // Make header draggable
    this.makeDraggable();

    // Append to body and log for debugging
    document.body.appendChild(this.overlay);
    console.log('PlaySense: Overlay created and added to page');

    // Add event listeners with a small delay to ensure elements are rendered
    setTimeout(() => {
      this.addOverlayEventListeners();
    }, 100);

    // Also add event delegation as a fallback
    this.addEventDelegation();

    // Test if overlay is actually visible
    setTimeout(() => {
      const overlayCheck = document.getElementById('understand-game-overlay');
      if (overlayCheck) {
        console.log('PlaySense: Overlay confirmed on page');
        console.log('Overlay position:', overlayCheck.getBoundingClientRect());
      } else {
        console.error('PlaySense: Overlay not found after creation!');
      }
    }, 1000);
  }

  addOverlayEventListeners() {
    try {
      console.log('Adding overlay event listeners...');

      // Toggle log button
      const toggleLogBtn = document.getElementById('understand-game-toggle-log');
      if (toggleLogBtn) {
        toggleLogBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('Toggle log button clicked');
          this.toggleLog();
        });
        console.log('Toggle log button listener added');
      } else {
        console.error('Toggle log button not found');
      }

      // Minimize button
      const minimizeBtn = document.getElementById('understand-game-minimize');
      if (minimizeBtn) {
        minimizeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('Minimize button clicked');
          this.overlay.classList.toggle('minimized');
        });
        console.log('Minimize button listener added');
      } else {
        console.error('Minimize button not found');
      }

      // Close button
      const closeBtn = document.getElementById('understand-game-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('Close button clicked');
          this.hideOverlay();
        });
        console.log('Close button listener added');
      } else {
        console.error('Close button not found');
      }

      console.log('All overlay event listeners added successfully');
    } catch (error) {
      console.error('Error adding overlay event listeners:', error);
    }
  }

  addEventDelegation() {
    // Use event delegation as a fallback for button clicks
    document.addEventListener('click', (e) => {
      // Only handle clicks within our overlay
      if (!this.overlay || !this.overlay.contains(e.target)) {
        return;
      }

      const target = e.target;

      // Handle close button
      if (target.id === 'understand-game-close') {
        e.preventDefault();
        e.stopPropagation();
        console.log('Close button clicked (via delegation)');
        this.hideOverlay();
        return;
      }

      // Handle minimize button
      if (target.id === 'understand-game-minimize') {
        e.preventDefault();
        e.stopPropagation();
        console.log('Minimize button clicked (via delegation)');
        this.overlay.classList.toggle('minimized');
        return;
      }

      // Handle toggle log button
      if (target.id === 'understand-game-toggle-log') {
        e.preventDefault();
        e.stopPropagation();
        console.log('Toggle log button clicked (via delegation)');
        this.toggleLog();
        return;
      }
    });

    console.log('Event delegation added as fallback');
  }

  makeDraggable() {
    const header = this.overlay.querySelector('#understand-game-header');
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
      console.log('Showing existing overlay');
      this.overlay.style.display = 'block';
      this.overlay.style.visibility = 'visible';
      this.overlay.style.opacity = '1';
      this.overlay.style.transition = 'opacity 0.3s ease-in';
    } else {
      console.log('Creating new overlay');
      this.createOverlay();
    }
  }

  hideOverlay() {
    if (this.overlay) {
      console.log('Hiding overlay');

      // Add a fade-out animation
      this.overlay.style.transition = 'opacity 0.3s ease-out';
      this.overlay.style.opacity = '0';

      // Hide after animation completes
      setTimeout(() => {
        this.overlay.style.display = 'none';
        this.overlay.style.visibility = 'hidden';
        console.log('Overlay hidden successfully');
      }, 300);

      // Also stop monitoring when hiding
      if (this.isActive) {
        this.stopMonitoring();
        this.isActive = false;
        console.log('Monitoring stopped due to overlay hide');
      }
    } else {
      console.log('No overlay to hide');
    }
  }

  detectGameType() {
    const startTime = performance.now();

    try {
      // Validate inputs
      const url = this.validateUrl(window.location.href);
      const pageContent = this.extractPageContent();

      if (!url || !pageContent) {
        this.gameType = null;
        this.updateOverlay('Unable to detect game - invalid page content');
        return;
      }

      // Enhanced game type detection with scoring system
      const gameScores = {
        nfl: this.getNFLScore(url, pageContent),
        mlb: this.getMLBScore(url, pageContent),
        f1: this.getF1Score(url, pageContent)
      };

      // Validate scores
      const validScores = Object.values(gameScores).filter(score =>
        typeof score === 'number' && !isNaN(score) && isFinite(score)
      );

      if (validScores.length === 0) {
        this.gameType = null;
        this.updateOverlay('Unable to detect game - scoring failed');
        return;
      }

      // Find the game type with the highest score
      const maxScore = Math.max(...validScores);

      // Dynamic threshold based on page content quality
      const minThreshold = this.calculateDynamicThreshold(pageContent);

      if (maxScore >= minThreshold) {
        this.gameType = Object.keys(gameScores).find(key => gameScores[key] === maxScore);

        // Additional validation for detected game type
        if (!this.validateGameType(this.gameType, url, pageContent)) {
          this.gameType = null;
          this.updateOverlay('Game detection validation failed');
          return;
        }
      } else {
        this.gameType = null;
      }

      // Performance tracking
      this.performanceMetrics.detectionTime = performance.now() - startTime;

      console.log('Game detection scores:', gameScores);
      console.log('Detected game type:', this.gameType);
      console.log('Detection threshold:', minThreshold);
      console.log('Detection time:', this.performanceMetrics.detectionTime + 'ms');

      this.updateOverlay(`Detected: ${this.gameType ? this.gameType.toUpperCase() : 'No supported game'}`);

      if (this.gameType) {
        this.addEvent('System', `Ready to monitor ${this.gameType.toUpperCase()} game`);
      }
    } catch (error) {
      this.handleError('GameDetection', error);
      this.gameType = null;
      this.updateOverlay('Game detection failed');
    }
  }

  validateUrl(url) {
    if (!url || typeof url !== 'string') {
      return null;
    }

    try {
      const urlObj = new URL(url);
      return urlObj.href;
    } catch (error) {
      console.warn('Invalid URL:', url);
      return null;
    }
  }

  extractPageContent() {
    try {
      if (!document.body) {
        return '';
      }

      // Get text content with better extraction
      const textContent = document.body.innerText || document.body.textContent || '';

      if (!textContent || textContent.length < 10) {
        console.warn('Page content too short or empty');
        return '';
      }

      return textContent.toLowerCase().trim();
    } catch (error) {
      console.error('Error extracting page content:', error);
      return '';
    }
  }

  calculateDynamicThreshold(pageContent) {
    // Base threshold
    let threshold = 5;

    // Adjust based on content quality
    if (pageContent.length < 100) {
      threshold = 3; // Lower threshold for short content
    } else if (pageContent.length > 5000) {
      threshold = 8; // Higher threshold for long content (more noise)
    }

    // Adjust based on content diversity
    const uniqueWords = new Set(pageContent.split(/\s+/)).size;
    if (uniqueWords < 50) {
      threshold = 3;
    } else if (uniqueWords > 500) {
      threshold = 10;
    }

    return Math.max(3, Math.min(15, threshold));
  }

  validateGameType(gameType, url, pageContent) {
    if (!gameType) return false;

    // Additional validation for detected game type
    const validationPatterns = {
      nfl: ['nfl', 'football', 'touchdown', 'quarterback'],
      mlb: ['mlb', 'baseball', 'inning', 'home run'],
      f1: ['f1', 'formula', 'grand prix', 'lap time']
    };

    const patterns = validationPatterns[gameType];
    if (!patterns) return false;

    // Check if at least 2 validation patterns are present
    const matches = patterns.filter(pattern =>
      pageContent.includes(pattern) || url.toLowerCase().includes(pattern)
    );

    return matches.length >= 2;
  }

  getNFLScore(url, pageContent) {
    try {
      if (!url || !pageContent) return 0;

      let score = 0;
      const lowerUrl = url.toLowerCase();

      // URL patterns for NFL (higher weight)
      const nflUrlPatterns = [
        { pattern: '/nfl/', weight: 15, exact: false },
        { pattern: 'nfl.com', weight: 15, exact: false },
        { pattern: 'nflgame', weight: 12, exact: false },
        { pattern: 'nfl-live', weight: 12, exact: false },
        { pattern: '/football/', weight: 8, exact: false },
        { pattern: 'nfl-football', weight: 10, exact: false },
        { pattern: 'espn.com/nfl', weight: 20, exact: false },
        { pattern: 'sports.nfl.com', weight: 18, exact: false }
      ];

      nflUrlPatterns.forEach(({ pattern, weight, exact }) => {
        if (exact ? lowerUrl === pattern : lowerUrl.includes(pattern)) {
          score += weight;
        }
      });

      // Content patterns for NFL (more specific terms)
      const nflContentPatterns = [
        { pattern: 'touchdown', weight: 10, context: ['scored', 'caught', 'threw'] },
        { pattern: 'field goal', weight: 10, context: ['kicked', 'made', 'missed'] },
        { pattern: 'quarterback', weight: 8, context: ['pass', 'threw', 'sacked'] },
        { pattern: 'running back', weight: 8, context: ['rushed', 'carried', 'fumbled'] },
        { pattern: 'yard line', weight: 7, context: ['yard', 'line', 'down'] },
        { pattern: 'first down', weight: 7, context: ['down', 'yard', 'gained'] },
        { pattern: 'second down', weight: 6, context: ['down', 'yard', 'gained'] },
        { pattern: 'third down', weight: 6, context: ['down', 'yard', 'gained'] },
        { pattern: 'fourth down', weight: 6, context: ['down', 'yard', 'gained'] },
        { pattern: 'interception', weight: 9, context: ['threw', 'caught', 'returned'] },
        { pattern: 'fumble', weight: 9, context: ['recovered', 'lost', 'forced'] },
        { pattern: 'sack', weight: 7, context: ['quarterback', 'tackled', 'loss'] },
        { pattern: 'punt', weight: 6, context: ['kicked', 'returned', 'downed'] },
        { pattern: 'kickoff', weight: 6, context: ['returned', 'kicked', 'recovered'] },
        { pattern: 'end zone', weight: 8, context: ['touchdown', 'goal', 'line'] },
        { pattern: 'goal line', weight: 7, context: ['yard', 'line', 'down'] },
        { pattern: 'extra point', weight: 7, context: ['kicked', 'made', 'missed'] },
        { pattern: 'two point conversion', weight: 8, context: ['conversion', 'attempt', 'successful'] },
        { pattern: 'nfl', weight: 4, context: [] }, // Lower weight for generic term
        { pattern: 'football', weight: 3, context: [] } // Lower weight for generic term
      ];

      nflContentPatterns.forEach(({ pattern, weight, context }) => {
        if (pageContent.includes(pattern)) {
          let contextBonus = 0;

          // Check for context words that increase confidence
          if (context.length > 0) {
            const contextMatches = context.filter(ctx => pageContent.includes(ctx));
            contextBonus = Math.min(contextMatches.length * 2, 5); // Max 5 point bonus
          }

          score += weight + contextBonus;
        }
      });

      // Penalty for non-NFL sports terms
      const nonNFLTerms = ['baseball', 'mlb', 'inning', 'home run', 'formula 1', 'f1', 'grand prix'];
      const nonNFLMatches = nonNFLTerms.filter(term => pageContent.includes(term));
      score -= nonNFLMatches.length * 2;

      return Math.max(0, score);
    } catch (error) {
      this.handleError('NFLScoring', error);
      return 0;
    }
  }

  getMLBScore(url, pageContent) {
    try {
      if (!url || !pageContent) return 0;

      let score = 0;
      const lowerUrl = url.toLowerCase();

      // URL patterns for MLB (higher weight)
      const mlbUrlPatterns = [
        { pattern: '/mlb/', weight: 15, exact: false },
        { pattern: 'mlb.com', weight: 15, exact: false },
        { pattern: 'mlbgame', weight: 12, exact: false },
        { pattern: 'mlb-live', weight: 12, exact: false },
        { pattern: '/baseball/', weight: 8, exact: false },
        { pattern: 'mlb-baseball', weight: 10, exact: false },
        { pattern: 'espn.com/mlb', weight: 20, exact: false },
        { pattern: 'sports.mlb.com', weight: 18, exact: false }
      ];

      mlbUrlPatterns.forEach(({ pattern, weight, exact }) => {
        if (exact ? lowerUrl === pattern : lowerUrl.includes(pattern)) {
          score += weight;
        }
      });

      // Content patterns for MLB (more specific terms)
      const mlbContentPatterns = [
        { pattern: 'home run', weight: 10, context: ['hit', 'scored', 'homerun'] },
        { pattern: 'strikeout', weight: 8, context: ['struck', 'swinging', 'looking'] },
        { pattern: 'inning', weight: 7, context: ['top', 'bottom', 'ninth'] },
        { pattern: 'pitcher', weight: 7, context: ['threw', 'struck', 'walked'] },
        { pattern: 'batter', weight: 7, context: ['hit', 'struck', 'walked'] },
        { pattern: 'homerun', weight: 10, context: ['hit', 'scored', 'home run'] },
        { pattern: 'base hit', weight: 7, context: ['single', 'double', 'triple'] },
        { pattern: 'double play', weight: 8, context: ['turned', 'completed', 'grounded'] },
        { pattern: 'triple play', weight: 9, context: ['turned', 'completed', 'rare'] },
        { pattern: 'walk', weight: 6, context: ['base', 'ball', 'four'] },
        { pattern: 'wild pitch', weight: 6, context: ['threw', 'scored', 'advanced'] },
        { pattern: 'balk', weight: 6, context: ['called', 'illegal', 'motion'] },
        { pattern: 'sacrifice', weight: 6, context: ['fly', 'bunt', 'out'] },
        { pattern: 'fly out', weight: 6, context: ['caught', 'outfield', 'infield'] },
        { pattern: 'ground out', weight: 6, context: ['fielded', 'thrown', 'first'] },
        { pattern: 'strike zone', weight: 7, context: ['called', 'umpire', 'pitch'] },
        { pattern: 'mound', weight: 6, context: ['pitcher', 'threw', 'mound'] },
        { pattern: 'diamond', weight: 6, context: ['baseball', 'field', 'infield'] },
        { pattern: 'mlb', weight: 4, context: [] }, // Lower weight for generic term
        { pattern: 'baseball', weight: 3, context: [] } // Lower weight for generic term
      ];

      mlbContentPatterns.forEach(({ pattern, weight, context }) => {
        if (pageContent.includes(pattern)) {
          let contextBonus = 0;

          // Check for context words that increase confidence
          if (context.length > 0) {
            const contextMatches = context.filter(ctx => pageContent.includes(ctx));
            contextBonus = Math.min(contextMatches.length * 2, 5); // Max 5 point bonus
          }

          score += weight + contextBonus;
        }
      });

      // Penalty for non-MLB sports terms
      const nonMLBTerms = ['football', 'nfl', 'touchdown', 'formula 1', 'f1', 'grand prix'];
      const nonMLBMatches = nonMLBTerms.filter(term => pageContent.includes(term));
      score -= nonMLBMatches.length * 2;

      return Math.max(0, score);
    } catch (error) {
      this.handleError('MLBScoring', error);
      return 0;
    }
  }

  getF1Score(url, pageContent) {
    try {
      if (!url || !pageContent) return 0;

      let score = 0;
      const lowerUrl = url.toLowerCase();

      // URL patterns for F1 (higher weight)
      const f1UrlPatterns = [
        { pattern: '/f1/', weight: 15, exact: false },
        { pattern: 'f1.com', weight: 15, exact: false },
        { pattern: 'formula1.com', weight: 15, exact: false },
        { pattern: 'f1-live', weight: 12, exact: false },
        { pattern: 'formula-1-live', weight: 12, exact: false },
        { pattern: '/formula-1/', weight: 12, exact: false },
        { pattern: '/formula1/', weight: 12, exact: false },
        { pattern: 'espn.com/f1', weight: 20, exact: false },
        { pattern: 'formula1.com', weight: 18, exact: false }
      ];

      f1UrlPatterns.forEach(({ pattern, weight, exact }) => {
        if (exact ? lowerUrl === pattern : lowerUrl.includes(pattern)) {
          score += weight;
        }
      });

      // Content patterns for F1 (more specific terms)
      const f1ContentPatterns = [
        { pattern: 'formula 1', weight: 10, context: ['racing', 'championship', 'season'] },
        { pattern: 'formula one', weight: 10, context: ['racing', 'championship', 'season'] },
        { pattern: 'grand prix', weight: 8, context: ['race', 'qualifying', 'monaco'] },
        { pattern: 'lap time', weight: 7, context: ['fastest', 'personal', 'best'] },
        { pattern: 'qualifying', weight: 7, context: ['session', 'pole', 'position'] },
        { pattern: 'overtake', weight: 8, context: ['passed', 'position', 'driver'] },
        { pattern: 'pit stop', weight: 7, context: ['tires', 'fuel', 'seconds'] },
        { pattern: 'safety car', weight: 8, context: ['deployed', 'yellow', 'flag'] },
        { pattern: 'pole position', weight: 7, context: ['qualifying', 'start', 'grid'] },
        { pattern: 'fastest lap', weight: 7, context: ['bonus', 'point', 'record'] },
        { pattern: 'drs', weight: 6, context: ['zone', 'activated', 'overtaking'] },
        { pattern: 'kers', weight: 6, context: ['energy', 'recovery', 'boost'] },
        { pattern: 'championship', weight: 7, context: ['points', 'leader', 'standings'] },
        { pattern: 'constructors', weight: 7, context: ['championship', 'team', 'points'] },
        { pattern: 'grid', weight: 6, context: ['position', 'start', 'formation'] },
        { pattern: 'sector', weight: 6, context: ['time', 'split', 'track'] },
        { pattern: 'f1', weight: 4, context: [] }, // Lower weight for generic term
        { pattern: 'race', weight: 3, context: [] }, // Lower weight for generic term
        { pattern: 'driver', weight: 3, context: [] } // Lower weight for generic term
      ];

      f1ContentPatterns.forEach(({ pattern, weight, context }) => {
        if (pageContent.includes(pattern)) {
          let contextBonus = 0;

          // Check for context words that increase confidence
          if (context.length > 0) {
            const contextMatches = context.filter(ctx => pageContent.includes(ctx));
            contextBonus = Math.min(contextMatches.length * 2, 5); // Max 5 point bonus
          }

          score += weight + contextBonus;
        }
      });

      // Penalty for non-F1 sports terms
      const nonF1Terms = ['football', 'nfl', 'touchdown', 'baseball', 'mlb', 'home run'];
      const nonF1Matches = nonF1Terms.filter(term => pageContent.includes(term));
      score -= nonF1Matches.length * 2;

      return Math.max(0, score);
    } catch (error) {
      this.handleError('F1Scoring', error);
      return 0;
    }
  }

  toggle() {
    this.isActive = !this.isActive;

    if (this.isActive) {
      this.startMonitoring();
      this.updateOverlay('Monitoring started...');
    } else {
      this.stopMonitoring();
      this.updateOverlay('Monitoring stopped');
    }
  }

  startMonitoring() {
    if (!this.gameType) {
      this.updateOverlay('No supported game detected');
      return;
    }

    // Check if we're actually on a live game page
    if (!this.isLiveGamePage()) {
      this.updateOverlay('No live game data detected on this page');
      this.addEvent('System', 'Please navigate to a live game page to start monitoring');
      return;
    }

    this.updateOverlay('Monitoring live game data...');
    this.checkInterval = setInterval(() => {
      this.checkForUpdates();
    }, 3000); // Check every 3 seconds
  }

  isLiveGamePage() {
    const pageContent = document.body.innerText.toLowerCase();

    // Look for live indicators
    const liveIndicators = [
      'live', 'livescore', 'live score', 'live game',
      'in progress', 'currently playing', 'now playing',
      'quarter', 'inning', 'lap', 'period'
    ];

    const hasLiveIndicator = liveIndicators.some(indicator =>
      pageContent.includes(indicator)
    );

    // Look for time-based elements that suggest live data
    const timeElements = document.querySelectorAll('*');
    let hasTimeData = false;

    timeElements.forEach(el => {
      const text = el.textContent.trim();
      // Look for time formats like "15:30", "3rd Quarter", "Top 5th", etc.
      if (text.match(/\d+:\d+/) ||
        text.match(/\d+(st|nd|rd|th)\s+(quarter|inning|period)/) ||
        text.match(/(top|bottom)\s+\d+(st|nd|rd|th)/)) {
        hasTimeData = true;
      }
    });

    // Look for score elements
    const scoreElements = document.querySelectorAll('*');
    let hasScoreData = false;

    scoreElements.forEach(el => {
      const text = el.textContent.trim();
      // Look for score patterns like "14-7", "3-2", etc.
      if (text.match(/\d+-\d+/) && text.length < 10) {
        hasScoreData = true;
      }
    });

    return hasLiveIndicator || hasTimeData || hasScoreData;
  }

  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  // Clean up all intervals when extension is disabled
  cleanup() {
    try {
      console.log('Cleaning up extension...');

      // Clear all intervals
      if (this.checkInterval) {
        clearInterval(this.checkInterval);
        this.checkInterval = null;
      }
      if (this.gameTypeInterval) {
        clearInterval(this.gameTypeInterval);
        this.gameTypeInterval = null;
      }

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

      console.log('Extension cleanup complete');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  // Enhanced initialization with better error recovery
  reinitialize() {
    try {
      console.log('Reinitializing extension...');
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

  checkForUpdates() {
    const startTime = performance.now();

    try {
      if (!this.isActive) return;

      // Validate environment before checking
      if (!this.validateEnvironment()) {
        console.warn('Environment validation failed, skipping update check');
        this.updateOverlay('Waiting for page to load...');
        return;
      }

      // Log what we're checking for debugging
      console.log(`PlaySense: Checking for ${this.gameType} updates...`);
      console.log(`Page URL: ${window.location.href}`);
      console.log(`Page title: ${document.title}`);

      // Count total elements on page for debugging (with performance limit)
      const totalElements = this.getPageElementCount();
      console.log(`Total elements on page: ${totalElements}`);

      // Check if page has changed significantly
      if (this.hasPageChanged()) {
        console.log('Page content changed significantly, re-detecting game type');
        this.detectGameType();
      }

      // Execute game-specific update checks
      switch (this.gameType) {
        case 'nfl':
          this.checkNFLUpdates();
          break;
        case 'mlb':
          this.checkMLBUpdates();
          break;
        case 'f1':
          this.checkF1Updates();
          break;
        default:
          console.warn('Unknown game type for updates:', this.gameType);
      }

      // Update performance metrics
      this.performanceMetrics.updateTime = performance.now() - startTime;

      // Update overlay with timestamp to show it's working
      const now = new Date().toLocaleTimeString();
      if (this.eventLog.length === 0 ||
        this.eventLog[this.eventLog.length - 1].timestamp !== now) {
        // Only update if we haven't updated recently
        this.updateOverlay(`Monitoring... (Last check: ${now})`);
      }

      // Reset error count on successful update
      if (this.errorCount > 0) {
        this.errorCount = Math.max(0, this.errorCount - 1);
      }

    } catch (error) {
      this.handleError('UpdateCheck', error);
    }
  }

  getPageElementCount() {
    try {
      // Limit element counting for performance
      const elements = document.querySelectorAll('*');
      return Math.min(elements.length, 10000); // Cap at 10k for performance
    } catch (error) {
      console.warn('Error counting page elements:', error);
      return 0;
    }
  }

  hasPageChanged() {
    try {
      const currentUrl = window.location.href;
      const currentTitle = document.title;

      // Check if URL or title changed
      if (this.lastUpdate &&
        (this.lastUpdate.url !== currentUrl || this.lastUpdate.title !== currentTitle)) {
        this.lastUpdate = { url: currentUrl, title: currentTitle, timestamp: Date.now() };
        return true;
      }

      // Check if content has changed significantly (sample check)
      const contentSample = document.body ? document.body.innerText.substring(0, 1000) : '';
      if (this.lastUpdate && this.lastUpdate.contentSample !== contentSample) {
        this.lastUpdate.contentSample = contentSample;
        return true;
      }

      return false;
    } catch (error) {
      console.warn('Error checking page changes:', error);
      return false;
    }
  }

  checkNFLUpdates() {
    try {
      console.log('PlaySense: Starting NFL check...');

      // Multiple selectors to find game data containers
      const gameContainers = [
        document.querySelector('.contentItem__content.overflow-hidden.contentItem__content--gameStory.flex'),
        document.querySelector('[data-module="Gamecast"]'),
        document.querySelector('.Gamecast'),
        document.querySelector('.live-game'),
        document.querySelector('[data-testid="gamecast"]'),
        document.querySelector('.ScoreCell'),
        document.querySelector('.Scoreboard')
      ].filter(Boolean);

      if (gameContainers.length === 0) {
        console.log('No game containers found, trying broader search...');
        // Fallback: search the entire page for game-related content
        this.checkNFLUpdatesFallback();
        return;
      }

      console.log(`Found ${gameContainers.length} game container(s)`);

      // Check each container for updates
      gameContainers.forEach((container, index) => {
        this.checkNFLContainer(container, index);
      });

    } catch (error) {
      console.log('Error checking NFL updates:', error);
    }
  }

  checkNFLContainer(container, containerIndex) {
    try {
      // Look for team names and scores
      const teamElements = container.querySelectorAll('[class*="team"], [class*="Team"], [class*="score"], [class*="Score"]');
      const scoreElements = container.querySelectorAll('*');

      let teamScores = [];
      let teamNames = [];

      // Extract team names
      teamElements.forEach(el => {
        const text = el.textContent.trim();
        if (text.length > 2 && text.length < 20 && !/^\d+$/.test(text)) {
          teamNames.push(text);
        }
      });

      // Extract scores
      scoreElements.forEach(el => {
        const text = el.textContent.trim();
        if (/^\d{1,2}$/.test(text) && parseInt(text) >= 0 && parseInt(text) <= 99) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 10 && rect.height > 10) {
            teamScores.push(text);
          }
        }
      });

      // Check for score changes
      if (teamScores.length >= 2) {
        const currentScore = teamScores.slice(0, 2).join(' - ');
        const scoreKey = `score_${containerIndex}`;
        if (this.previousGameState[scoreKey] !== currentScore) {
          console.log(`Score changed in container ${containerIndex}:`, currentScore);
          this.previousGameState[scoreKey] = currentScore;
          const teamInfo = teamNames.length >= 2 ? ` (${teamNames[0]} vs ${teamNames[1]})` : '';
          this.addEvent('Score Update', `Score: ${currentScore}${teamInfo}`);
        }
      }

      // Look for play-by-play updates
      this.checkNFLPlays(container, containerIndex);

    } catch (error) {
      console.log(`Error checking container ${containerIndex}:`, error);
    }
  }

  checkNFLPlays(container, containerIndex) {
    try {
      // Look for play-by-play elements
      const playSelectors = [
        '[class*="play"]',
        '[class*="Play"]',
        '[class*="event"]',
        '[class*="Event"]',
        '[class*="update"]',
        '[class*="Update"]',
        '[data-testid*="play"]',
        '[data-testid*="event"]'
      ];

      let playElements = [];
      playSelectors.forEach(selector => {
        playElements.push(...container.querySelectorAll(selector));
      });

      // Also check all text elements for play descriptions
      const allTextElements = container.querySelectorAll('*');

      let recentPlays = [];

      // Check play elements first
      playElements.forEach(el => {
        const text = el.textContent.trim();
        if (this.isNFLPlay(text)) {
          recentPlays.push({
            element: el,
            text: text,
            position: el.getBoundingClientRect().top,
            timestamp: Date.now()
          });
        }
      });

      // Check all text elements for play descriptions
      allTextElements.forEach(el => {
        const text = el.textContent.trim();
        if (this.isNFLPlay(text) && text.length > 20 && text.length < 500) {
          recentPlays.push({
            element: el,
            text: text,
            position: el.getBoundingClientRect().top,
            timestamp: Date.now()
          });
        }
      });

      // Sort by position and timestamp
      recentPlays.sort((a, b) => {
        if (a.position !== b.position) {
          return a.position - b.position;
        }
        return b.timestamp - a.timestamp;
      });

      // Check for new plays
      if (recentPlays.length > 0) {
        const latestPlay = recentPlays[0].text;
        const playKey = `lastPlay_${containerIndex}`;

        if (this.previousGameState[playKey] !== latestPlay) {
          console.log(`New play detected in container ${containerIndex}:`, latestPlay);
          this.previousGameState[playKey] = latestPlay;
          const explanation = this.explainNFLPlay(latestPlay);
          this.addEvent('NFL Play', explanation);
        }
      }

    } catch (error) {
      console.log(`Error checking plays in container ${containerIndex}:`, error);
    }
  }

  isNFLPlay(text) {
    const lowerText = text.toLowerCase();

    // Check for play keywords
    const hasPlayEvent = lowerText.includes('penalty') ||
      lowerText.includes('field goal') ||
      lowerText.includes('touchdown') ||
      lowerText.includes('interception') ||
      lowerText.includes('fumble') ||
      lowerText.includes('sack') ||
      lowerText.includes('pass') ||
      lowerText.includes('run') ||
      lowerText.includes('tackle') ||
      lowerText.includes('incomplete') ||
      lowerText.includes('complete') ||
      lowerText.includes('rush') ||
      lowerText.includes('punt') ||
      lowerText.includes('kickoff') ||
      lowerText.includes('return');

    // Check for game context indicators
    const hasGameContext = lowerText.includes('yard') ||
      lowerText.includes('down') ||
      lowerText.match(/\d+:\d+/) || // time format
      lowerText.match(/\d+\s*(st|nd|rd|th)/) || // downs
      lowerText.match(/\d+nd\s+and\s+\d+/) || // down and distance
      lowerText.includes('quarter') ||
      lowerText.includes('timeout') ||
      lowerText.includes('challenge');

    return hasPlayEvent && hasGameContext;
  }

  checkNFLUpdatesFallback() {
    try {
      console.log('Using fallback NFL detection...');

      // Look for any elements that might contain game data
      const allElements = document.querySelectorAll('*');
      let gameData = [];

      allElements.forEach(el => {
        const text = el.textContent.trim();
        if (this.isNFLPlay(text) && text.length > 20 && text.length < 500) {
          gameData.push({
            element: el,
            text: text,
            position: el.getBoundingClientRect().top,
            timestamp: Date.now()
          });
        }
      });

      // Sort by position
      gameData.sort((a, b) => a.position - b.position);

      // Check for new plays
      if (gameData.length > 0) {
        const latestPlay = gameData[0].text;
        if (this.previousGameState.fallbackPlay !== latestPlay) {
          console.log('New play detected (fallback):', latestPlay);
          this.previousGameState.fallbackPlay = latestPlay;
          const explanation = this.explainNFLPlay(latestPlay);
          this.addEvent('NFL Play', explanation);
        }
      }

    } catch (error) {
      console.log('Error in fallback NFL check:', error);
    }
  }

  checkMLBUpdates() {
    try {
      console.log('PlaySense: Starting MLB check...');

      // Multiple selectors to find MLB game data
      const gameContainers = [
        document.querySelector('[data-module="Gamecast"]'),
        document.querySelector('.Gamecast'),
        document.querySelector('.live-game'),
        document.querySelector('[data-testid="gamecast"]'),
        document.querySelector('.ScoreCell'),
        document.querySelector('.Scoreboard'),
        document.querySelector('[class*="baseball"]'),
        document.querySelector('[class*="mlb"]')
      ].filter(Boolean);

      if (gameContainers.length === 0) {
        console.log('No MLB containers found, trying broader search...');
        this.checkMLBUpdatesFallback();
        return;
      }

      console.log(`Found ${gameContainers.length} MLB container(s)`);

      // Check each container for updates
      gameContainers.forEach((container, index) => {
        this.checkMLBContainer(container, index);
      });

    } catch (error) {
      console.log('Error checking MLB updates:', error);
    }
  }

  checkMLBContainer(container, containerIndex) {
    try {
      // Look for inning information
      const inningSelectors = [
        '.inning', '.Inning', '[data-testid="inning"]',
        '[class*="inning"]', '[class*="Inning"]',
        '[class*="top"]', '[class*="bottom"]'
      ];

      let inningElement = null;
      inningSelectors.forEach(selector => {
        if (!inningElement) {
          inningElement = container.querySelector(selector);
        }
      });

      if (inningElement) {
        const currentInning = inningElement.textContent.trim();
        const inningKey = `inning_${containerIndex}`;
        if (this.previousGameState[inningKey] !== currentInning) {
          console.log(`Inning changed in container ${containerIndex}:`, currentInning);
          this.previousGameState[inningKey] = currentInning;
          this.addEvent('MLB Inning', this.explainMLBInning(currentInning));
        }
      }

      // Look for score changes
      this.checkMLBScores(container, containerIndex);

      // Look for play-by-play updates
      this.checkMLBPlays(container, containerIndex);

    } catch (error) {
      console.log(`Error checking MLB container ${containerIndex}:`, error);
    }
  }

  checkMLBScores(container, containerIndex) {
    try {
      const scoreSelectors = [
        '.score', '.runs', '[class*="score"]', '[class*="runs"]',
        '[class*="Score"]', '[class*="Runs"]'
      ];

      let scoreElements = [];
      scoreSelectors.forEach(selector => {
        scoreElements.push(...container.querySelectorAll(selector));
      });

      let totalRuns = 0;
      let teamScores = [];

      scoreElements.forEach(el => {
        const text = el.textContent.trim();
        const runs = parseInt(text);
        if (!isNaN(runs) && runs >= 0 && runs <= 50) {
          teamScores.push(runs);
          totalRuns += runs;
        }
      });

      const scoreKey = `totalRuns_${containerIndex}`;
      if (this.previousGameState[scoreKey] !== totalRuns && totalRuns > 0) {
        console.log(`Score changed in container ${containerIndex}:`, totalRuns);
        this.previousGameState[scoreKey] = totalRuns;
        const scoreText = teamScores.length >= 2 ?
          `Score: ${teamScores[0]} - ${teamScores[1]}` :
          `Total runs: ${totalRuns}`;
        this.addEvent('MLB Score', scoreText);
      }

    } catch (error) {
      console.log(`Error checking MLB scores in container ${containerIndex}:`, error);
    }
  }

  checkMLBPlays(container, containerIndex) {
    try {
      const playSelectors = [
        '[class*="play"]', '[class*="Play"]',
        '[class*="event"]', '[class*="Event"]',
        '[class*="update"]', '[class*="Update"]',
        '[data-testid*="play"]', '[data-testid*="event"]'
      ];

      let playElements = [];
      playSelectors.forEach(selector => {
        playElements.push(...container.querySelectorAll(selector));
      });

      let recentPlays = [];

      playElements.forEach(el => {
        const text = el.textContent.trim();
        if (this.isMLBPlay(text)) {
          recentPlays.push({
            element: el,
            text: text,
            position: el.getBoundingClientRect().top,
            timestamp: Date.now()
          });
        }
      });

      // Also check all text elements
      const allTextElements = container.querySelectorAll('*');
      allTextElements.forEach(el => {
        const text = el.textContent.trim();
        if (this.isMLBPlay(text) && text.length > 20 && text.length < 500) {
          recentPlays.push({
            element: el,
            text: text,
            position: el.getBoundingClientRect().top,
            timestamp: Date.now()
          });
        }
      });

      // Sort by position and timestamp
      recentPlays.sort((a, b) => {
        if (a.position !== b.position) {
          return a.position - b.position;
        }
        return b.timestamp - a.timestamp;
      });

      // Check for new plays
      if (recentPlays.length > 0) {
        const latestPlay = recentPlays[0].text;
        const playKey = `lastPlay_${containerIndex}`;

        if (this.previousGameState[playKey] !== latestPlay) {
          console.log(`New MLB play detected in container ${containerIndex}:`, latestPlay);
          this.previousGameState[playKey] = latestPlay;
          const explanation = this.explainMLBPlay(latestPlay);
          this.addEvent('MLB Play', explanation);
        }
      }

    } catch (error) {
      console.log(`Error checking MLB plays in container ${containerIndex}:`, error);
    }
  }

  isMLBPlay(text) {
    const lowerText = text.toLowerCase();

    // Check for MLB play keywords
    const hasPlayEvent = lowerText.includes('home run') ||
      lowerText.includes('strikeout') ||
      lowerText.includes('hit') ||
      lowerText.includes('run') ||
      lowerText.includes('out') ||
      lowerText.includes('walk') ||
      lowerText.includes('single') ||
      lowerText.includes('double') ||
      lowerText.includes('triple') ||
      lowerText.includes('steal') ||
      lowerText.includes('error') ||
      lowerText.includes('wild pitch') ||
      lowerText.includes('balk') ||
      lowerText.includes('sacrifice') ||
      lowerText.includes('fly out') ||
      lowerText.includes('ground out');

    // Check for game context indicators
    const hasGameContext = lowerText.includes('inning') ||
      lowerText.includes('base') ||
      lowerText.includes('strike') ||
      lowerText.includes('ball') ||
      lowerText.includes('out') ||
      lowerText.includes('count') ||
      lowerText.match(/\d+-\d+/) || // score format
      lowerText.includes('top') ||
      lowerText.includes('bottom');

    return hasPlayEvent && hasGameContext;
  }

  explainMLBPlay(playText) {
    const text = playText.toLowerCase();

    if (text.includes('home run')) {
      return 'HOME RUN! The batter hit the ball out of the park and scored a run!';
    } else if (text.includes('strikeout')) {
      return 'Strikeout! The batter got 3 strikes and is out!';
    } else if (text.includes('hit') && text.includes('run')) {
      return 'Hit and run! The batter got a hit and a runner scored!';
    } else if (text.includes('walk')) {
      return 'Walk! The pitcher threw 4 balls, so the batter gets to go to first base!';
    } else if (text.includes('error')) {
      return 'Error! A fielder made a mistake, so the batter gets to reach base!';
    } else {
      return `Play update: ${playText}`;
    }
  }

  checkMLBUpdatesFallback() {
    try {
      console.log('Using fallback MLB detection...');

      const allElements = document.querySelectorAll('*');
      let gameData = [];

      allElements.forEach(el => {
        const text = el.textContent.trim();
        if (this.isMLBPlay(text) && text.length > 20 && text.length < 500) {
          gameData.push({
            element: el,
            text: text,
            position: el.getBoundingClientRect().top,
            timestamp: Date.now()
          });
        }
      });

      gameData.sort((a, b) => a.position - b.position);

      if (gameData.length > 0) {
        const latestPlay = gameData[0].text;
        if (this.previousGameState.fallbackMLBPlay !== latestPlay) {
          console.log('New MLB play detected (fallback):', latestPlay);
          this.previousGameState.fallbackMLBPlay = latestPlay;
          const explanation = this.explainMLBPlay(latestPlay);
          this.addEvent('MLB Play', explanation);
        }
      }

    } catch (error) {
      console.log('Error in fallback MLB check:', error);
    }
  }

  checkF1Updates() {
    try {
      console.log('PlaySense: Starting F1 check...');

      // Multiple selectors to find F1 race data
      const raceContainers = [
        document.querySelector('[data-module="Gamecast"]'),
        document.querySelector('.Gamecast'),
        document.querySelector('.live-race'),
        document.querySelector('[data-testid="gamecast"]'),
        document.querySelector('[class*="f1"]'),
        document.querySelector('[class*="formula"]'),
        document.querySelector('[class*="race"]'),
        document.querySelector('[class*="Race"]')
      ].filter(Boolean);

      if (raceContainers.length === 0) {
        console.log('No F1 containers found, trying broader search...');
        this.checkF1UpdatesFallback();
        return;
      }

      console.log(`Found ${raceContainers.length} F1 container(s)`);

      // Check each container for updates
      raceContainers.forEach((container, index) => {
        this.checkF1Container(container, index);
      });

    } catch (error) {
      console.log('Error checking F1 updates:', error);
    }
  }

  checkF1Container(container, containerIndex) {
    try {
      // Look for position changes
      this.checkF1Positions(container, containerIndex);

      // Look for lap times
      this.checkF1LapTimes(container, containerIndex);

      // Look for race events
      this.checkF1Events(container, containerIndex);

    } catch (error) {
      console.log(`Error checking F1 container ${containerIndex}:`, error);
    }
  }

  checkF1Positions(container, containerIndex) {
    try {
      const positionSelectors = [
        '.driver-position', '.Position', '[data-testid="position"]',
        '[class*="position"]', '[class*="Position"]',
        '[class*="driver"]', '[class*="Driver"]'
      ];

      const driverSelectors = [
        '.driver-name', '.Driver', '[data-testid="driver"]',
        '[class*="name"]', '[class*="Name"]'
      ];

      let positionElements = [];
      let driverElements = [];

      positionSelectors.forEach(selector => {
        positionElements.push(...container.querySelectorAll(selector));
      });

      driverSelectors.forEach(selector => {
        driverElements.push(...container.querySelectorAll(selector));
      });

      let currentPositions = [];

      // Try to match positions with drivers
      positionElements.forEach((pos, index) => {
        const driverEl = driverElements[index] || driverElements[0];
        if (pos && driverEl) {
          const position = pos.textContent.trim();
          const driver = driverEl.textContent.trim();
          if (position && driver && position.length <= 3) {
            currentPositions.push(`${position}: ${driver}`);
          }
        }
      });

      const positionString = currentPositions.join('|');
      const positionKey = `positions_${containerIndex}`;

      if (this.previousGameState[positionKey] !== positionString && positionString) {
        console.log(`Position changed in container ${containerIndex}:`, positionString);
        this.previousGameState[positionKey] = positionString;

        // Check for position changes
        const changes = this.detectF1PositionChanges(this.previousGameState[`oldPositions_${containerIndex}`], positionString);
        if (changes.length > 0) {
          changes.forEach(change => this.addEvent('F1 Position', change));
        }
        this.previousGameState[`oldPositions_${containerIndex}`] = positionString;
      }

    } catch (error) {
      console.log(`Error checking F1 positions in container ${containerIndex}:`, error);
    }
  }

  checkF1LapTimes(container, containerIndex) {
    try {
      const lapTimeSelectors = [
        '[class*="lap"]', '[class*="Lap"]',
        '[class*="time"]', '[class*="Time"]',
        '[data-testid*="lap"]', '[data-testid*="time"]'
      ];

      let lapTimeElements = [];
      lapTimeSelectors.forEach(selector => {
        lapTimeElements.push(...container.querySelectorAll(selector));
      });

      let lapTimes = [];

      lapTimeElements.forEach(el => {
        const text = el.textContent.trim();
        // Look for lap time format (e.g., "1:23.456" or "23.456")
        if (text.match(/\d+:\d+\.\d+/) || text.match(/\d+\.\d+/)) {
          lapTimes.push(text);
        }
      });

      if (lapTimes.length > 0) {
        const lapTimeKey = `lapTimes_${containerIndex}`;
        const currentLapTimes = lapTimes.join('|');

        if (this.previousGameState[lapTimeKey] !== currentLapTimes) {
          console.log(`Lap times updated in container ${containerIndex}:`, currentLapTimes);
          this.previousGameState[lapTimeKey] = currentLapTimes;
          this.addEvent('F1 Lap Time', `New lap times: ${lapTimes.slice(0, 3).join(', ')}`);
        }
      }

    } catch (error) {
      console.log(`Error checking F1 lap times in container ${containerIndex}:`, error);
    }
  }

  checkF1Events(container, containerIndex) {
    try {
      const eventSelectors = [
        '[class*="event"]', '[class*="Event"]',
        '[class*="update"]', '[class*="Update"]',
        '[class*="incident"]', '[class*="Incident"]',
        '[data-testid*="event"]', '[data-testid*="incident"]'
      ];

      let eventElements = [];
      eventSelectors.forEach(selector => {
        eventElements.push(...container.querySelectorAll(selector));
      });

      let recentEvents = [];

      eventElements.forEach(el => {
        const text = el.textContent.trim();
        if (this.isF1Event(text)) {
          recentEvents.push({
            element: el,
            text: text,
            position: el.getBoundingClientRect().top,
            timestamp: Date.now()
          });
        }
      });

      // Also check all text elements
      const allTextElements = container.querySelectorAll('*');
      allTextElements.forEach(el => {
        const text = el.textContent.trim();
        if (this.isF1Event(text) && text.length > 20 && text.length < 500) {
          recentEvents.push({
            element: el,
            text: text,
            position: el.getBoundingClientRect().top,
            timestamp: Date.now()
          });
        }
      });

      // Sort by position and timestamp
      recentEvents.sort((a, b) => {
        if (a.position !== b.position) {
          return a.position - b.position;
        }
        return b.timestamp - a.timestamp;
      });

      // Check for new events
      if (recentEvents.length > 0) {
        const latestEvent = recentEvents[0].text;
        const eventKey = `lastEvent_${containerIndex}`;

        if (this.previousGameState[eventKey] !== latestEvent) {
          console.log(`New F1 event detected in container ${containerIndex}:`, latestEvent);
          this.previousGameState[eventKey] = latestEvent;
          const explanation = this.explainF1Event(latestEvent);
          this.addEvent('F1 Event', explanation);
        }
      }

    } catch (error) {
      console.log(`Error checking F1 events in container ${containerIndex}:`, error);
    }
  }

  isF1Event(text) {
    const lowerText = text.toLowerCase();

    // Check for F1 event keywords
    const hasEvent = lowerText.includes('overtake') ||
      lowerText.includes('overtaking') ||
      lowerText.includes('crash') ||
      lowerText.includes('accident') ||
      lowerText.includes('safety car') ||
      lowerText.includes('yellow flag') ||
      lowerText.includes('red flag') ||
      lowerText.includes('pit stop') ||
      lowerText.includes('pitstop') ||
      lowerText.includes('penalty') ||
      lowerText.includes('retirement') ||
      lowerText.includes('dnf') ||
      lowerText.includes('fastest lap') ||
      lowerText.includes('lap record') ||
      lowerText.includes('spin') ||
      lowerText.includes('collision');

    // Check for F1 context indicators
    const hasContext = lowerText.includes('lap') ||
      lowerText.includes('position') ||
      lowerText.includes('driver') ||
      lowerText.includes('race') ||
      lowerText.includes('sector') ||
      lowerText.includes('corner') ||
      lowerText.match(/\d+:\d+/) || // time format
      lowerText.match(/\d+\.\d+/) || // lap time format
      lowerText.includes('turn') ||
      lowerText.includes('straight');

    return hasEvent && hasContext;
  }

  explainF1Event(eventText) {
    const text = eventText.toLowerCase();

    if (text.includes('overtake') || text.includes('overtaking')) {
      return 'Overtake! One driver passed another driver to gain a position!';
    } else if (text.includes('crash') || text.includes('accident')) {
      return 'Crash! A driver had an accident and may be out of the race!';
    } else if (text.includes('safety car')) {
      return 'Safety Car! The race is slowed down due to an incident on track!';
    } else if (text.includes('pit stop')) {
      return 'Pit Stop! A driver came in to change tires and refuel!';
    } else if (text.includes('penalty')) {
      return 'Penalty! A driver received a penalty for breaking the rules!';
    } else if (text.includes('fastest lap')) {
      return 'Fastest Lap! A driver set the quickest lap time of the race!';
    } else {
      return `Race update: ${eventText}`;
    }
  }

  checkF1UpdatesFallback() {
    try {
      console.log('Using fallback F1 detection...');

      const allElements = document.querySelectorAll('*');
      let raceData = [];

      allElements.forEach(el => {
        const text = el.textContent.trim();
        if (this.isF1Event(text) && text.length > 20 && text.length < 500) {
          raceData.push({
            element: el,
            text: text,
            position: el.getBoundingClientRect().top,
            timestamp: Date.now()
          });
        }
      });

      raceData.sort((a, b) => a.position - b.position);

      if (raceData.length > 0) {
        const latestEvent = raceData[0].text;
        if (this.previousGameState.fallbackF1Event !== latestEvent) {
          console.log('New F1 event detected (fallback):', latestEvent);
          this.previousGameState.fallbackF1Event = latestEvent;
          const explanation = this.explainF1Event(latestEvent);
          this.addEvent('F1 Event', explanation);
        }
      }

    } catch (error) {
      console.log('Error in fallback F1 check:', error);
    }
  }

  explainNFLPlay(playText) {
    const text = playText.toLowerCase();

    if (text.includes('touchdown')) {
      return 'TOUCHDOWN! A player reached the end zone and scored 6 points for their team!';
    } else if (text.includes('field goal')) {
      return 'Field Goal! The kicker scored 3 points by kicking the ball through the goalposts!';
    } else if (text.includes('interception')) {
      return 'Interception! The defense caught a pass meant for the offense and took control of the ball!';
    } else if (text.includes('fumble')) {
      return 'Fumble! A player dropped the ball and the other team might recover it!';
    } else if (text.includes('penalty')) {
      return 'Penalty! A rule was broken, so the referee is giving yards to one team as punishment!';
    } else if (text.includes('sack')) {
      return 'Sack! The quarterback was tackled behind the line before he could throw the ball!';
    } else {
      return `Play update: ${playText}`;
    }
  }

  explainMLBInning(inning) {
    const inningNum = inning.match(/\d+/);
    const topBottom = inning.toLowerCase().includes('top') ? 'top' : 'bottom';

    if (topBottom === 'top') {
      return `Top of inning ${inningNum ? inningNum[0] : ''}! The visiting team is now batting (trying to score).`;
    } else {
      return `Bottom of inning ${inningNum ? inningNum[0] : ''}! The home team is now batting (trying to score).`;
    }
  }

  detectF1PositionChanges(oldPositions, newPositions) {
    if (!oldPositions) return [];

    const changes = [];
    // Simple position change detection - in a real implementation, 
    // this would be more sophisticated
    if (oldPositions !== newPositions) {
      changes.push('Position changes detected! Drivers are overtaking each other!');
    }
    return changes;
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
        id: this.generateEventId()
      };

      // Check for duplicate events (prevent spam)
      if (this.isDuplicateEvent(event)) {
        console.log('Duplicate event detected, skipping:', event);
        return;
      }

      this.eventLog.push(event);

      // Keep only last 50 events (increased from 20)
      if (this.eventLog.length > 50) {
        this.eventLog = this.eventLog.slice(-50);
      }

      this.updateOverlay(sanitizedDescription);
      this.updateLog();

      // Log successful event addition
      console.log('Event added:', event);
    } catch (error) {
      this.handleError('AddEvent', error);
    }
  }

  sanitizeString(input, fieldName) {
    if (!input || typeof input !== 'string') {
      console.warn(`Invalid ${fieldName}:`, input);
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

  generateEventId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  isDuplicateEvent(newEvent) {
    if (this.eventLog.length === 0) return false;

    const recentEvents = this.eventLog.slice(-5); // Check last 5 events
    return recentEvents.some(event =>
      event.type === newEvent.type &&
      event.description === newEvent.description &&
      (Date.now() - parseInt(event.id, 36)) < 5000 // Within 5 seconds
    );
  }

  updateOverlay(message) {
    const content = document.getElementById('understand-game-current');
    if (content) {
      content.textContent = message;
    }
  }

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

  toggleLog() {
    const logElement = document.getElementById('understand-game-log');
    const currentElement = document.getElementById('understand-game-current');

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
console.log('PlaySense: Content script loaded');
console.log('Current URL:', window.location.href);
console.log('Document ready state:', document.readyState);

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
    console.log('PlaySense: Initializing extension...');
    window.PlaySenseInstance = new PlaySense();
    console.log('PlaySense: Extension initialized successfully');
  } catch (error) {
    console.error('PlaySense: Failed to initialize:', error);

    // Retry initialization after a delay (only once)
    if (!window.PlaySenseRetryAttempted) {
      window.PlaySenseRetryAttempted = true;
      setTimeout(() => {
        try {
          console.log('PlaySense: Retrying initialization...');
          window.PlaySenseInstance = new PlaySense();
        } catch (retryError) {
          console.error('PlaySense: Retry failed:', retryError);
        }
      }, 2000);
    }
  }
}

if (document.readyState === 'loading') {
  console.log('PlaySense: Waiting for DOMContentLoaded');
  document.addEventListener('DOMContentLoaded', () => {
    console.log('PlaySense: DOMContentLoaded fired, initializing...');
    initializeExtension();
  });
} else {
  console.log('PlaySense: DOM already loaded, initializing immediately...');
  initializeExtension();
}