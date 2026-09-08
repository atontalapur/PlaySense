import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeLanguageModel, describeProbe, USABLE_STATES } from '../src/explainers/nano-probe.js';

// The probe exists to answer one question — is LanguageModel exposed to an MV3
// service worker — so its job is to report honestly, including when the answer
// is "present but unusable". These pin the shapes the popup renders.

test('reports a missing API rather than throwing on it', async () => {
  assert.deepEqual(await probeLanguageModel({}), {
    present: false, availability: null, usable: false, reason: 'not-exposed'
  });
  assert.deepEqual(await probeLanguageModel(undefined && {}), {
    present: false, availability: null, usable: false, reason: 'not-exposed'
  });
});

test('an object without availability() is not a usable API', async () => {
  const probe = await probeLanguageModel({ LanguageModel: { params: () => ({}) } });
  assert.equal(probe.present, false);
  assert.equal(probe.reason, 'no-availability-method');
});

test('carries the availability state through and marks what is usable', async () => {
  for (const state of ['available', 'downloading', 'downloadable']) {
    const probe = await probeLanguageModel({ LanguageModel: { availability: async () => state } });
    assert.equal(probe.availability, state);
    assert.equal(probe.usable, true, `${state} should count as usable`);
    assert.equal(probe.present, true);
  }

  const off = await probeLanguageModel({ LanguageModel: { availability: async () => 'unavailable' } });
  assert.equal(off.present, true, 'the API exists even when the model cannot run');
  assert.equal(off.usable, false);
  assert.ok(!USABLE_STATES.has('unavailable'));
});

test('an availability() that throws is reported, not swallowed', async () => {
  const probe = await probeLanguageModel({
    LanguageModel: { availability: async () => { throw new Error('blocked by policy'); } }
  });
  assert.equal(probe.present, true);
  assert.equal(probe.reason, 'availability-threw');
  assert.match(probe.message, /blocked by policy/);
  assert.equal(probe.usable, false);
});

test('a failing params() does not downgrade an otherwise usable probe', async () => {
  const probe = await probeLanguageModel({
    LanguageModel: {
      availability: async () => 'available',
      params: async () => { throw new Error('nope'); }
    }
  });
  assert.equal(probe.usable, true, 'params is informational only');
  assert.equal(probe.params, null);
});

test('describeProbe turns each outcome into one readable line', async () => {
  assert.match(describeProbe('Service worker', null), /could not be reached/i);
  assert.match(
    describeProbe('Service worker', { present: false, reason: 'not-exposed' }),
    /not exposed/i
  );
  assert.match(
    describeProbe('Page', { present: true, availability: 'available', usable: true }),
    /available/
  );
  assert.match(
    describeProbe('Page', { present: true, availability: 'unavailable', usable: false }),
    /not usable/
  );
  assert.match(
    describeProbe('Page', { present: true, reason: 'availability-threw', message: 'policy' }),
    /policy/
  );
});
