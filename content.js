// Content script for UnderstandThisGame extension
class UnderstandThisGame {
  constructor() {
    console.log('UnderstandThisGame: Constructor called');
    this.isActive = false;
    this.gameType = null;
    this.lastUpdate = null;
    this.eventLog = [];
    this.overlay = null;
    this.checkInterval = null;
    this.previousGameState = {};

    console.log('UnderstandThisGame: Initializing...');
    this.init();
    console.log('UnderstandThisGame: Initialization complete');
  }

  init() {
    this.createOverlay();
    this.detectGameType();

    // Re-detect game type periodically in case page content changes
    this.gameTypeInterval = setInterval(() => {
      const previousGameType = this.gameType;
      this.detectGameType();

      // If game type changed, log it
      if (previousGameType !== this.gameType) {
        console.log(`Game type changed from ${previousGameType} to ${this.gameType}`);
        this.addEvent('System', `Game type changed to ${this.gameType ? this.gameType.toUpperCase() : 'Unknown'}`);
      }
    }, 10000); // Check every 10 seconds

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'toggle') {
        this.toggle();
      } else if (request.action === 'getStatus') {
        sendResponse({
          isActive: this.isActive,
          gameType: this.gameType,
          eventCount: this.eventLog.length
        });
      } else if (request.action === 'showOverlay') {
        this.showOverlay();
      } else if (request.action === 'hideOverlay') {
        this.hideOverlay();
      }
    });
  }

  createOverlay() {
    // Remove any existing overlay first
    const existingOverlay = document.getElementById('understand-game-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }

    this.overlay = document.createElement('div');
    this.overlay.id = 'understand-game-overlay';

    // Create elements manually instead of innerHTML for better event handling
    const header = document.createElement('div');
    header.id = 'understand-game-header';

    const title = document.createElement('span');
    title.textContent = 'UnderstandThisGame';

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'header-buttons';

    // Create toggle log button
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'understand-game-toggle-log';
    toggleBtn.textContent = '📋';
    toggleBtn.onclick = () => {
      console.log('Toggle button clicked');
      this.toggleLog();
    };

    // Create minimize button
    const minimizeBtn = document.createElement('button');
    minimizeBtn.id = 'understand-game-minimize';
    minimizeBtn.textContent = '−';
    minimizeBtn.onclick = () => {
      console.log('Minimize button clicked');
      this.overlay.classList.toggle('minimized');
    };

    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.id = 'understand-game-close';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => {
      console.log('Close button clicked');
      this.hideOverlay();
    };

    buttonContainer.appendChild(toggleBtn);
    buttonContainer.appendChild(minimizeBtn);
    buttonContainer.appendChild(closeBtn);

    header.appendChild(title);
    header.appendChild(buttonContainer);

    // Create content area
    const content = document.createElement('div');
    content.id = 'understand-game-content';

    const current = document.createElement('div');
    current.id = 'understand-game-current';
    current.textContent = 'Extension loaded! Click the extension icon to start.';

    const log = document.createElement('div');
    log.id = 'understand-game-log';
    log.style.display = 'none';

    content.appendChild(current);
    content.appendChild(log);

    this.overlay.appendChild(header);
    this.overlay.appendChild(content);

    // Make sure overlay is visible
    this.overlay.style.display = 'block';
    this.overlay.style.visibility = 'visible';
    this.overlay.style.opacity = '1';

    // Append to body and log for debugging
    document.body.appendChild(this.overlay);
    console.log('UnderstandThisGame: Overlay created and added to page');

    // Make header draggable
    this.makeDraggable();

    // Test if overlay is actually visible
    setTimeout(() => {
      const overlayCheck = document.getElementById('understand-game-overlay');
      if (overlayCheck) {
        console.log('UnderstandThisGame: Overlay confirmed on page');
        console.log('Overlay position:', overlayCheck.getBoundingClientRect());
      } else {
        console.error('UnderstandThisGame: Overlay not found after creation!');
      }
    }, 100);
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
    console.log('hideOverlay() called');
    if (this.overlay) {
      console.log('Overlay exists, hiding...');
      console.log('Current overlay styles:', {
        display: this.overlay.style.display,
        visibility: this.overlay.style.visibility,
        opacity: this.overlay.style.opacity
      });

      // Add a fade-out animation
      this.overlay.style.transition = 'opacity 0.3s ease-out';
      this.overlay.style.opacity = '0';

      // Hide after animation completes
      setTimeout(() => {
        if (this.overlay) {
          this.overlay.style.display = 'none';
          this.overlay.style.visibility = 'hidden';
          console.log('Overlay hidden successfully');
        }
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
    const url = window.location.href;
    const pageContent = document.body.innerText.toLowerCase();

    // Enhanced game type detection with scoring system
    const gameScores = {
      nfl: this.getNFLScore(url, pageContent),
      mlb: this.getMLBScore(url, pageContent),
      f1: this.getF1Score(url, pageContent)
    };

    // Find the game type with the highest score
    const maxScore = Math.max(...Object.values(gameScores));

    // Only detect a game if the score is above a minimum threshold
    const minThreshold = 5;

    if (maxScore >= minThreshold) {
      this.gameType = Object.keys(gameScores).find(key => gameScores[key] === maxScore);
    } else {
      this.gameType = null;
    }

    console.log('Game detection scores:', gameScores);
    console.log('Detected game type:', this.gameType);
    console.log('Current URL:', url);
    console.log('Page content sample:', pageContent.substring(0, 200) + '...');

    this.updateOverlay(`Detected: ${this.gameType ? this.gameType.toUpperCase() : 'No supported game'}`);

    if (this.gameType) {
      this.addEvent('System', `Ready to monitor ${this.gameType.toUpperCase()} game`);
    }
  }

  getNFLScore(url, pageContent) {
    let score = 0;
    const lowerUrl = url.toLowerCase();

    // URL patterns for NFL (higher weight)
    const nflUrlPatterns = [
      { pattern: '/nfl/', weight: 10 },
      { pattern: 'nfl.com', weight: 10 },
      { pattern: 'nflgame', weight: 8 },
      { pattern: 'nfl-live', weight: 8 },
      { pattern: '/football/', weight: 5 },
      { pattern: 'nfl-football', weight: 6 }
    ];

    nflUrlPatterns.forEach(({ pattern, weight }) => {
      if (lowerUrl.includes(pattern)) {
        score += weight;
      }
    });

    // Content patterns for NFL (more specific terms)
    const nflContentPatterns = [
      { pattern: 'touchdown', weight: 8 },
      { pattern: 'field goal', weight: 8 },
      { pattern: 'quarterback', weight: 7 },
      { pattern: 'running back', weight: 7 },
      { pattern: 'yard line', weight: 6 },
      { pattern: 'first down', weight: 6 },
      { pattern: 'second down', weight: 6 },
      { pattern: 'third down', weight: 6 },
      { pattern: 'fourth down', weight: 6 },
      { pattern: 'interception', weight: 7 },
      { pattern: 'fumble', weight: 7 },
      { pattern: 'sack', weight: 6 },
      { pattern: 'punt', weight: 6 },
      { pattern: 'kickoff', weight: 6 },
      { pattern: 'end zone', weight: 7 },
      { pattern: 'goal line', weight: 6 },
      { pattern: 'extra point', weight: 6 },
      { pattern: 'two point conversion', weight: 6 },
      { pattern: 'nfl', weight: 3 }, // Lower weight for generic term
      { pattern: 'football', weight: 2 } // Lower weight for generic term
    ];

    nflContentPatterns.forEach(({ pattern, weight }) => {
      if (pageContent.includes(pattern)) {
        score += weight;
      }
    });

    return score;
  }

  getMLBScore(url, pageContent) {
    let score = 0;
    const lowerUrl = url.toLowerCase();

    // URL patterns for MLB (higher weight)
    const mlbUrlPatterns = [
      { pattern: '/mlb/', weight: 10 },
      { pattern: 'mlb.com', weight: 10 },
      { pattern: 'mlbgame', weight: 8 },
      { pattern: 'mlb-live', weight: 8 },
      { pattern: '/baseball/', weight: 5 },
      { pattern: 'mlb-baseball', weight: 6 }
    ];

    mlbUrlPatterns.forEach(({ pattern, weight }) => {
      if (lowerUrl.includes(pattern)) {
        score += weight;
      }
    });

    // Content patterns for MLB (more specific terms)
    const mlbContentPatterns = [
      { pattern: 'home run', weight: 8 },
      { pattern: 'strikeout', weight: 7 },
      { pattern: 'inning', weight: 6 },
      { pattern: 'pitcher', weight: 6 },
      { pattern: 'batter', weight: 6 },
      { pattern: 'homerun', weight: 7 },
      { pattern: 'base hit', weight: 6 },
      { pattern: 'double play', weight: 7 },
      { pattern: 'triple play', weight: 7 },
      { pattern: 'walk', weight: 6 },
      { pattern: 'wild pitch', weight: 6 },
      { pattern: 'balk', weight: 6 },
      { pattern: 'sacrifice', weight: 6 },
      { pattern: 'fly out', weight: 6 },
      { pattern: 'ground out', weight: 6 },
      { pattern: 'strike zone', weight: 6 },
      { pattern: 'mound', weight: 5 },
      { pattern: 'diamond', weight: 5 },
      { pattern: 'mlb', weight: 3 }, // Lower weight for generic term
      { pattern: 'baseball', weight: 2 } // Lower weight for generic term
    ];

    mlbContentPatterns.forEach(({ pattern, weight }) => {
      if (pageContent.includes(pattern)) {
        score += weight;
      }
    });

    return score;
  }

  getF1Score(url, pageContent) {
    let score = 0;
    const lowerUrl = url.toLowerCase();

    // URL patterns for F1 (higher weight)
    const f1UrlPatterns = [
      { pattern: '/f1/', weight: 10 },
      { pattern: 'f1.com', weight: 10 },
      { pattern: 'formula1.com', weight: 10 },
      { pattern: 'f1-live', weight: 8 },
      { pattern: 'formula-1-live', weight: 8 },
      { pattern: '/formula-1/', weight: 8 },
      { pattern: '/formula1/', weight: 8 }
    ];

    f1UrlPatterns.forEach(({ pattern, weight }) => {
      if (lowerUrl.includes(pattern)) {
        score += weight;
      }
    });

    // Content patterns for F1 (more specific terms)
    const f1ContentPatterns = [
      { pattern: 'formula 1', weight: 8 },
      { pattern: 'formula one', weight: 8 },
      { pattern: 'grand prix', weight: 7 },
      { pattern: 'lap time', weight: 6 },
      { pattern: 'qualifying', weight: 6 },
      { pattern: 'overtake', weight: 7 },
      { pattern: 'pit stop', weight: 6 },
      { pattern: 'safety car', weight: 7 },
      { pattern: 'pole position', weight: 6 },
      { pattern: 'fastest lap', weight: 6 },
      { pattern: 'drs', weight: 5 },
      { pattern: 'kers', weight: 5 },
      { pattern: 'championship', weight: 6 },
      { pattern: 'constructors', weight: 6 },
      { pattern: 'grid', weight: 5 },
      { pattern: 'sector', weight: 5 },
      { pattern: 'f1', weight: 3 }, // Lower weight for generic term
      { pattern: 'race', weight: 2 }, // Lower weight for generic term
      { pattern: 'driver', weight: 2 } // Lower weight for generic term
    ];

    f1ContentPatterns.forEach(({ pattern, weight }) => {
      if (pageContent.includes(pattern)) {
        score += weight;
      }
    });

    return score;
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
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.gameTypeInterval) {
      clearInterval(this.gameTypeInterval);
      this.gameTypeInterval = null;
    }
  }

  checkForUpdates() {
    if (!this.isActive) return;

    // Log what we're checking for debugging
    console.log(`UnderstandThisGame: Checking for ${this.gameType} updates...`);
    console.log(`Page URL: ${window.location.href}`);
    console.log(`Page title: ${document.title}`);

    // Count total elements on page for debugging
    const totalElements = document.querySelectorAll('*').length;
    console.log(`Total elements on page: ${totalElements}`);

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
    }

    // Update overlay with timestamp to show it's working
    const now = new Date().toLocaleTimeString();
    if (this.eventLog.length === 0 ||
      this.eventLog[this.eventLog.length - 1].timestamp !== now) {
      // Only update if we haven't updated recently
      this.updateOverlay(`Monitoring... (Last check: ${now})`);
    }
  }

  checkNFLUpdates() {
    try {
      console.log('UnderstandThisGame: Starting NFL check...');

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
      console.log('UnderstandThisGame: Starting MLB check...');

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
      console.log('UnderstandThisGame: Starting F1 check...');

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
    const event = {
      timestamp: new Date().toLocaleTimeString(),
      type: type,
      description: description
    };

    this.eventLog.push(event);

    // Keep only last 20 events
    if (this.eventLog.length > 20) {
      this.eventLog = this.eventLog.slice(-20);
    }

    this.updateOverlay(description);
    this.updateLog();
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

// Initialize when page loads
console.log('UnderstandThisGame: Content script loaded');
console.log('Current URL:', window.location.href);
console.log('Document ready state:', document.readyState);

if (document.readyState === 'loading') {
  console.log('UnderstandThisGame: Waiting for DOMContentLoaded');
  document.addEventListener('DOMContentLoaded', () => {
    console.log('UnderstandThisGame: DOMContentLoaded fired, initializing...');
    new UnderstandThisGame();
  });
} else {
  console.log('UnderstandThisGame: DOM already loaded, initializing immediately...');
  new UnderstandThisGame();
}