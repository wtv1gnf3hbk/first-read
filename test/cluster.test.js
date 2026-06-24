'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { entityTokens, entityGroup, mergeClusters, rankClusters } = require('../lib/cluster');

// --------------------------------------------------------------- entityTokens

test('entityTokens keeps significant entity-ish tokens and drops stopwords', () => {
  const toks = entityTokens('Israel and Iran agree to a ceasefire after talks');
  assert.ok(toks.includes('israel'));
  assert.ok(toks.includes('iran'));
  assert.ok(toks.includes('ceasefire'));
  assert.ok(!toks.includes('and'), 'stopword dropped');
  assert.ok(!toks.includes('to'), 'stopword dropped');
  assert.ok(!toks.includes('a'), 'short stopword dropped');
});

test('entityTokens is case-insensitive and dedupes', () => {
  const toks = entityTokens('Trump meets Trump aides');
  assert.equal(toks.filter((t) => t === 'trump').length, 1);
});

// ---------------------------------------------------------------- entityGroup

test('entityGroup groups candidates that share salient entities', () => {
  const cands = [
    { id: 'a', title: 'Iran and Israel reach ceasefire deal', sources: ['ap'], prominence: 0 },
    { id: 'b', title: 'Ceasefire holds as Israel withdraws from border', sources: ['bbc'], prominence: 2 },
    { id: 'c', title: 'Apple unveils new iPhone at fall event', sources: ['theverge'], prominence: 1 },
  ];
  const groups = entityGroup(cands);
  // a and b share israel/ceasefire → one group; c stands alone.
  const groupWithA = groups.find((g) => g.members.includes('a'));
  assert.ok(groupWithA.members.includes('b'), 'a and b cluster together');
  assert.ok(!groupWithA.members.includes('c'), 'apple story stays separate');
  assert.equal(groups.length, 2);
});

// --------------------------------------------------------------- mergeClusters

test('mergeClusters unions clusters that share any member id', () => {
  const chunks = [
    [{ members: ['a', 'b'] }, { members: ['c'] }],
    [{ members: ['b', 'd'] }], // shares b with the first cluster
  ];
  const merged = mergeClusters(chunks);
  const big = merged.find((m) => m.members.includes('a'));
  assert.deepEqual(big.members.sort(), ['a', 'b', 'd']);
  assert.equal(merged.length, 2, 'a/b/d merged + standalone c');
});

// ---------------------------------------------------------------- rankClusters

test('rankClusters orders by outlet count then prominence', () => {
  const byId = {
    a: { sources: ['ap', 'bbc', 'reuters'], prominence: 4 }, // 3 outlets
    b: { sources: ['ap'], prominence: 0 },                   // 1 outlet, top of page
    c: { sources: ['ap', 'bbc'], prominence: 1 },            // 2 outlets, high
  };
  const clusters = [{ members: ['b'] }, { members: ['c'] }, { members: ['a'] }];
  const ranked = rankClusters(clusters, byId);
  assert.deepEqual(ranked.map((r) => r.members[0]), ['a', 'c', 'b'], '3-outlet > 2-outlet > 1-outlet');
  assert.ok(ranked[0].score >= ranked[1].score);
  assert.equal(ranked[0].outletCount, 3);
});
