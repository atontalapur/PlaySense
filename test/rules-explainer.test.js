import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuleExplainer } from '../src/explainers/rules.js';

test('explains nfl touchdowns', async () => {
  const out = await RuleExplainer.explain({ sport: 'nfl', text: 'K.Johnson runs for a TOUCHDOWN' });
  assert.match(out, /end zone/i);
});

test('explains nfl sacks and interceptions', async () => {
  assert.match(await RuleExplainer.explain({ sport: 'nfl', text: 'J.Allen sacked at BUF 20' }), /quarterback/i);
  assert.match(await RuleExplainer.explain({ sport: 'nfl', text: 'INTERCEPTION by O.Reese' }), /defense/i);
});

test('explains mlb plays', async () => {
  const out = await RuleExplainer.explain({ sport: 'mlb', text: 'Judge hit a home run to left.' });
  assert.ok(typeof out === 'string' && out.length > 0);
});

test('returns null when no rule matches', async () => {
  assert.equal(await RuleExplainer.explain({ sport: 'nfl', text: 'The zamboni is on the field' }), null);
  assert.equal(await RuleExplainer.explain({ sport: 'nfl', text: '' }), null);
  assert.equal(await RuleExplainer.explain({}), null);
});

test('does not throw on malformed events', async () => {
  await RuleExplainer.explain(null);
  await RuleExplainer.explain({ sport: 'nfl' });
});

// The rules tier is the only tier for anyone without an API key, so it reads
// the structured fields the feeds hand it rather than returning one fixed
// string per keyword. These assert the data actually reaches the output.

test('nfl explanations name the players and the yardage from the play text', async () => {
  const sack = await RuleExplainer.explain({
    sport: 'nfl',
    text: '(Shotgun) W.Howard sacked at PIT 22 for -9 yards (K.Jenkins).'
  });
  assert.match(sack, /W\. Howard/, 'the quarterback is named');
  assert.match(sack, /K\. Jenkins/, 'the tackler is named');
  assert.match(sack, /9 yards/, 'the yardage lost is stated');

  const fg = await RuleExplainer.explain({
    sport: 'nfl',
    text: 'T.Bass 33 yard field goal is GOOD, Center-R.Ferguson, Holder-T.Doman.',
    score: { home: 3, away: 0 }
  });
  assert.match(fg, /T\. Bass/);
  assert.match(fg, /33-yard/);
  assert.match(fg, /home 3, away 0/, 'a scoring play reports the new score');

  // The GOOD branch was reached by /good/i, which "No Good" also satisfies, so
  // every missed kick was announced as a made one.
  const missed = await RuleExplainer.explain({
    sport: 'nfl',
    text: 'T.Bass 45 yard field goal is No Good, Center-R.Ferguson, Holder-T.Doman.',
    score: { home: 3, away: 0 }
  });
  assert.match(missed, /missed/, 'a missed field goal says so');
  assert.doesNotMatch(missed, /worth 3 points/, 'and does not describe it as scoring');
  assert.doesNotMatch(missed, /home 3, away 0/, 'and does not report a new score');

  const penalty = await RuleExplainer.explain({
    sport: 'nfl',
    text: 'PENALTY on BUF-S.Gosnell, Offensive Holding, 10 yards, enforced at BUF 30.'
  });
  assert.match(penalty, /S\. Gosnell/);
  assert.match(penalty, /offensive holding/i, 'the specific infraction, not just "a penalty"');
  assert.match(penalty, /10 yards/);
});

test('the score is never attributed to a team the event does not name', async () => {
  const td = await RuleExplainer.explain({
    sport: 'nfl',
    text: 'F.Gore up the middle for 1 yard, TOUCHDOWN.',
    score: { home: 7, away: 0 }
  });
  // The event carries score.home and score.away and no team names anywhere, so
  // naming a side would be invention.
  assert.match(td, /home 7, away 0/);
  assert.match(td, /F\. Gore/);
  assert.match(td, /1 yard\b/, 'singular for one yard, not "1 yards"');
});

