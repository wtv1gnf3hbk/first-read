'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseRssItems, checkSourceFloor } = require('../lib/fetch');

// ------------------------------------------------------------- parseRssItems

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Feed</title>
  <item>
    <title><![CDATA[Markets wobble as bond yields jump]]></title>
    <link>https://voice.example.com/markets-wobble?utm_source=feed</link>
    <pubDate>Mon, 23 Jun 2026 09:00:00 GMT</pubDate>
  </item>
  <item>
    <title>A plain title without cdata</title>
    <link>https://voice.example.com/plain-title</link>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom entry headline here</title>
    <link href="https://atom.example.com/entry-one" rel="alternate"/>
  </entry>
</feed>`;

test('parseRssItems reads RSS item title (incl. CDATA) and link', () => {
  const items = parseRssItems(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Markets wobble as bond yields jump');
  assert.equal(items[0].url, 'https://voice.example.com/markets-wobble?utm_source=feed');
  assert.equal(items[1].title, 'A plain title without cdata');
});

test('parseRssItems reads Atom entry title and link href', () => {
  const items = parseRssItems(ATOM);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Atom entry headline here');
  assert.equal(items[0].url, 'https://atom.example.com/entry-one');
});

test('parseRssItems returns [] on junk input', () => {
  assert.deepEqual(parseRssItems('<html>not a feed</html>'), []);
});

// ----------------------------------------------------------- checkSourceFloor

test('checkSourceFloor passes when enough sources and candidates succeed', () => {
  const r = checkSourceFloor({ tier1Succeeded: 25, tier1Total: 30, candidateCount: 200, yesterdayCount: 220 });
  assert.equal(r.ok, true);
});

test('checkSourceFloor aborts when too few Tier-1 fetches succeed', () => {
  const r = checkSourceFloor({ tier1Succeeded: 12, tier1Total: 30, candidateCount: 200, yesterdayCount: 220 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /12\/30|Tier-1/);
});

test('checkSourceFloor aborts when candidate count collapses below 60% of yesterday', () => {
  const r = checkSourceFloor({ tier1Succeeded: 25, tier1Total: 30, candidateCount: 100, yesterdayCount: 220 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /60%|candidate/i);
});

test('checkSourceFloor does not apply the 60% rule on a cold start (no yesterday)', () => {
  const r = checkSourceFloor({ tier1Succeeded: 25, tier1Total: 30, candidateCount: 5, yesterdayCount: 0 });
  assert.equal(r.ok, true, 'first run has no baseline to compare against');
});
