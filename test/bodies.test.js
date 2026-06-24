'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { htmlToParagraphs, htmlToBodyText, trimWords, bodyQualityGate, segmentParagraphs, FULL_THRESHOLD } = require('../lib/bodies');

const sentence = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

// ----------------------------------------------------------- html extraction

test('htmlToParagraphs pulls <p> text from within <article>, stripping tags', () => {
  const html = `<html><body><nav><p>menu thing here</p></nav>
    <article><p>First <b>real</b> paragraph of the story.</p><p>Second paragraph follows.</p></article></body></html>`;
  const paras = htmlToParagraphs(html);
  assert.deepEqual(paras, ['First real paragraph of the story.', 'Second paragraph follows.']);
});

test('htmlToBodyText joins paragraphs and counts as expected', () => {
  const html = '<article><p>alpha beta gamma</p><p>delta epsilon</p></article>';
  assert.equal(htmlToBodyText(html), 'alpha beta gamma delta epsilon');
});

test('trimWords caps the body to the word budget', () => {
  const text = sentence(3000);
  assert.equal(trimWords(text, 2000).split(/\s+/).length, 2000);
  assert.equal(trimWords('short body', 2000), 'short body');
});

// ----------------------------------------------------------- quality gate

test('bodyQualityGate passes a full clean body', () => {
  const g = bodyQualityGate({ words: FULL_THRESHOLD + 50, paywallMarker: false });
  assert.equal(g.ok, true);
  assert.equal(g.demote, false);
});

test('bodyQualityGate demotes a short teaser to headline-only', () => {
  const g = bodyQualityGate({ words: 80, paywallMarker: false });
  assert.equal(g.demote, true);
  assert.match(g.reason, /word|short|min/i);
});

test('bodyQualityGate demotes a full-length body that still shows a paywall marker', () => {
  const g = bodyQualityGate({ words: FULL_THRESHOLD + 200, paywallMarker: true });
  assert.equal(g.demote, true);
  assert.match(g.reason, /paywall/i);
});

// ----------------------------------------------------------- segmentation

test('segmentParagraphs assigns stable quote_ids tied to the candidate id', () => {
  const paras = [sentence(20), sentence(25)];
  const segs = segmentParagraphs(paras, 'c_abc123');
  assert.equal(segs.length, 2);
  assert.equal(segs[0].quote_id, 'c_abc123_p0');
  assert.equal(segs[1].quote_id, 'c_abc123_p1');
  assert.equal(segs[0].text, paras[0]);
});

test('segmentParagraphs skips fragments shorter than the min word count but keeps original indices', () => {
  const paras = [sentence(20), 'too short', sentence(15)];
  const segs = segmentParagraphs(paras, 'c_x', 8);
  assert.deepEqual(segs.map((s) => s.quote_id), ['c_x_p0', 'c_x_p2'], 'fragment p1 skipped, indices preserved');
});
