// Zero cost, no network. Always available as the fallback tier — and for every
// user without an API key it is the ONLY tier, which is why it reads the
// structured fields on the event instead of returning one fixed string per
// keyword. The feeds hand us the player, the yardage, the penalty, the score
// and the period; ignoring all of that made the free tier read as canned.
//
// Two rules hold everywhere in this file:
//   - Never state anything the event does not contain. The event carries
//     score.home and score.away but no team names, so the score is reported as
//     an unattributed pair rather than guessed at.
//   - Never throw. A regex that fails to match degrades to the plain
//     explanation; it must not cost the user the play.

// ESPN writes NFL names as initial-dot-surname with no space: "T.Bass",
// "R.Spears-Jennings". MLB writes plain surnames, sometimes accented or
// suffixed: "Peña", "García Jr.".
const NFL_NAME = String.raw`[A-Z]\.[A-Za-zÀ-ɏ'\-]+`;

const rx = (pattern, flags) => new RegExp(pattern, flags);

// "T.Bass" -> "T. Bass". Leaves anything that is not initial-dot-surname alone.
function readableName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/^([A-Z])\.(?=[A-Za-z])/, '$1. ');
}

// An undefined yardage group means ESPN wrote "for no gain", which is zero.
function yardsOf(group) {
  const n = Number(group);
  return Number.isFinite(n) ? n : 0;
}

function plural(n, word) {
  return `${n} ${word}${Math.abs(n) === 1 ? '' : 's'}`;
}

