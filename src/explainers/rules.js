// Ported verbatim from the pre-refactor content.js keyword chains.
// Zero cost, no network. Always available as the fallback tier.

function explainNfl(text) {
  const t = text.toLowerCase();

  if (t.includes('touchdown')) {
    return 'Touchdown! A player reached the end zone and scored 6 points for their team.';
  }
  if (t.includes('two-point conversion') || t.includes('two point conversion')) {
    return 'Two-point conversion attempt! Instead of kicking for 1 extra point, they are trying to run or pass into the end zone for 2 points.';
  }
  if (t.includes('extra point') || /\bpat\b/.test(t)) {
    return 'Extra point! After a touchdown, the kicker attempts a short kick through the goalposts for 1 bonus point.';
  }
  if (t.includes('field goal')) {
    return 'Field goal! The kicker scored 3 points by kicking the ball through the goalposts.';
  }
  if (t.includes('safety') && !t.includes('safety car') && !t.includes('player safety')) {
    return 'Safety! The defense tackled an offensive player in their own end zone — worth 2 points for the defense.';
  }
  if (t.includes('interception')) {
    return 'Interception! The defense caught a pass meant for the offense and took control of the ball.';
  }
  if (t.includes('fumble')) {
    return 'Fumble! A player dropped the ball — whichever team recovers it gets possession.';
  }
  if (t.includes('sack')) {
    return 'Sack! The quarterback was tackled behind the line before he could throw the ball.';
  }
  if (t.includes('punt')) {
    return 'Punt! The offense kicked the ball away on 4th down rather than risk losing possession at this field position.';
  }
  if (t.includes('kickoff return') || t.includes('kick return')) {
    return 'Kickoff return! After a score, the receiving team is running the kicked ball back up the field.';
  }
  if (t.includes('kickoff') || t.includes('kick off')) {
    return 'Kickoff! The ball is kicked to start the drive. If it reaches the end zone, the receiving team may take a touchback and start at their 25-yard line.';
  }
  if (t.includes('fourth down') || t.includes('4th down')) {
    return '4th down! This is the offense\'s last chance to gain the yards needed for a first down before potentially losing the ball.';
  }
  if (t.includes('penalty') || t.includes('flag')) {
    return 'Penalty! A referee spotted a rule violation and is moving the ball to penalize the offending team.';
  }
  return null;
}

function explainMlb(text) {
  const t = text.toLowerCase();

  if (t.includes('home run') || t.includes('homerun')) {
    return 'Home run! The batter hit the ball out of the park — all runners on base score, plus the batter.';
  }
  if (t.includes('strikeout') || t.includes('struck out')) {
    return 'Strikeout! The batter got three strikes and is out. The pitcher wins this matchup.';
  }
  if (/\bwalk(ed|s)?\b/.test(t) || t.includes('base on balls')) {
    return 'Walk! The pitcher threw 4 balls outside the strike zone, so the batter gets a free trip to first base.';
  }
  if (t.includes('stolen base')) {
    return 'Stolen base! A runner sprinted to the next base while the pitcher was winding up.';
  }
  if (t.includes('double play')) {
    return 'Double play! The defense got two outs on a single play — a huge momentum swing.';
  }
  if (t.includes('error')) {
    return 'Error! A fielder made a mistake (dropped the ball or threw it badly), giving the offense extra bases they did not earn.';
  }
  if (t.includes('single')) {
    return 'Single! The batter hit the ball and safely reached first base.';
  }
  if (t.includes('double') && !t.includes('double play')) {
    return 'Double! The batter hit the ball far enough to reach second base safely.';
  }
  if (t.includes('triple')) {
    return 'Triple! The batter hit the ball and made it all the way to third base — a rare and exciting hit.';
  }
  return null;
}

function explainF1(text) {
  const t = text.toLowerCase();

  if (t.includes('overtake') || t.includes('passed') || t.includes('position change')) {
    return 'Position change! A driver has passed another, moving up in the race standings.';
  }
  if (t.includes('pit stop') || t.includes('pitting')) {
    const compound = t.includes('soft') ? ' (soft tyres — fast but wear quickly)' :
                     t.includes('medium') ? ' (medium tyres — balanced choice)' :
                     t.includes('hard') ? ' (hard tyres — slow but last longer)' : '';
    return `Pit stop! A car pulled into the garage to change tyres${compound}. This costs about 2–3 seconds.`;
  }
  if (t.includes('virtual safety car') || t.includes('vsc')) {
    return 'Virtual safety car! Drivers must slow to a set speed limit without a physical safety car. Used for minor incidents.';
  }
  if (t.includes('safety car')) {
    return 'Safety car deployed! All cars must slow down and follow the safety car while an incident on track is cleared.';
  }
  if (t.includes('fastest lap')) {
    return 'Fastest lap! A driver just set the quickest single lap of the race — worth 1 bonus championship point if they finish in the top 10.';
  }
  if (t.includes('drs')) {
    return 'DRS activated! A car opened a flap on its rear wing to reduce drag and gain speed — used to help overtaking.';
  }
  if (t.includes('retire') || t.includes('dnf') || t.includes('out of the race')) {
    return 'Retirement (DNF)! A car has dropped out of the race due to a mechanical failure or incident.';
  }
  if (t.includes('crash') || t.includes('accident')) {
    return 'Incident on track! A driver has been in an accident and may be out of the race.';
  }
  if (t.includes('penalty')) {
    return 'Penalty! A driver broke a rule (unsafe driving, track limits, etc.) and will serve a time penalty.';
  }
  return null;
}

export const RuleExplainer = {
  name: 'rules',
  async explain(event) {
    if (!event || typeof event.text !== 'string' || event.text.length === 0) return null;
    if (event.sport === 'nfl') return explainNfl(event.text);
    if (event.sport === 'mlb') return explainMlb(event.text);
    if (event.sport === 'f1') return explainF1(event.text);
    return null;
  }
};
