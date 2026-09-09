import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv, readDevKey, seedKeyFromDevEnv, DEV_ENV_FILE } from '../src/dev-key.js';

const fileServing = (text) => async () => ({ ok: true, text: async () => text });
const missingFile = async () => ({ ok: false, status: 404, text: async () => '' });
const urlFor = (f) => `chrome-extension://abc/${f}`;

test('parses KEY=value, comments and blank lines', () => {
  assert.deepEqual(
    parseEnv('# a comment\n\nANTHROPIC_API_KEY=sk-ant-abc\nOTHER=2\n'),
    { ANTHROPIC_API_KEY: 'sk-ant-abc', OTHER: '2' }
  );
});

test('strips one layer of matched quotes', () => {
  assert.equal(parseEnv('K="sk-ant-abc"').K, 'sk-ant-abc');
  assert.equal(parseEnv("K='sk-ant-abc'").K, 'sk-ant-abc');
  assert.equal(parseEnv('K="sk-ant-abc').K, '"sk-ant-abc', 'unmatched quotes are part of the value');
});

test('skips what it does not understand rather than guessing', () => {
  assert.deepEqual(parseEnv('no equals sign here'), {});
  assert.deepEqual(parseEnv('=novalue'), {});
  assert.deepEqual(parseEnv('9BAD=x'), {}, 'not a valid identifier');
  assert.deepEqual(parseEnv('EMPTY='), {}, 'an empty value is not a key');
  assert.deepEqual(parseEnv(null), {});
  assert.deepEqual(parseEnv(undefined), {});
});

test('a value containing = survives intact', () => {
  assert.equal(parseEnv('K=a=b=c').K, 'a=b=c');
});

test('readDevKey returns null when the file is absent, which is the normal case', async () => {
  assert.equal(await readDevKey({ fetchImpl: missingFile, urlFor }), null);
  assert.equal(
    await readDevKey({ fetchImpl: async () => { throw new Error('nope'); }, urlFor }),
    null
  );
});

test('readDevKey reads the file the loader actually looks for', async () => {
  const asked = [];
  const fetchImpl = async (url) => { asked.push(url); return { ok: true, text: async () => 'ANTHROPIC_API_KEY=sk-ant-x' }; };
  assert.equal(await readDevKey({ fetchImpl, urlFor }), 'sk-ant-x');
  assert.match(asked[0], new RegExp(`${DEV_ENV_FILE}$`));
});

test('a key already in storage is never overwritten', async () => {
  let stored = 'sk-ant-verified-by-the-popup';
  const result = await seedKeyFromDevEnv({
    fetchImpl: fileServing('ANTHROPIC_API_KEY=sk-ant-from-file'),
    urlFor,
    getStored: async () => stored,
    setStored: async (k) => { stored = k; }
  });
  assert.deepEqual(result, { seeded: false, reason: 'key-already-saved' });
  assert.equal(stored, 'sk-ant-verified-by-the-popup', 'the verified key survives');
});

test('seeds only when storage is empty and a file exists', async () => {
  let stored = null;
  const seeded = await seedKeyFromDevEnv({
    fetchImpl: fileServing('ANTHROPIC_API_KEY=sk-ant-from-file'),
    urlFor,
    getStored: async () => stored,
    setStored: async (k) => { stored = k; }
  });
  assert.deepEqual(seeded, { seeded: true, reason: null });
  assert.equal(stored, 'sk-ant-from-file');

  stored = null;
  const none = await seedKeyFromDevEnv({
    fetchImpl: missingFile, urlFor,
    getStored: async () => stored,
    setStored: async (k) => { stored = k; }
  });
  assert.deepEqual(none, { seeded: false, reason: 'no-dev-env' });
  assert.equal(stored, null);
});
