'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  looksLikeArticle,
  canonicalizeUrl,
  candidateId,
  extractCandidates,
  dedupeCandidates,
  sourcesBelowFloor,
} = require('../lib/extract');

// --------------------------------------------------------- looksLikeArticle

test('looksLikeArticle accepts slug-and-date article paths on the same host', () => {
  assert.equal(looksLikeArticle('https://www.example.com/2026/06/23/world/big-summit-talks-collapse.html', 'www.example.com'), true);
  assert.equal(looksLikeArticle('https://www.example.com/news/some-long-hyphenated-story-headline', 'www.example.com'), true);
});

test('looksLikeArticle rejects section, asset, nav, and off-host URLs', () => {
  assert.equal(looksLikeArticle('https://www.example.com/world', 'www.example.com'), false, 'one-segment section');
  assert.equal(looksLikeArticle('https://www.example.com/topic/politics', 'www.example.com'), false, 'topic hub');
  assert.equal(looksLikeArticle('https://www.example.com/assets/app.js', 'www.example.com'), false, 'asset');
  assert.equal(looksLikeArticle('https://other.com/2026/06/23/world/a-real-article-here', 'www.example.com'), false, 'off host');
});

// ----------------------------------------------------------- canonicalizeUrl

test('canonicalizeUrl strips fragments and tracking params but keeps the path', () => {
  assert.equal(
    canonicalizeUrl('https://www.example.com/2026/06/23/story-headline?utm_source=twitter&utm_medium=social#top'),
    'https://www.example.com/2026/06/23/story-headline',
  );
});

test('canonicalizeUrl keeps meaningful (non-tracking) query params', () => {
  assert.equal(
    canonicalizeUrl('https://www.example.com/article?id=42&utm_campaign=x'),
    'https://www.example.com/article?id=42',
  );
});

test('canonicalizeUrl normalizes a trailing slash and host case', () => {
  assert.equal(canonicalizeUrl('https://WWW.Example.com/path/'), 'https://www.example.com/path');
});

// -------------------------------------------------------------- candidateId

test('candidateId is stable for the same canonical URL and differs across URLs', () => {
  const a1 = candidateId('https://www.example.com/a-story');
  const a2 = candidateId('https://www.example.com/a-story');
  const b = candidateId('https://www.example.com/b-story');
  assert.equal(a1, a2, 'deterministic');
  assert.notEqual(a1, b, 'distinct urls -> distinct ids');
});

// ----------------------------------------------------------- extractCandidates

const SOURCE = {
  id: 'example',
  home: 'https://www.example.com/',
  extract: { urlRegex: null, bodySelector: null, killList: [], base: 'https://www.example.com/' },
};

const HOMEPAGE = `
<html><body>
  <nav><a href="/">Home</a><a href="/world">World</a></nav>
  <a href="/2026/06/23/world/big-summit-talks-collapse.html">Big summit talks collapse after walkout</a>
  <a href="https://www.example.com/2026/06/23/markets/oil-prices-surge-on-supply-fears.html">Oil prices surge on supply fears</a>
  <a href="/topic/politics">Politics</a>
  <a href="/static/app.js">script</a>
  <a href="/2026/06/23/world/big-summit-talks-collapse.html?utm_source=rss">Big summit talks collapse after walkout</a>
</body></html>`;

test('extractCandidates returns ordered, deduped article candidates with titles', () => {
  const cands = extractCandidates(HOMEPAGE, SOURCE);
  assert.equal(cands.length, 2, 'two unique articles (nav/section/asset excluded, tracking dup merged)');
  assert.equal(cands[0].title, 'Big summit talks collapse after walkout');
  assert.equal(cands[0].url, 'https://www.example.com/2026/06/23/world/big-summit-talks-collapse.html');
  assert.equal(cands[0].prominence, 0);
  assert.equal(cands[0].sourceId, 'example');
  assert.equal(cands[1].title, 'Oil prices surge on supply fears');
  assert.equal(cands[1].prominence, 1);
});

test('extractCandidates skips headline-less / too-short anchor text', () => {
  const html = '<a href="/2026/06/23/world/a-genuine-news-headline-here">OK go</a>'; // 5-char title
  const cands = extractCandidates(html, SOURCE);
  assert.equal(cands.length, 0, 'a 5-char anchor is nav-like, not a headline');
});

test('extractCandidates honors a per-domain urlRegex override', () => {
  const src = { ...SOURCE, extract: { ...SOURCE.extract, urlRegex: '/story/\\d+/' } };
  const html = `
    <a href="/story/12345/the-headline-text-goes-here">The headline text goes here</a>
    <a href="/2026/06/23/world/would-match-generic-but-not-regex">Would match generic but not regex</a>`;
  const cands = extractCandidates(html, src);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].url, 'https://www.example.com/story/12345/the-headline-text-goes-here');
});

// ----------------------------------------------------------- dedupeCandidates

test('dedupeCandidates merges the same canonical URL across sources', () => {
  const input = [
    { url: 'https://x.com/a-shared-story', title: 'Shared story', sourceId: 'ap', prominence: 3 },
    { url: 'https://x.com/a-shared-story', title: 'Shared story', sourceId: 'bbc', prominence: 1 },
    { url: 'https://x.com/solo-story', title: 'Solo', sourceId: 'ap', prominence: 5 },
  ];
  const out = dedupeCandidates(input);
  assert.equal(out.length, 2);
  const shared = out.find((c) => c.url === 'https://x.com/a-shared-story');
  assert.deepEqual(shared.sources.sort(), ['ap', 'bbc']);
  assert.equal(shared.prominence, 1, 'best (lowest) prominence wins');
  assert.ok(shared.id, 'has a stable id');
});

// ----------------------------------------------------------- sourcesBelowFloor

test('sourcesBelowFloor flags sources under the per-source candidate floor', () => {
  const counts = { ap: 12, bbc: 0, ft: 3, haaretz: 0 };
  assert.deepEqual(sourcesBelowFloor(counts, 1).sort(), ['bbc', 'haaretz']);
});
