// Content script for UnderstandThisGame extension
class UnderstandThisGame {
  constructor() {
    this.isActive = false;
    this.gameType = null;
    this.lastUpdate = null;
    this.eventLog = [];
    this.overlay = null;
    this.checkInterval = null;
    this.previousGameState = {};
    
    this.init();
  }

  init() {
    this.createOverlay();
    this.detectGameType();
    
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
    this.overlay.innerHTML = `
      <div id="understand-game-header">
        <span>UnderstandThisGame</span>
        <button id="understand-game-toggle-log">📋</button>
        <button id="understand-game-minimize">−</button>
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
    
    // Append to body and log for debugging
    document.body.appendChild(this.overlay);
    console.log('UnderstandThisGame: Overlay created and added to page');
    
    // Test if overlay is actually visible
    setTimeout(() => {
      const overlayCheck = document.getElementById('understand-game-overlay');
      if (overlayCheck) {
        console.log('UnderstandThisGame: Overlay confirmed on page');
        console.log('Overlay position:', overlayCheck.getBoundingClientRect());
      } else {
        console.error('UnderstandThisGame: Overlay not found after creation!');
      }
    }, 1000);
    
    // Add event listeners
    document.getElementById('understand-game-toggle-log').addEventListener('click', () => {
      this.toggleLog();
    });
    
    document.getElementById('understand-game-minimize').addEventListener('click', () => {
      this.overlay.classList.toggle('minimized');
    });
  }

  detectGameType() {
    const url = window.location.href;
    const pageContent = document.body.innerText.toLowerCase();
    
    if (url.includes('/nfl/') || pageContent.includes('touchdown') || pageContent.includes('field goal')) {
      this.gameType = 'nfl';
    } else if (url.includes('/mlb/') || pageContent.includes('inning') || pageContent.includes('home run')) {
      this.gameType = 'mlb';
    } else if (url.includes('/f1/') || url.includes('formula') || pageContent.includes('lap time')) {
      this.gameType = 'f1';
    } else {
      this.gameType = null;
    }
    
    this.updateOverlay(`Game detected: ${this.gameType || 'Unknown'}`);
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
    
    // Add demo mode for testing without subscription
    const isDemoMode = window.location.href.includes('demo=true') || !this.hasSubscriptionContent();
    
    if (isDemoMode) {
      this.startDemoMode();
    } else {
      this.checkInterval = setInterval(() => {
        this.checkForUpdates();
      }, 3000); // Check every 3 seconds
    }
  }

  hasSubscriptionContent() {
    // Check if we can access live game content
    const liveElements = document.querySelectorAll('.live-score, .play-by-play, .live-game');
    return liveElements.length > 0;
  }

  startDemoMode() {
    this.updateOverlay('Demo Mode: Simulating game events...');
    
    const demoEvents = this.getDemoEvents();
    let eventIndex = 0;
    
    this.checkInterval = setInterval(() => {
      if (eventIndex < demoEvents.length) {
        const event = demoEvents[eventIndex];
        this.addEvent(event.type, event.description);
        eventIndex++;
      } else {
        // Restart demo
        eventIndex = 0;
      }
    }, 5000); // Show demo event every 5 seconds
  }

  getDemoEvents() {
    switch (this.gameType) {
      case 'nfl':
        return [
          { type: 'NFL Play', description: 'TOUCHDOWN! Patrick Mahomes threw a 25-yard pass to Travis Kelce in the end zone! Kansas City scores 6 points!' },
          { type: 'NFL Play', description: 'Field Goal! The kicker scored 3 points by kicking the ball through the goalposts!' },
          { type: 'NFL Play', description: 'Interception! The defense caught a pass meant for the offense and took control of the ball!' },
          { type: 'NFL Play', description: 'Sack! The quarterback was tackled behind the line before he could throw the ball!' },
        ];
      case 'mlb':
        return [
          { type: 'MLB Score', description: 'HOME RUN! The batter hit the ball out of the park and scored a run!' },
          { type: 'MLB Inning', description: 'Top of inning 7! The visiting team is now batting (trying to score).' },
          { type: 'MLB Play', description: 'Strikeout! The pitcher threw 3 strikes past the batter!' },
          { type: 'MLB Score', description: 'RBI Single! A player got a hit and drove in a teammate to score!' },
        ];
      case 'f1':
        return [
          { type: 'F1 Position', description: 'OVERTAKE! Lewis Hamilton from Mercedes just passed Max Verstappen from Red Bull for 2nd place!' },
          { type: 'F1 Event', description: 'Safety Car deployed! All cars must slow down and follow the safety car due to an incident on track.' },
          { type: 'F1 Position', description: 'Charles Leclerc from Ferrari takes the lead! He\'s now in P1!' },
          { type: 'F1 Event', description: 'Pit Stop! A driver just pulled into the pit lane to change tires - this takes about 3 seconds!' },
        ];
      default:
        return [{ type: 'Demo', description: 'Demo event for testing!' }];
    }
  }

  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  checkForUpdates() {
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
  }

  checkNFLUpdates() {
    try {
      // Look for score changes
      const scoreElements = document.querySelectorAll('.score, .ScoreCell__Score, [data-testid="score"]');
      const playByPlay = document.querySelector('.Gamestrip__Plays, .play-by-play, [data-testid="play-by-play"]');
      
      let currentScore = '';
      scoreElements.forEach(el => currentScore += el.textContent.trim() + ' ');
      
      if (this.previousGameState.score !== currentScore && currentScore) {
        this.previousGameState.score = currentScore;
        this.addEvent('Score Update', `Current score: ${currentScore}`);
      }
      
      // Check for recent plays
      if (playByPlay) {
        const recentPlay = playByPlay.querySelector('.recent-play, .latest-play, [data-testid="recent-play"]');
        if (recentPlay) {
          const playText = recentPlay.textContent.trim();
          if (this.previousGameState.lastPlay !== playText) {
            this.previousGameState.lastPlay = playText;
            const explanation = this.explainNFLPlay(playText);
            this.addEvent('NFL Play', explanation);
          }
        }
      }
      
    } catch (error) {
      console.log('Error checking NFL updates:', error);
    }
  }

  checkMLBUpdates() {
    try {
      // Look for inning changes, runs, etc.
      const inningElement = document.querySelector('.inning, .Inning, [data-testid="inning"]');
      const scoreElements = document.querySelectorAll('.score, .runs');
      
      if (inningElement) {
        const currentInning = inningElement.textContent.trim();
        if (this.previousGameState.inning !== currentInning) {
          this.previousGameState.inning = currentInning;
          this.addEvent('MLB Inning', this.explainMLBInning(currentInning));
        }
      }
      
      let totalRuns = 0;
      scoreElements.forEach(el => {
        const runs = parseInt(el.textContent) || 0;
        totalRuns += runs;
      });
      
      if (this.previousGameState.totalRuns !== totalRuns && totalRuns > 0) {
        this.previousGameState.totalRuns = totalRuns;
        this.addEvent('MLB Score', 'Someone scored a run! The score has changed.');
      }
      
    } catch (error) {
      console.log('Error checking MLB updates:', error);
    }
  }

  checkF1Updates() {
    try {
      // Look for position changes, lap times, etc.
      const positionElements = document.querySelectorAll('.driver-position, .Position, [data-testid="position"]');
      const driverElements = document.querySelectorAll('.driver-name, .Driver, [data-testid="driver"]');
      
      let currentPositions = [];
      positionElements.forEach((pos, index) => {
        const driverEl = driverElements[index];
        if (pos && driverEl) {
          currentPositions.push(`${pos.textContent.trim()}: ${driverEl.textContent.trim()}`);
        }
      });
      
      const positionString = currentPositions.join('|');
      if (this.previousGameState.positions !== positionString && positionString) {
        // Check for position changes
        const changes = this.detectF1PositionChanges(this.previousGameState.positions, positionString);
        if (changes.length > 0) {
          changes.forEach(change => this.addEvent('F1 Position', change));
        }
        this.previousGameState.positions = positionString;
      }
      
    } catch (error) {
      console.log('Error checking F1 updates:', error);
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
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new UnderstandThisGame();
  });
} else {
  new UnderstandThisGame();
}