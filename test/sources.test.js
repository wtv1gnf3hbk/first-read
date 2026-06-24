'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const sources = require(path.join(__dirname, '..', 'sources.json'));

const isUrl = (s) => { try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } };

test('sources.json is a non-empty array', () => {
  assert.ok(Array.isArray(sources), 'top level is an array');
  assert.ok(sources.length >= 30, `expected >=30 sources, got ${sources.length}`);
});

test('every source has the required common fields', () => {
  for (const s of sources) {
    assert.equal(typeof s.id, 'string', `id missing on ${JSON.stringify(s)}`);
    assert.ok(s.id.length > 0, 'id non-empty');
    assert.equal(typeof s.name, 'string', `name missing on ${s.id}`);
    assert.ok([1, 2].includes(s.tier), `${s.id}: tier must be 1 or 2`);
    assert.equal(typeof s.vertical, 'string', `${s.id}: vertical missing`);
  }
});

test('ids are unique', () => {
  const ids = sources.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate id present');
});

test('each source is exactly quotable XOR headline_only', () => {
  for (const s of sources) {
    const q = s.quotable === true;
    const h = s.headline_only === true;
    assert.ok(q !== h, `${s.id}: must be exactly one of quotable / headline_only`);
  }
});

test('tier-1 outlets have a valid Zyte fetch config', () => {
  for (const s of sources.filter((x) => x.tier === 1)) {
    assert.ok(isUrl(s.home), `${s.id}: home must be an http(s) URL`);
    assert.equal(s.fetch, 'zyte', `${s.id}: tier-1 fetch must be 'zyte'`);
    assert.ok(['raw', 'browser'].includes(s.zyteMode), `${s.id}: zyteMode must be raw|browser`);
    assert.equal(typeof s.extract, 'object', `${s.id}: extract config missing`);
    assert.ok('urlRegex' in s.extract, `${s.id}: extract.urlRegex key present (may be null)`);
    assert.ok('bodySelector' in s.extract, `${s.id}: extract.bodySelector key present (may be null)`);
    assert.ok(Array.isArray(s.extract.killList), `${s.id}: extract.killList is an array`);
    assert.ok(isUrl(s.extract.base), `${s.id}: extract.base is a URL`);
  }
});

test('tier-2 voices (if any) fetch via RSS with a feed URL', () => {
  for (const s of sources.filter((x) => x.tier === 2)) {
    assert.equal(s.fetch, 'rss', `${s.id}: tier-2 fetch must be 'rss'`);
    assert.ok(isUrl(s.feed), `${s.id}: feed must be an http(s) URL`);
  }
});

test('Phase-0 dispositions are encoded correctly', () => {
  const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
  // Confirmed quotable (Phase 0):
  for (const id of ['bbc', 'ap', 'lemonde', 'theverge', 'arstechnica', 'wired', 'naturenews', 'nikkei', 'newyorker', 'stat']) {
    assert.equal(byId[id] && byId[id].quotable, true, `${id} should be quotable`);
  }
  // Headline-only (paywall / forbidden / Option-5):
  for (const id of ['nyt', 'ft', 'wsj', 'bloomberg', 'economist', 'wapo', 'haaretz', 'theinformation', 'guardian']) {
    assert.equal(byId[id] && byId[id].headline_only, true, `${id} should be headline_only`);
  }
});

test('outlets the generic heuristic mis-read carry a needsExtractConfig flag', () => {
  const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
  // Free outlets + ambiguous-metered ones that need per-domain config tuned in burn-in
  // (phase0-results.md): do NOT ship headline-only verdicts off run-2's generic numbers.
  for (const id of ['reuters', 'aljazeera', 'politico', 'npr', 'propublica', 'quanta', 'scmp', 'science', 'spiegel', 'atlantic']) {
    assert.equal(byId[id] && byId[id].needsExtractConfig, true, `${id} should be flagged needsExtractConfig`);
  }
});
