'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validate, normalizeForMatch } = require('../lib/validate');

// ---- shared fixtures --------------------------------------------------------
function fixtures() {
  const bodies = {
    clusters: [{
      lead: { id: 'c_1', url: 'https://ap.org/summit', title: 'Summit collapses' },
      bodies: [{
        id: 'c_1', url: 'https://ap.org/summit', sourceId: 'ap', quotable: true, words: 400,
        body: 'The summit collapsed after a walkout. Officials said losses reached $40 billion this year.',
        quotes: [
          { quote_id: 'c_1_p0', text: 'The summit collapsed after a walkout.' },
          { quote_id: 'c_1_p1', text: 'Officials said losses reached $40 billion this year.' },
        ],
      }],
    }],
    longreads: [],
  };
  const candidates = [
    { id: 'c_1', url: 'https://ap.org/summit', sources: ['ap'] },
    { id: 'c_2', url: 'https://bbc.com/other', sources: ['bbc'] },
    { id: 'c_3', url: 'https://bbc.com/three', sources: ['bbc'] },
    { id: 'c_4', url: 'https://bbc.com/four', sources: ['bbc'] },
    { id: 'c_5', url: 'https://bbc.com/five', sources: ['bbc'] },
    { id: 'c_6', url: 'https://bbc.com/six', sources: ['bbc'] },
    { id: 'c_7', url: 'https://bbc.com/seven', sources: ['bbc'] },
  ];
  // 6 spine items (within the 6-8 target). Only the first carries citations/figures;
  // the rest are clean headline-only items so the happy path stays free of F3/F4.
  const spine = [
    { headline: 'Summit collapses', text: 'The summit collapsed after a walkout. AP put losses at $40 billion.',
      link_url: 'https://ap.org/summit', citations: [{ outlet: 'ap', figures: ['$40 billion'] }], novelty: { tag: 'new' } },
    { headline: 'Two', text: 'A second notable story broke today.', link_url: 'https://bbc.com/three', citations: [], novelty: { tag: 'new' } },
    { headline: 'Three', text: 'A third story developed this morning.', link_url: 'https://bbc.com/four', citations: [], novelty: { tag: 'new' } },
    { headline: 'Four', text: 'A fourth thing happened overnight.', link_url: 'https://bbc.com/five', citations: [], novelty: { tag: 'new' } },
    { headline: 'Five', text: 'A fifth report emerged from the region.', link_url: 'https://bbc.com/six', citations: [], novelty: { tag: 'new' } },
    { headline: 'Six', text: 'A sixth item rounds out the spine today.', link_url: 'https://bbc.com/seven', citations: [], novelty: { tag: 'new' } },
  ];
  const briefing = {
    spine,
    worth: [{ synthesis: 'A closer look at the talks.', quote_id: 'c_1_p0', attribution: 'AP', link_url: 'https://ap.org/summit' }],
    ticker: [{ text: 'Something else happened today', url: 'https://bbc.com/other' }],
    longreads: [],
  };
  return { briefing, bodies, candidates };
}

const codes = (list) => list.map((e) => e.code);

// ---- the happy path ---------------------------------------------------------

test('a well-formed briefing passes with no errors or warnings', () => {
  const { briefing, bodies, candidates } = fixtures();
  const r = validate(briefing, { bodies, candidates });
  assert.deepEqual(r.errors, [], `unexpected errors: ${JSON.stringify(r.errors)}`);
  assert.deepEqual(r.warnings, [], `unexpected warnings: ${JSON.stringify(r.warnings)}`);
});

// ---- fatal gates ------------------------------------------------------------

test('F1 quote integrity: a quote_id with no matching segment is fatal', () => {
  const { briefing, bodies, candidates } = fixtures();
  briefing.worth[0].quote_id = 'c_1_p99';
  assert.ok(codes(validate(briefing, { bodies, candidates }).errors).includes('F1'));
});

test('F2 link integrity: a link not in candidates or bodies is fatal', () => {
  const { briefing, bodies, candidates } = fixtures();
  briefing.ticker[0].url = 'https://malicious.example/injected';
  assert.ok(codes(validate(briefing, { bodies, candidates }).errors).includes('F2'));
});

