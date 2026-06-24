'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { renderSkeleton, escapeHtml } = require('../lib/render');

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
