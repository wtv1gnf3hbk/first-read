'use strict';
/**
 * Generic-by-default candidate extraction for First Read (design §4 stage 2).
 *
 * Pulls article candidates from a source's homepage HTML using an article-URL-shape
 * heuristic (ported from phase0-paywall-matrix.js `looksLikeArticle`) plus a
 * headline-like-anchor heuristic for titles. Per-domain overrides come from
 * sources.json (`extract.urlRegex`). Prominence = DOM order. URLs are canonicalized
 * (tracking params + fragments stripped) and deduped within and across sources.
 *
 * Pure functions only — no I/O. The extract.js script feeds these saved homepage
 * HTML and writes candidates.json.
 */

const crypto = require('node:crypto');

const MIN_TITLE_LEN = 15; // anchors shorter than this are nav, not headlines

// Tracking query params to drop during canonicalization (dedup-defeating noise).
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|mc_|ref$|cmp$|cmpid$|ito$|smid$|partner$|cmpid$|igshid$|_hsenc$|_hsmi$)/i;

// Section / asset / nav path prefixes that are never articles (from phase0).
const NON_ARTICLE_PREFIX = /^\/(tag|tags|topic|topics|category|categories|author|authors|video|videos|live|podcast|podcasts|newsletter|newsletters|about|contact|subscribe|account|search|section|sections|sitemap|page|interactive|graphics|games|crossword|cooking|wirecutter)\b/i;
const ASSET_PATH = /\/_next\/|\/static\/|\.(css|js|json|png|jpe?g|svg|webp|ico|woff2?|xml|rss|pdf)$/i;

// Same-host link whose path looks like an article slug (>=2 hyphens in the last
// segment) or carries a date path. Errs toward precision so hubs aren't counted.
function looksLikeArticle(clean, homeHost) {
  let u;
  try { u = new URL(clean); } catch { return false; }
  if (u.host !== homeHost) return false;
  const p = u.pathname;
  if (ASSET_PATH.test(p)) return false;
  if (NON_ARTICLE_PREFIX.test(p)) return false;
  const segs = p.split('/').filter(Boolean);
  if (segs.length < 2) return false;
  const last = segs[segs.length - 1];
  const hyphens = (last.match(/-/g) || []).length;
  const hasDate = /\/\d{4}\/\d{1,2}\//.test(p) || /\d{4}-\d{2}-\d{2}/.test(p);
  return hyphens >= 2 || (hasDate && last.length > 8) || last.length >= 28;
}

// Canonical URL for dedup + stable IDs: lowercase host, drop fragment, drop
// tracking params (keep meaningful ones), strip a trailing slash (except root).
function canonicalizeUrl(url) {
  let u;
  try { u = new URL(url); } catch { return url; }
  u.hash = '';
  u.host = u.host.toLowerCase();
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
  }
  // Strip a trailing slash (except on the root path) so "/path" and "/path/" dedup.
  if (u.pathname !== '/' && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '');
  }
  return u.toString();
}

// Stable per-candidate ID from the canonical URL. Survives across runs so diff.js
// can thread stories and quote IDs stay stable.
function candidateId(canonicalUrl) {
  return 'c_' + crypto.createHash('sha1').update(canonicalUrl).digest('hex').slice(0, 10);
}

// Strip tags/entities from anchor inner HTML to get plain headline text.
function anchorText(inner) {
  return inner
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Extract ordered article candidates from homepage HTML for one source.
// Returns [{ url(canonical), title, sourceId, prominence }] in DOM order, deduped
// within the source by canonical URL. urlRegex override wins over the generic heuristic.
function extractCandidates(html, source) {
  const base = (source.extract && source.extract.base) || source.home;
  const homeHost = new URL(source.home).host;
  const re = source.extract && source.extract.urlRegex ? new RegExp(source.extract.urlRegex) : null;

  const out = [];
  const seen = new Set();
  // Match anchors with inner content: <a ... href="X" ...>TITLE</a>. Non-greedy
  // inner; good enough for homepages (anchors rarely nest anchors).
  const anchorRe = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    let href = m[1];
    const title = anchorText(m[2]);
    if (href.startsWith('/')) {
      try { href = new URL(href, base).href; } catch { continue; }
    }
    if (!href.startsWith('http')) continue;
    const clean = canonicalizeUrl(href);
    if (seen.has(clean)) continue;
    const match = re ? re.test(clean) : looksLikeArticle(clean, homeHost);
    if (!match) continue;
    if (title.length < MIN_TITLE_LEN) continue; // headline-like-anchor heuristic
    seen.add(clean);
    out.push({ url: clean, title, sourceId: source.id, prominence: out.length });
  }
  return out;
}

// Merge candidates sharing a canonical URL across sources. Keeps the best (lowest)
// prominence, unions the source ids, takes the first non-empty title, assigns IDs.
function dedupeCandidates(candidates) {
  const byUrl = new Map();
  for (const c of candidates) {
    const existing = byUrl.get(c.url);
    if (!existing) {
      byUrl.set(c.url, { id: candidateId(c.url), url: c.url, title: c.title, sources: [c.sourceId], prominence: c.prominence });
    } else {
      if (!existing.sources.includes(c.sourceId)) existing.sources.push(c.sourceId);
      if (c.prominence < existing.prominence) existing.prominence = c.prominence;
      if (!existing.title && c.title) existing.title = c.title;
    }
  }
  return [...byUrl.values()];
}

// Which sources produced fewer than `floor` candidates (flagged for last-run-status).
function sourcesBelowFloor(perSourceCounts, floor = 1) {
  return Object.entries(perSourceCounts).filter(([, n]) => n < floor).map(([id]) => id);
}

module.exports = {
  looksLikeArticle, canonicalizeUrl, candidateId, anchorText,
  extractCandidates, dedupeCandidates, sourcesBelowFloor,
  MIN_TITLE_LEN,
};
