'use strict';
/**
 * Body-fetch primitives for First Read (design §4 stage 4).
 *
 * bodies.js (the script) fetches full text for the top clusters' members + longread
 * candidates via lib/zyte (hard cap 80), then uses these pure helpers to extract,
 * trim, gate, and segment. The PER-BODY QUALITY GATE is the Murder-Board-mandated
 * defense: a teaser body (short, or carrying a paywall marker) demotes that outlet to
 * headline-only for the cluster, so teaser text never reaches the writer as a body.
 * Thresholds + markers reused verbatim from the Phase-0 spike.
 *
 * Pure functions only — no I/O.
 */

const FULL_THRESHOLD = 350;   // words — confidently quotable (Phase 0)
const TEASER_THRESHOLD = 120; // words — below this it's a stub
const PAYWALL_MARKERS = /subscribe|subscription|sign in to read|already a subscriber|create an account|to continue reading|register to continue|become a (member|subscriber)|unlock this article|for subscribers/i;

// Prefer <article>; strip script/style/noscript; pull <p> text (or whole scope if
// no <p>); decode the common entities. Ported from phase0-paywall-matrix.js.
function htmlToParagraphs(html) {
  if (!html) return [];
  const h = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
                .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  const art = h.match(/<article[\s\S]*?<\/article>/i);
  const scope = art ? art[0] : h;
  const rawParas = [...scope.matchAll(/<p[\s>][\s\S]*?<\/p>/gi)].map((m) => m[0]);
  const clean = (s) => s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  if (rawParas.length) return rawParas.map(clean).filter(Boolean);
  const whole = clean(scope);
  return whole ? [whole] : [];
}

function htmlToBodyText(html) {
  return htmlToParagraphs(html).join(' ');
}

const wordCount = (s) => (s ? s.trim().split(/\s+/).filter(Boolean).length : 0);

function trimWords(text, max = 2000) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  return words.length <= max ? text : words.slice(0, max).join(' ');
}

// Decide whether a fetched body is quotable or must demote to headline-only.
function bodyQualityGate({ words, paywallMarker }, minWords = FULL_THRESHOLD) {
  if (paywallMarker) return { ok: false, demote: true, reason: `paywall marker present (${words}w)` };
  if (words < minWords) return { ok: false, demote: true, reason: `body too short: ${words}w < ${minWords} min words` };
  return { ok: true, demote: false, reason: 'full body' };
}

// Segment paragraphs into quotable units with stable IDs (candidateId + original
// paragraph index). Fragments below minWords are skipped, but indices are preserved
// so a quote_id always maps back to the same paragraph regardless of filtering.
function segmentParagraphs(paragraphs, candidateId, minWords = 8) {
  const segs = [];
  paragraphs.forEach((text, i) => {
    if (wordCount(text) >= minWords) segs.push({ quote_id: `${candidateId}_p${i}`, text });
  });
  return segs;
}

module.exports = {
  htmlToParagraphs, htmlToBodyText, trimWords, bodyQualityGate, segmentParagraphs, wordCount,
  FULL_THRESHOLD, TEASER_THRESHOLD, PAYWALL_MARKERS,
};
