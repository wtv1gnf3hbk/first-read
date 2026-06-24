'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { fixContractions, removeAmid, dropTickerRepeats, dedupeSpine, applyFixes } = require('../lib/fix');

test('fixContractions drops an is/has ’s before a verb (rule #1)', () => {
  assert.equal(fixContractions("Disney's named a new chief."), 'Disney named a new chief.');
  assert.equal(fixContractions("The bank's announced cuts."), 'The bank announced cuts.');
});

test('fixContractions leaves genuine possessives alone', () => {
  assert.equal(fixContractions("Disney's CEO resigned."), "Disney's CEO resigned.");
  assert.equal(fixContractions("the company's profits"), "the company's profits");
});

test('removeAmid swaps the banned "amid" for a clean temporal preposition', () => {
  assert.equal(removeAmid('named amid the turmoil'), 'named during the turmoil');
  assert.doesNotMatch(removeAmid('shares fell amid uncertainty'), /\bamid\b/);
});

test('dropTickerRepeats removes ticker items already covered in the spine', () => {
  const briefing = {
    spine: [{ link_url: 'https://x.com/a' }],
    ticker: [{ text: 'dup', url: 'https://x.com/a' }, { text: 'keep', url: 'https://x.com/b' }],
  };
  const out = dropTickerRepeats(briefing);
  assert.deepEqual(out.ticker.map((t) => t.url), ['https://x.com/b']);
});

test('dedupeSpine collapses spine items sharing a link to the first', () => {
  const briefing = { spine: [
    { headline: 'one', link_url: 'https://x.com/a' },
    { headline: 'dup', link_url: 'https://x.com/a' },
    { headline: 'two', link_url: 'https://x.com/b' },
  ] };
  const out = dedupeSpine(briefing);
  assert.equal(out.spine.length, 2);
  assert.deepEqual(out.spine.map((s) => s.headline), ['one', 'two']);
});

test('applyFixes runs all fixers and reports what it changed', () => {
  const briefing = {
    spine: [{ headline: 'h', text: "Disney's named a chief amid chaos.", link_url: 'https://x.com/a' }],
    worth: [], ticker: [{ text: 't', url: 'https://x.com/a' }], longreads: [],
  };
  const { briefing: fixed, changes } = applyFixes(briefing);
  assert.equal(fixed.spine[0].text, 'Disney named a chief during chaos.');
  assert.equal(fixed.ticker.length, 0, 'ticker repeat of spine link dropped');
  assert.ok(changes.length > 0);
});