// Reported without team names because the event has none. "Home" and "away"
// are the only two labels this data actually supports.
function scoreLine(event) {
  const score = event.score;
  if (!score) return '';
  const home = Number(score.home);
  const away = Number(score.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return '';
  return ` Score is now home ${home}, away ${away}.`;
}

function periodLine(event) {
  const period = event.period;
  if (!period || !period.display) return '';
  return ` (${period.display})`;
}

// ---------------------------------------------------------------- NFL

const NFL_PASS = rx(`(${NFL_NAME}) pass (?:short|deep) (?:left|right|middle) to (${NFL_NAME})(?:[^,.]*? for (?:(-?\\d+) yards?|no gain))?`);
const NFL_RUSH = rx(`(${NFL_NAME}) (?:up the middle|(?:left|right) (?:end|tackle|guard)|scrambles)[^,.]*? for (?:(-?\\d+) yards?|no gain)`);
const NFL_FIELD_GOAL = rx(`(${NFL_NAME}) (\\d+) yard field goal is (GOOD|No Good)`, 'i');
const NFL_SACK = rx(`(${NFL_NAME}) sacked at [A-Z]{2,4} \\d+ for (-?\\d+) yards?(?: \\((${NFL_NAME})\\))?`);
const NFL_INTERCEPT = rx(`INTERCEPTED by (${NFL_NAME})`);
const NFL_PENALTY = rx(`PENALTY on ([A-Z]{2,4})(?:-(${NFL_NAME}))?, ([^,]+), (\\d+) yards?`);
const NFL_PUNT = rx(`(${NFL_NAME}) punts (\\d+) yards?`);
const NFL_KICKOFF = rx(`(${NFL_NAME}) kicks (\\d+) yards?`);

function explainNfl(event, t) {
  const text = event.text;

  if (t.includes('touchdown')) {
    const pass = NFL_PASS.exec(text);
    const rush = NFL_RUSH.exec(text);
    let who = '';
    if (pass) {
      const yards = pass[3] != null ? ` from ${plural(yardsOf(pass[3]), 'yard')} out` : '';
      who = `${readableName(pass[1])} threw to ${readableName(pass[2])}${yards}. `;
    } else if (rush) {
      who = `${readableName(rush[1])} ran it in from ${plural(yardsOf(rush[2]), 'yard')} out. `;
    }
    const extra = t.includes('extra point is good')
      ? ' The extra point was good, so 7 in total.'
      : '';
    return `${who}Touchdown — carrying the ball into the end zone is worth 6 points.${extra}${scoreLine(event)}`;
  }

  if (t.includes('two-point conversion') || t.includes('two point conversion')) {
    return 'Two-point conversion attempt. Instead of kicking for 1 extra point after the touchdown, they are trying to reach the end zone again for 2.';
  }
  if (t.includes('extra point') || /\bpat\b/.test(t)) {
    const good = t.includes('is good');
    return `Extra point ${good ? 'good' : 'missed'}. After a touchdown the kicker gets a short free kick worth 1 more point.${good ? scoreLine(event) : ''}`;
  }

  const fg = NFL_FIELD_GOAL.exec(text);
  if (fg) {
    // Exact match, not a substring test: /good/i also matches "No Good", which
    // reported every missed kick as a successful one.
    const good = fg[3].toLowerCase() === 'good';
    return good
      ? `${readableName(fg[1])} kicked a ${fg[2]}-yard field goal. Kicking the ball through the posts is worth 3 points.${scoreLine(event)}`
      : `${readableName(fg[1])} missed a ${fg[2]}-yard field goal, so no points and the other team takes over.`;
  }
  if (t.includes('field goal')) {
    return `Field goal — kicking the ball through the posts, worth 3 points.${scoreLine(event)}`;
  }

  if (t.includes('safety') && !t.includes('safety car') && !t.includes('player safety')) {
    return `Safety. The offense was tackled in its own end zone, which hands the defense 2 points and the ball.${scoreLine(event)}`;
  }

  const pick = NFL_INTERCEPT.exec(text);
  if (pick) {
    return `${readableName(pick[1])} intercepted the pass. The defense caught a throw meant for the offense, so possession switches sides.`;
  }
  if (t.includes('interception')) {
    return 'Interception. The defense caught a pass meant for the offense and takes over the ball.';
  }

  if (t.includes('fumble') || t.includes('muffs')) {
    const recovered = /RECOVERED by ([A-Z]{2,4})-/.exec(text);
    return recovered
      ? `The ball was dropped and ${recovered[1]} recovered it. A loose ball belongs to whoever lands on it.`
      : 'The ball was dropped while in play. Whichever team recovers it gets possession.';
  }

  const sack = NFL_SACK.exec(text);
  if (sack) {
    const lost = Math.abs(Number(sack[2]));
    const by = sack[3] ? ` by ${readableName(sack[3])}` : '';
    return `${readableName(sack[1])} was sacked${by} for a loss of ${plural(lost, 'yard')}. The quarterback was tackled before he could throw, which pushes his team backwards.`;
  }
  if (t.includes('sack')) {
    return 'Sack. The quarterback was tackled behind the line before he could throw.';
  }

  const penalty = NFL_PENALTY.exec(text);
  if (penalty) {
    const on = penalty[2] ? `${readableName(penalty[2])} of ${penalty[1]}` : penalty[1];
    return `Penalty on ${on} for ${penalty[3].toLowerCase()}. The referee moves the ball ${plural(Number(penalty[4]), 'yard')} as a punishment.`;
  }

  const punt = NFL_PUNT.exec(text);
  if (punt) {
    return `${readableName(punt[1])} punted ${plural(Number(punt[2]), 'yard')}. Rather than risk failing on 4th down, the offense kicks the ball away and hands over possession deliberately.`;
  }

  const kick = NFL_KICKOFF.exec(text);
  if (kick) {
    return `${readableName(kick[1])} kicked off ${plural(Number(kick[2]), 'yard')}. This restarts play, and the receiving team runs it back as far as it can.`;
  }
  if (t.includes('kickoff') || t.includes('kick off')) {
    return 'Kickoff. The ball is kicked away to restart play and the receiving team runs it back.';
  }

  if (t.includes('penalty') || t.includes('flag')) {
    return 'Penalty. A referee spotted a rule violation and moves the ball to punish the offending team.';
  }
  if (t.includes('fourth down') || t.includes('4th down')) {
    return 'Fourth down. Last chance to gain the yards needed, or the other team takes the ball here.';
  }

  // Routine plays reach here — the ordinary rushes, catches and incompletions
  // that make up most of a game and that a newcomer sees constantly. The
  // keyword tiers above deliberately do not match them, so before this they
  // returned null and the overlay printed raw ESPN notation like
  // "(Shotgun) S.Buechele pass short left to M.Hardman to BUF 29 for 2 yards".
  if (t.includes('pass incomplete')) {
    const thrower = rx(`(${NFL_NAME}) pass incomplete`).exec(text);
    const by = thrower ? `${readableName(thrower[1])}'s pass` : 'The pass';
    return `${by} was not caught. No yards gained, and that uses up one of the offense's four attempts.`;
  }

  const catchPlay = NFL_PASS.exec(text);
  if (catchPlay) {
    const gained = yardsOf(catchPlay[3]);
    // Absent yardage and zero yardage are different facts: only "no gain" in
    // the text means the play actually gained nothing.
    const stated = catchPlay[3] != null || /no gain/i.test(text);
    const how = !stated ? 'caught it'
      : gained < 0 ? `caught it and was tackled ${plural(Math.abs(gained), 'yard')} behind`
      : gained === 0 ? 'caught it but gained nothing'
      : `gained ${plural(gained, 'yard')}`;
    return `${readableName(catchPlay[1])} threw to ${readableName(catchPlay[2])}, who ${how}. The offense has four attempts to move 10 yards and keep possession.`;
  }

  const run = NFL_RUSH.exec(text);
  if (run) {
    const gained = yardsOf(run[2]);
    const how = gained < 0 ? `was tackled ${plural(Math.abs(gained), 'yard')} behind the line`
      : gained === 0 ? 'was stopped for no gain'
      : `ran for ${plural(gained, 'yard')}`;
    return `${readableName(run[1])} ${how}. The offense has four attempts to move 10 yards and keep possession.`;
  }

  return null;
}

// ---------------------------------------------------------------- MLB

// ESPN's MLB text is already a plain narrative sentence ("Peña struck out
// looking."), unlike NFL's notation. So the play is quoted as-is and the rule
// only supplies the concept behind it, which is the part a newcomer lacks.
function explainMlb(event, t) {
  const said = event.text.replace(/\s+/g, ' ').trim();
  const lead = /[.!?]$/.test(said) ? said : `${said}.`;
  const when = periodLine(event);

  const concept =
    t.includes('home run') || t.includes('homered') ? 'A home run: the ball left the field, so the batter and everyone already on base all score.'
    : t.includes('grand slam') ? 'A grand slam: a home run with all three bases occupied, scoring 4 at once.'
    : t.includes('struck out') || t.includes('strikeout') ? 'A strikeout: three strikes and the batter is out. One of the three outs that ends the half-inning.'
    : /\bwalk(ed|s)?\b/.test(t) || t.includes('base on balls') ? 'A walk: four pitches outside the strike zone, so the batter is awarded first base for free.'
    : t.includes('stole') || t.includes('stolen base') ? 'A stolen base: the runner advanced on his own while the pitch was being thrown.'
    : t.includes('double play') ? 'A double play: two outs on one hit ball, which is the worst outcome available to the batting team.'
    : t.includes("fielder's choice") ? "A fielder's choice: the defense chose to get a runner out elsewhere rather than the batter."
    : t.includes('error') ? 'An error: the defense misplayed the ball, so the runners advanced further than the hit earned.'
    : t.includes('sacrifice') ? 'A sacrifice: the batter gave himself up on purpose so a runner could advance.'
    : t.includes('hit by pitch') ? 'Hit by pitch: the throw struck the batter, so he is awarded first base for free.'
    : t.includes('wild pitch') ? 'A wild pitch: the throw got past the catcher, so the runners advanced a base for free.'
    : t.includes('passed ball') ? 'A passed ball: the catcher failed to hold a catchable pitch, so the runners advanced a base for free.'
    : t.includes('balk') ? 'A balk: the pitcher made an illegal move on the mound, so every runner is awarded the next base.'
    : t.includes('picked off') ? 'Picked off: the pitcher threw to the base rather than the plate and caught the runner too far off it. He is out.'
    : t.includes('relieved') ? 'A pitching change: a fresh pitcher is taking over. Pitchers tire quickly, and managers swap them to get a better matchup against the next batters.'
    : t.includes('hit for') ? 'A pinch hitter: a substitute is batting in place of someone else, usually because he matches up better against this pitcher. The replaced player is out of the game for good.'
    : /\bat (?:first|second|third) base\b|\bat shortstop\b|\bin (?:left|right|center) field\b/.test(t) ? 'A defensive substitution: a player has moved position or come on to replace someone in the field.'
    : /\bdouble[ds]?\b/.test(t) ? 'A double: the batter reached second base on his own hit.'
    : /\btriple[ds]?\b/.test(t) ? 'A triple: the batter reached third base, the rarest hit in the sport.'
    : /\bsingle[ds]?\b/.test(t) ? 'A single: the batter hit the ball and reached first base safely.'
    : t.includes('grounded out') || t.includes('lined out') || t.includes('popped out') || t.includes('flied out') || t.includes('foul') ? 'The ball was caught or fielded in time, so the batter is out. Three outs end the half-inning.'
    : null;

  if (!concept) return null;

  const scored = Number(event.score && event.score.home) >= 0 && event.isScoring === true
    ? scoreLine(event)
    : '';
  return `${lead}${when} ${concept}${scored}`;
}

// ---------------------------------------------------------------- F1

// Race control writes in terse stewards' shorthand and in capitals: "YELLOW IN
// TRACK SECTOR 14", "BLACK AND WHITE FLAG FOR CAR 81 (PIA) - DRIVING
// ERRATICALLY". Almost none of it means anything to a newcomer, and the flag
// vocabulary is most of the feed, so the flags are covered first.
const F1_CAR = /CAR (\d+) \(([A-Z]{3})\)/;

function explainF1(event, t) {
  const text = event.text;
  const car = F1_CAR.exec(text);
  const who = car ? `Car ${car[1]} (${car[2]})` : 'A car';

  if (t.includes('chequered flag') || t.includes('checkered flag')) {
    return 'Chequered flag. The session is over.';
  }
  if (t.includes('double yellow')) {
    return 'Double yellow flag. There is a hazard on the track in that sector — drivers must slow down significantly and are not allowed to overtake.';
  }
  if (t.includes('yellow')) {
    return 'Yellow flag. Something is on or near the track in that sector, so drivers must slow down and cannot overtake there.';
  }
  if (t.includes('black and white')) {
    return `${who} was shown the black and white flag — a formal warning for unsporting driving. A second offence usually becomes a penalty.`;
  }
  if (t.includes('blue flag')) {
    return `${who} is being lapped and must let the faster cars through. Blue flags carry a penalty if ignored.`;
  }
  if (t.includes('red flag')) {
    return 'Red flag. The session is stopped, usually for a crash or conditions too dangerous to continue, and cars return to the pits.';
  }
  if (t.includes('green light') || t.includes('green flag')) {
    return 'Green. The track is clear and racing conditions are back to normal.';
  }
  if (t.includes('clear in track sector')) {
    return 'That sector of the track is clear again. Normal racing resumes there.';
  }
  if (t.includes('track clear')) {
    return 'The track is clear. Whatever caused the earlier caution has been dealt with and racing is back to normal.';
  }
  if (t.includes('vsc') || t.includes('virtual safety car')) {
    return t.includes('ending') || t.includes('withdrawn')
      ? 'The virtual safety car is ending, so full racing speed is about to resume.'
      : 'Virtual safety car. Every driver must slow to a set delta speed while an incident is cleared. No physical safety car comes out, and positions are frozen in effect.';
  }
  if (t.includes('safety car')) {
    return 'Safety car deployed. A real car leads the field around at reduced speed while marshals clear an incident, which bunches the whole field together.';
  }
  if (t.includes('time penalty') || t.includes('penalty')) {
    const seconds = /(\d+)\s*SECOND/i.exec(text);
    const amount = seconds ? `${plural(Number(seconds[1]), 'second')}` : 'a time penalty';
    return `${who} has been given ${amount === 'a time penalty' ? amount : `a ${amount} penalty`} by the stewards. It is added to their race time or served at their next pit stop.`;
  }
  if (t.includes('track limits')) {
    return `${who} ran wide beyond the white lines. Repeated track-limits breaches earn a warning and eventually a penalty.`;
  }
  if (t.includes('drs enabled')) {
    return 'DRS enabled. Drivers within one second of the car ahead may now open a flap in their rear wing for extra straight-line speed, which makes overtaking easier.';
  }
  if (t.includes('drs disabled')) {
    return 'DRS disabled. The overtaking aid is switched off, usually because conditions are unsafe.';
  }
  if (t.includes('drs')) {
    return 'DRS is the moveable rear wing that reduces drag and helps a chasing car overtake on the straights.';
  }
  if (t.includes('pit exit open')) {
    return 'The pit exit is open, so cars may rejoin the track.';
  }
  if (t.includes('pit entry closed') || t.includes('pit exit closed')) {
    return 'The pit lane is closed, so cars cannot come in or rejoin right now.';
  }
  if (t.includes('session started')) {
    return 'The session has started.';
  }
  if (t.includes('pit stop') || t.includes('pitting')) {
    const compound = t.includes('soft') ? ' on soft tyres, which are fast but wear out quickly'
      : t.includes('medium') ? ' on medium tyres, the balanced choice'
      : t.includes('hard') ? ' on hard tyres, slower but longer lasting' : '';
    return `${who} pitted for fresh tyres${compound}. A stop costs roughly 20 seconds in total.`;
  }
  if (t.includes('retire') || t.includes('dnf')) {
    return `${who} has retired from the race, either from damage or a mechanical failure.`;
  }
  if (t.includes('fastest lap')) {
    return 'Fastest lap of the race so far. It is worth 1 bonus championship point if that driver finishes in the top 10.';
  }
  if (t.includes('overtake') || t.includes('position change')) {
    return 'A driver has passed another and moved up the order.';
  }

  return null;
}

// ----------------------------------------------------------------

export const RuleExplainer = {
  name: 'rules',
  async explain(event) {
    if (!event || typeof event.text !== 'string' || event.text.length === 0) return null;

    // A regex or a field on an unexpected shape must never cost the user the
    // play — the chain would fall through to null and the overlay would print
    // raw feed notation instead.
    try {
      const t = event.text.toLowerCase();
      if (event.sport === 'nfl') return explainNfl(event, t);
      if (event.sport === 'mlb') return explainMlb(event, t);
      if (event.sport === 'f1') return explainF1(event, t);
      return null;
    } catch {
      return null;
    }
  }
};