test('F3 citation integrity: citing an outlet with no real body is fatal', () => {
  const { briefing, bodies, candidates } = fixtures();
  briefing.spine[0].citations = [{ outlet: 'wsj', figures: [] }]; // wsj has no body
  assert.ok(codes(validate(briefing, { bodies, candidates }).errors).includes('F3'));
});

test('F4 figure-attribution: a figure not in the cited body is fatal', () => {
  const { briefing, bodies, candidates } = fixtures();
  briefing.spine[0].citations = [{ outlet: 'ap', figures: ['$99 billion'] }]; // not in AP body
  assert.ok(codes(validate(briefing, { bodies, candidates }).errors).includes('F4'));
});

test('F4 matches the figure NUMBERS, not the whole descriptive phrase (no false positive)', () => {
  const { briefing, bodies, candidates } = fixtures();
  // Body has the numbers; the cited phrase adds descriptive words that are not contiguous.
  bodies.clusters[0].bodies[0].body = 'The card ships with 8GB of dedicated DDR6 VRAM at launch.';
  briefing.spine[0].citations = [{ outlet: 'ap', figures: ['8GB dedicated DDR6 VRAM'] }];
  assert.ok(!codes(validate(briefing, { bodies, candidates }).errors).includes('F4'), 'numbers present → no false F4');
});

test('F4 still fires when a cited figure phrase carries a number absent from the body', () => {
  const { briefing, bodies, candidates } = fixtures();
  briefing.spine[0].citations = [{ outlet: 'ap', figures: ['65 percent said the wrong track'] }]; // 65 percent not in AP body
  assert.ok(codes(validate(briefing, { bodies, candidates }).errors).includes('F4'));
});

test('F4 ignores a citation figure that contains no number (nothing to verify)', () => {
  const { briefing, bodies, candidates } = fixtures();
  briefing.spine[0].citations = [{ outlet: 'ap', figures: ['a major escalation'] }];
  assert.ok(!codes(validate(briefing, { bodies, candidates }).errors).includes('F4'));
});

test('F5 same-story-twice: two spine items sharing a link is fatal', () => {
  const { briefing, bodies, candidates } = fixtures();
  briefing.spine.push({ ...briefing.spine[0] });
  assert.ok(codes(validate(briefing, { bodies, candidates }).errors).includes('F5'));
});

// ---- advisory gates ---------------------------------------------------------

test('A1 word budget: a briefing over 1200 words warns (longreads exempt)', () => {
  const { briefing, bodies, candidates } = fixtures();
  briefing.spine[0].text = Array.from({ length: 1300 }, (_, i) => `w${i}`).join(' ');
  briefing.spine[0].citations = []; // avoid F4 noise from the filler
  assert.ok(codes(validate(briefing, { bodies, candidates }).warnings).includes('A1'));
});

test('A2 layer counts: too many ticker items warns', () => {
  const { briefing, bodies, candidates } = fixtures();
  briefing.ticker = Array.from({ length: 12 }, () => ({ text: 'a ticker line here', url: 'https://ap.org/summit' }));
  assert.ok(codes(validate(briefing, { bodies, candidates }).warnings).includes('A2'));
});

test('A3 style: an "amid" and an is/has ’s-contraction warn', () => {
  const { briefing, bodies, candidates } = fixtures();
  briefing.spine[0].text = "Disney's named a new chief amid the turmoil.";
  briefing.spine[0].citations = [];
  assert.ok(codes(validate(briefing, { bodies, candidates }).warnings).includes('A3'));
});

test('A4 a rehash/development spine item must lead with its delta', () => {
  const { briefing, bodies, candidates } = fixtures();
  briefing.spine[0].novelty = { tag: 'development', delta: 'court issued a ruling' };
  briefing.spine[0].text = 'Background that has been true for weeks, with no new development up front.';
  assert.ok(codes(validate(briefing, { bodies, candidates }).warnings).includes('A4'));
});

// ---- normalizeForMatch ------------------------------------------------------

test('normalizeForMatch collapses curly quotes, dashes, and case for comparison', () => {
  assert.equal(normalizeForMatch('The “Summit” — Collapsed'), normalizeForMatch('the "summit" - collapsed'));
});
