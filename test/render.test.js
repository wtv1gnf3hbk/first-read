'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { renderSkeleton, escapeHtml, renderBriefing, renderDegraded } = require('../lib/render');

test('escapeHtml neutralizes angle brackets, ampersands, and quotes', () => {
  assert.equal(escapeHtml('<a href="x">A & B</a>'), '&lt;a href=&quot;x&quot;&gt;A &amp; B&lt;/a&gt;');
});

test('renderSkeleton produces a mobile-first page listing candidate links', () => {
  const html = renderSkeleton([
    { id: 'c_1', title: 'Big summit talks collapse', url: 'https://x.com/summit', sources: ['ap', 'bbc'] },
    { id: 'c_2', title: 'Oil prices surge', url: 'https://x.com/oil', sources: ['reuters'] },
  ], { generatedAt: '2026-06-23T09:25:00Z' });

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<meta name="viewport"/i, 'mobile-first viewport');
  assert.match(html, /prefers-color-scheme/i, 'dark-mode support');
  assert.match(html, /Big summit talks collapse/);
  assert.match(html, /href="https:\/\/x\.com\/summit"/);
  assert.match(html, /Oil prices surge/);
  assert.match(html, /SKELETON|skeleton/, 'banner marks this as a non-final skeleton page');
});

test('renderSkeleton escapes titles to prevent markup injection', () => {
  const html = renderSkeleton([{ id: 'c_x', title: 'A <script>alert(1)</script> headline', url: 'https://x.com/a', sources: ['ap'] }]);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('renderSkeleton handles an empty candidate list without throwing', () => {
  const html = renderSkeleton([]);
  assert.match(html, /<!doctype html>/i);
});

// ---- renderBriefing (full three-layer) -------------------------------------

function briefingFixture() {
  const bodies = {
    clusters: [{ bodies: [{ id: 'c_1', sourceId: 'ap', quotable: true,
      quotes: [{ quote_id: 'c_1_p0', text: 'The summit collapsed after a walkout.' }] }] }],
    longreads: [],
  };
  const briefing = {
    generatedAt: '2026-06-23T09:25:00Z',
    spine: [{ headline: 'Summit collapses', text: 'Leaders left the table.', link_url: 'https://ap.org/summit', novelty: { tag: 'new' } }],
    worth: [{ synthesis: 'Why it matters.', quote_id: 'c_1_p0', attribution: 'AP', link_url: 'https://ap.org/summit' }],
    ticker: [{ text: 'A smaller story', url: 'https://bbc.com/x' }],
    longreads: [{ title: 'A long piece', url: 'https://newyorker.com/lp', why: 'Worth the time.' }],
  };
  return { briefing, bodies };
}

test('renderBriefing inserts the EXACT quote text resolved by quote_id (writer never types it)', () => {
  const { briefing, bodies } = briefingFixture();
  const html = renderBriefing(briefing, { bodies });
  assert.match(html, /wk-card/, 'worth-your-time renders as a quote card');
  assert.match(html, /The summit collapsed after a walkout\./, 'exact segment text inserted');
  assert.match(html, /Summit collapses/, 'spine headline');
  assert.match(html, /A smaller story/, 'ticker item');
  assert.match(html, /A long piece/, 'longread');
  assert.match(html, /prefers-color-scheme/);
});

test('renderBriefing skips a worth card whose quote_id cannot be resolved, without leaking the id', () => {
  const { briefing, bodies } = briefingFixture();
  briefing.worth[0].quote_id = 'c_1_pX';
  const html = renderBriefing(briefing, { bodies });
  assert.doesNotMatch(html, /c_1_pX/, 'unresolved id never leaks into the page');
});

test('renderBriefing escapes prose to prevent markup injection', () => {
  const { briefing, bodies } = briefingFixture();
  briefing.spine[0].text = 'Danger <script>alert(1)</script>';
  const html = renderBriefing(briefing, { bodies });
  assert.doesNotMatch(html, /<script>alert/);
});

// ---- renderDegraded ---------------------------------------------------------

test('renderDegraded shows a banner with the reason and lists candidate links', () => {
  const html = renderDegraded([{ title: 'Story one', url: 'https://ap.org/a' }], 'quote integrity failed (F1)');
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /quote integrity failed \(F1\)/);
  assert.match(html, /Story one/);
  assert.match(html, /href="https:\/\/ap\.org\/a"/);
  assert.match(html, /degraded|reduced|links only/i);
});