test('routine nfl plays are explained rather than dropped', async () => {
  // These carry no keyword and used to return null, leaving the overlay to
  // print raw ESPN notation. They are most of a game.
  const run = await RuleExplainer.explain({
    sport: 'nfl', text: '(Shotgun) I.Wheeler up the middle to BUF 22 for no gain (E.Roberts).'
  });
  assert.match(run, /I\. Wheeler/);
  assert.match(run, /no gain/i);

  const pass = await RuleExplainer.explain({
    sport: 'nfl', text: '(Shotgun) S.Buechele pass short left to M.Hardman to BUF 29 for 2 yards.'
  });
  assert.match(pass, /S\. Buechele/);
  assert.match(pass, /M\. Hardman/);
  assert.match(pass, /2 yards/);

  const incomplete = await RuleExplainer.explain({
    sport: 'nfl', text: 'S.Buechele pass incomplete short right [R.Spears-Jennings].'
  });
  assert.match(incomplete, /not caught/i);
});

test('mlb quotes the play and then explains the concept behind it', async () => {
  const k = await RuleExplainer.explain({
    sport: 'mlb',
    text: 'Peña struck out looking.',
    period: { display: '1st Inning' }
  });
  assert.match(k, /Peña struck out looking\./, 'the feed sentence is already plain English; keep it');
  assert.match(k, /1st Inning/);
  assert.match(k, /three strikes/i, 'and add the concept a newcomer is missing');
});

test('mlb covers the substitutions that confuse newcomers most', async () => {
  const change = await RuleExplainer.explain({ sport: 'mlb', text: 'Okert relieved Wesneski' });
  assert.match(change, /pitching change/i);

  const pinch = await RuleExplainer.explain({ sport: 'mlb', text: 'Ramos hit for Jones' });
  assert.match(pinch, /pinch hitter/i);

  const hbp = await RuleExplainer.explain({ sport: 'mlb', text: 'Peña hit by pitch.' });
  assert.match(hbp, /first base/i);
});

test('f1 explains the flag vocabulary that is most of the race control feed', async () => {
  const dbl = await RuleExplainer.explain({ sport: 'f1', text: 'DOUBLE YELLOW IN TRACK SECTOR 7' });
  assert.match(dbl, /overtak/i);

  const bw = await RuleExplainer.explain({
    sport: 'f1', text: 'BLACK AND WHITE FLAG FOR CAR 81 (PIA) - DRIVING ERRATICALLY (16:18:41)'
  });
  assert.match(bw, /Car 81 \(PIA\)/, 'the car and driver code are in the message; use them');
  assert.match(bw, /warning/i);

  const vsc = await RuleExplainer.explain({ sport: 'f1', text: 'VSC DEPLOYED' });
  assert.match(vsc, /virtual safety car/i);

  assert.ok(await RuleExplainer.explain({ sport: 'f1', text: 'TRACK CLEAR' }));
  assert.ok(await RuleExplainer.explain({ sport: 'f1', text: 'CHEQUERED FLAG' }));
});

test('a malformed score or period never costs the play its explanation', async () => {
  const weird = await RuleExplainer.explain({
    sport: 'nfl',
    text: 'T.Bass 33 yard field goal is GOOD.',
    score: { home: null, away: undefined },
    period: {}
  });
  assert.ok(weird && weird.includes('33-yard'), 'the explanation survives unusable context fields');
  assert.ok(!/null|undefined|NaN/.test(weird), 'and never leaks them into the copy');
});

// Found by running three live MLB games through the parser: wild pitches appear
// in real feeds but in none of the recorded fixtures.
test('mlb covers the ways a runner advances without a hit', async () => {
  const wild = await RuleExplainer.explain({
    sport: 'mlb', text: 'Bazzana to second on wild pitch by Young.'
  });
  assert.match(wild, /past the catcher/i);

  const passed = await RuleExplainer.explain({
    sport: 'mlb', text: 'Smith to third on passed ball by Diaz.'
  });
  assert.match(passed, /catcher/i);

  const balk = await RuleExplainer.explain({ sport: 'mlb', text: 'Jones to second on balk by Cole.' });
  assert.match(balk, /illegal/i);

  const pickoff = await RuleExplainer.explain({ sport: 'mlb', text: 'Neto picked off first.' });
  assert.match(pickoff, /out/i);
});
