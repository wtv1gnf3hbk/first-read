'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { pruneThreads, applyNoveltyBias, promoteThreads } = require('../lib/diff');

const DAY = 86400000;
const NOW = 1750000000000; // fixed epoch ms for deterministic tests

// --------------------------------------------------------------- pruneThreads

test('pruneThreads keeps threads seen within the decay window and drops older ones', () => {
  const threads = [
    { key: 'fresh', lastSeen: NOW - 2 * DAY },
    { key: 'stale', lastSeen: NOW - 20 * DAY },
    { key: 'edge', lastSeen: NOW - 13 * DAY },
  ];
  const kept = pruneThreads(threads, NOW, 14).map((t) => t.key);
  assert.deepEqual(kept.sort(), ['edge', 'fresh']);
});

// ------------------------------------------------------------ applyNoveltyBias

test('applyNoveltyBias rewrites a low-confidence rehash to development (never silently drop)', () => {
  assert.equal(applyNoveltyBias('rehash', 0.3), 'development');
});

test('applyNoveltyBias keeps a high-confidence rehash as rehash', () => {
  assert.equal(applyNoveltyBias('rehash', 0.9), 'rehash');
});

test('applyNoveltyBias leaves new and development tags untouched', () => {
  assert.equal(applyNoveltyBias('new', 0.1), 'new');
  assert.equal(applyNoveltyBias('development', 0.1), 'development');
});

// -------------------------------------------------------------- promoteThreads

test('promoteThreads adds a brand-new story as a fresh thread', () => {
  const out = promoteThreads([], [{ key: 'k1', title: 'A new story' }], NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].firstSeen, NOW);
  assert.equal(out[0].lastSeen, NOW);
  assert.equal(out[0].seenCount, 1);
});

test('promoteThreads bumps an existing thread without resetting firstSeen', () => {
  const threads = [{ key: 'k1', title: 'Old title', firstSeen: NOW - 5 * DAY, lastSeen: NOW - 5 * DAY, seenCount: 2 }];
  const out = promoteThreads(threads, [{ key: 'k1', title: 'Updated title' }], NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].firstSeen, NOW - 5 * DAY, 'firstSeen preserved');
  assert.equal(out[0].lastSeen, NOW, 'lastSeen advanced');
  assert.equal(out[0].seenCount, 3, 'seenCount incremented');
});

test('promoteThreads retains untouched older threads (they age out via pruneThreads)', () => {
  const threads = [{ key: 'old', title: 'Yesterday only', firstSeen: NOW - DAY, lastSeen: NOW - DAY, seenCount: 1 }];
  const out = promoteThreads(threads, [{ key: 'new', title: 'Today' }], NOW);
  assert.equal(out.length, 2);
  assert.ok(out.find((t) => t.key === 'old'));
});
