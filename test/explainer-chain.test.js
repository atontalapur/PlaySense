import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExplainerChain } from '../src/explainers/index.js';

const ok = (text) => ({ name: 'ok', explain: async () => text });
const nothing = { name: 'nothing', explain: async () => null };
const boom = { name: 'boom', explain: async () => { throw new Error('kaboom'); } };

test('returns the first non-null explanation', async () => {
  const chain = createExplainerChain([ok('claude says'), ok('rules say')]);
  assert.equal(await chain.explain({ text: 'x' }), 'claude says');
});

test('falls through to the next provider on null', async () => {
  const chain = createExplainerChain([nothing, ok('rules say')]);
  assert.equal(await chain.explain({ text: 'x' }), 'rules say');
});

test('a throwing provider does not break the chain', async () => {
  const chain = createExplainerChain([boom, ok('rules say')]);
  assert.equal(await chain.explain({ text: 'x' }), 'rules say');
});

test('returns null when no provider answers', async () => {
  const chain = createExplainerChain([nothing, nothing]);
  assert.equal(await chain.explain({ text: 'x' }), null);
});
