'use strict';
/**
 * Validation gates for First Read (design §7; rule #11: prose rules need code gates).
 *
 * Two tiers over the structured briefing + its bodies/candidates:
 *   FATAL (errors → exit 1, triggers the one write retry, then degraded publish):
 *     F1 quote integrity   — every worth-item quote_id resolves to a real segment.
 *     F2 link integrity     — every URL exists in candidates or a fetched body.
 *     F3 citation integrity — a cited outlet must have a REAL (quotable) body.
 *     F4 figure-attribution — a figure attributed to an outlet must appear (normalized)
 *                             in that outlet's fetched body. The worst-failure guard.
 *     F5 same story twice   — no two spine items share a link.
 *   ADVISORY (warnings → exit 2, publish with notes):
 *     A1 word budget ≤ 1200 (longreads exempt)   A2 layer counts
 *     A3 style regexes (’s-contraction, amid, em-dash run-on, AI-telltale)
 *     A4 development/rehash spine items must lead with the delta.
 *
 * Pure: validate(briefing, { bodies, candidates }) → { errors, warnings }.
 */

const { canonicalizeUrl } = require('./extract');

// Collapse quote/dash/space variants + case so a verbatim check isn't tripped by
// typography. Ported from news-briefing/validate-draft.js:1160.
function normalizeForMatch(text) {
  const SQ = String.fromCharCode(39);
  return String(text)
    .replace(/[‘’‚‛]/g, SQ)
    .replace(/[“”„‟]/g, SQ)
    .replace(/"/g, SQ)
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, SQ).replace(/&#34;/g, SQ)
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

// Index the bodies doc once: quote_id→text, valid URL set, outlet→body text, and
// the set of outlets that supplied a real (quotable) body.
function buildBodyIndex(bodies) {
  const quoteById = new Map();
  const urlSet = new Set();
  const outletBody = new Map();
  const outletsWithBody = new Set();
  const all = [...((bodies && bodies.clusters) || []).flatMap((c) => c.bodies || []), ...((bodies && bodies.longreads) || [])];
  for (const b of all) {
    if (b.url) urlSet.add(canonicalizeUrl(b.url));
    (b.quotes || []).forEach((q) => quoteById.set(q.quote_id, q.text));
    if (b.quotable && b.sourceId) {
      outletsWithBody.add(b.sourceId);
      outletBody.set(b.sourceId, (outletBody.get(b.sourceId) || '') + ' ' + (b.body || ''));
    }
  }
  return { quoteById, urlSet, outletBody, outletsWithBody };
}

const wordCount = (s) => (s ? String(s).trim().split(/\s+/).filter(Boolean).length : 0);

// Numerals/figures in a sentence: $40 billion, 12,000, 3.5%, 40bn, plain integers.
function figuresIn(text) {
  return (String(text).match(/\$?\d[\d,.]*\s?(?:billion|million|trillion|bn|m|k|%|percent)?/gi) || [])
    .map((s) => s.trim()).filter((s) => /\d/.test(s));
}

function validate(briefing, { bodies, candidates } = {}) {
  const errors = [];
  const warnings = [];
  const idx = buildBodyIndex(bodies);
  const E = (code, message) => errors.push({ code, message });
  const W = (code, message) => warnings.push({ code, message });

  const spine = briefing.spine || [];
  const worth = briefing.worth || [];
  const ticker = briefing.ticker || [];
  const longreads = briefing.longreads || [];

  // Valid URL universe = candidate URLs ∪ fetched body URLs (both canonicalized).
  const validUrls = new Set(idx.urlSet);
  for (const c of candidates || []) if (c.url) validUrls.add(canonicalizeUrl(c.url));

  // ---- F1 quote integrity ----
  for (const w of worth) {
    if (!w.quote_id || !idx.quoteById.has(w.quote_id)) {
      E('F1', `worth item references unknown quote_id "${w.quote_id}"`);
    }
  }

  // ---- F2 link integrity ----
  const allLinks = [
    ...spine.map((s) => s.link_url),
    ...worth.map((w) => w.link_url),
    ...ticker.map((t) => t.url),
    ...longreads.map((l) => l.url),
  ].filter(Boolean);
  for (const url of allLinks) {
    if (!validUrls.has(canonicalizeUrl(url))) E('F2', `link not found in candidates or bodies: ${url}`);
  }

  // ---- F3 citation integrity + F4 figure attribution ----
  for (const s of spine) {
    for (const cite of s.citations || []) {
      if (!idx.outletsWithBody.has(cite.outlet)) {
        E('F3', `spine cites "${cite.outlet}" but that outlet has no quotable body`);
        continue; // can't check figures without a body
      }
      const body = normalizeForMatch(idx.outletBody.get(cite.outlet) || '');
      for (const fig of cite.figures || []) {
        // Verify the figure's NUMBERS appear in the body — not the whole descriptive
        // phrase (the writer pads figures with words like "dedicated DDR6 VRAM" that
        // are not contiguous in the body). A figure with no number has nothing to verify.
        const nums = figuresIn(fig);
        if (nums.length === 0) continue;
        const missing = nums.find((n) => !body.includes(normalizeForMatch(n)));
        if (missing) E('F4', `figure "${fig}" (${missing}) attributed to ${cite.outlet} not found in its body`);
      }
    }
  }

  // ---- F5 same story twice ----
  const seenLinks = new Set();
  for (const s of spine) {
    const u = s.link_url ? canonicalizeUrl(s.link_url) : null;
    if (u && seenLinks.has(u)) E('F5', `same story appears twice in the spine: ${s.link_url}`);
    if (u) seenLinks.add(u);
  }

  // ---- A1 word budget (spine + worth + ticker; longreads exempt) ----
  const budgetWords = spine.reduce((n, s) => n + wordCount(s.text), 0) +
    worth.reduce((n, w) => n + wordCount(w.synthesis), 0) +
    ticker.reduce((n, t) => n + wordCount(t.text), 0);
  if (budgetWords > 1200) W('A1', `word budget ${budgetWords} exceeds 1200`);

  // ---- A2 layer counts ----
  if (spine.length < 5 || spine.length > 8) W('A2', `spine has ${spine.length} items (target 6-8)`);
  if (worth.length > 3) W('A2', `worth-your-time has ${worth.length} items (max 3)`);
  if (ticker.length > 8) W('A2', `ticker has ${ticker.length} items (max 8)`);

  // ---- A3 style ----
  const styleText = [...spine.map((s) => s.text), ...worth.map((w) => w.synthesis), ...ticker.map((t) => t.text)].join(' ');
  if (/\bamid\b/i.test(styleText)) W('A3', 'banned word "amid"');
  // ’s-contraction for is/has: a capitalized noun + "'s" + verb/article (heuristic).
  if (/\b[A-Z][a-z]+'s\s+(named|said|announced|a|an|the|now|been|set|expected)\b/.test(styleText)) {
    W('A3', "possible is/has ’s-contraction (e.g. \"Disney's named\")");
  }
  if (/\bAs an AI\b|\bIt'?s worth noting\b|\bIn conclusion\b|\bdelve\b/i.test(styleText)) W('A3', 'AI-telltale phrasing');

  // ---- A4 development/rehash must lead with the delta ----
  for (const s of spine) {
    const tag = s.novelty && s.novelty.tag;
    const delta = s.novelty && s.novelty.delta;
    if ((tag === 'development' || tag === 'rehash') && delta) {
      const lead = normalizeForMatch((s.text || '').split(/[.!?]/)[0]);
      if (!lead.includes(normalizeForMatch(delta).slice(0, 20))) {
        W('A4', `${tag} spine item does not lead with its delta ("${delta}")`);
      }
    }
  }

  return { errors, warnings };
}

module.exports = { validate, normalizeForMatch, buildBodyIndex, figuresIn };
