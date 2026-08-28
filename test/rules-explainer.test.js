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
