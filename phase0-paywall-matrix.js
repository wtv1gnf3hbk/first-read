#!/usr/bin/env node
/**
 * First Read — Phase 0 paywall verification spike.
 *
 * THE QUESTION: Zyte defeats anti-bot walls, not subscriber paywalls (it has no
 * subscriber session). So for the financial / hard-paywall Tier-1 outlets, does
 * Zyte hand us a real article body we can QUOTE, or just teaser HTML?
 *
 * METHOD (per design doc §11):
 *   1. For each outlet, Zyte-fetch the homepage (browser mode) and pull 3 fresh
 *      article URLs with a generic, per-domain URL-shape regex (the same
 *      "generic-by-default extraction" the real pipeline will use).
 *   2. For each article URL, run Zyte ARTICLE extraction twice:
 *        - raw    : extractFrom = httpResponseBody  (cheap, no render)
 *        - browser: extractFrom = browserHtml       (renders JS, pricier)
 *   3. Record extracted body word count + paywall-marker hits for each.
 *   4. Emit a matrix (JSON + printed table) classifying each outlet:
 *        FULL (quotable)  /  PARTIAL  /  TEASER (headline-only)  /  FAIL
 *
 * Zyte contract (verified in news-briefing 2026-06-05):
 *   POST https://api.zyte.com/v1/extract  — Basic auth: <key>: (empty password)
 *   Body for article extraction:
 *     { url, article: true, articleOptions: { extractFrom: "httpResponseBody"|"browserHtml" } }
 *   Body for raw homepage HTML:
 *     { url, browserHtml: true }   (rendered)  or  { url, httpResponseBody: true } (raw)
 *
 * No deps — https + regex only. Reads ZYTE_API_KEY from env.
 * Output: docs/phase0-matrix.json  + a printed table.
 */

'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

// ---- config -------------------------------------------------------------

// The paywall suspects named in the design doc, plus two free controls
// (guardian, bbc) to prove the extraction pipeline itself works.
// Run 2 (2026-06-23): the presumed-free Tier-1 list + Nikkei re-test + NYT-via-Zyte
// data point. `re: null` => use the generic article-link heuristic (the design's
// "generic-by-default extraction"), so we don't hand-author 24 per-site regexes.
// (The hard-paywall outlets were settled in run 1 — see phase0-results.md.)
const OUTLETS = [
  { id: 'nyt',             home: 'https://www.nytimes.com/',            re: null }, // metered — Zyte-fallback data point; primary path is nyt-mcp
  { id: 'reuters',         home: 'https://www.reuters.com/',            re: null },
  { id: 'ap',              home: 'https://apnews.com/',                 re: null },
  { id: 'aljazeera',       home: 'https://www.aljazeera.com/',          re: null },
  { id: 'nikkei',          home: 'https://asia.nikkei.com/',            re: null }, // re-test (run 1 matched a CSS asset)
  { id: 'scmp',            home: 'https://www.scmp.com/',               re: null },
  { id: 'spiegel',         home: 'https://www.spiegel.de/international/',re: null },
  { id: 'lemonde',         home: 'https://www.lemonde.fr/en/',          re: null },
  { id: 'kyivindependent', home: 'https://kyivindependent.com/',        re: null },
  { id: 'semafor',         home: 'https://www.semafor.com/',            re: null },
  { id: 'restofworld',     home: 'https://restofworld.org/',            re: null },
  { id: 'politico',        home: 'https://www.politico.com/',           re: null },
  { id: 'axios',           home: 'https://www.axios.com/',              re: null },
  { id: 'npr',             home: 'https://www.npr.org/sections/news/',  re: null },
  { id: 'propublica',      home: 'https://www.propublica.org/',         re: null },
  { id: 'theverge',        home: 'https://www.theverge.com/',           re: null },
  { id: 'arstechnica',     home: 'https://arstechnica.com/',            re: null },
  { id: 'wired',           home: 'https://www.wired.com/',              re: null },
  { id: 'stat',            home: 'https://www.statnews.com/',           re: null },
  { id: 'naturenews',      home: 'https://www.nature.com/news',         re: null },
  { id: 'quanta',          home: 'https://www.quantamagazine.org/',     re: null },
  { id: 'science',         home: 'https://www.science.org/news',        re: null },
  { id: 'atlantic',        home: 'https://www.theatlantic.com/',        re: null },
  { id: 'newyorker',       home: 'https://www.newyorker.com/',          re: null },
];

const ARTICLES_PER_OUTLET = 3;
const CONCURRENCY = 5;
const PAYWALL_MARKERS = /subscribe|subscription|sign in to read|already a subscriber|create an account|to continue reading|register to continue|become a (member|subscriber)|unlock this article|for subscribers/i;
const FULL_THRESHOLD = 350;     // words — confidently quotable
const TEASER_THRESHOLD = 120;   // words — below this it's a stub

// ---- zyte ---------------------------------------------------------------

function zyte(body) {
  return new Promise((resolve, reject) => {
    const key = process.env.ZYTE_API_KEY;
    if (!key) { reject(new Error('ZYTE_API_KEY not set')); return; }
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.zyte.com',
      path: '/v1/extract',
      method: 'POST',
      auth: `${key}:`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 160)}`)); return; }
        try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error(`parse: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(90000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload); req.end();
  });
}

const wc = (s) => (s ? s.trim().split(/\s+/).filter(Boolean).length : 0);

// Generic article-link heuristic (used when outlet.re is null): same-host link whose
// path has a slug-like final segment (≥2 hyphens) or a date path — the shape almost
// every news article URL takes, across very different CMSes. Errs toward precision so
// we don't count section/hub pages as "articles."
function looksLikeArticle(clean, homeHost) {
  let u;
  try { u = new URL(clean); } catch { return false; }
  if (u.host !== homeHost) return false;
  const p = u.pathname;
  if (/\/_next\/|\.(css|js|json|png|jpe?g|svg|webp|ico|woff2?|xml|rss|pdf)$/i.test(p)) return false;
  if (/^\/(tag|tags|topic|topics|category|categories|author|authors|video|videos|live|podcast|podcasts|newsletter|newsletters|about|contact|subscribe|account|search|section|sitemap|page|interactive|graphics|games|crossword|cooking|wirecutter)\b/i.test(p)) return false;
  const segs = p.split('/').filter(Boolean);
  if (segs.length < 2) return false;
  const last = segs[segs.length - 1];
  const hyphens = (last.match(/-/g) || []).length;
  const hasDate = /\/\d{4}\/\d{1,2}\//.test(p) || /\d{4}-\d{2}-\d{2}/.test(p);
  return hyphens >= 2 || (hasDate && last.length > 8) || last.length >= 28;
}

// Pull up to N article URLs from homepage HTML — outlet.re if provided, else generic.
function extractArticleUrls(html, outlet, n) {
  const out = [];
  const seen = new Set();
  const homeHost = new URL(outlet.home).host;
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    let href = m[1];
    if (href.startsWith('/')) {
      try { href = new URL(href, outlet.home).href; } catch { continue; }
    }
    if (!href.startsWith('http')) continue;
    const clean = href.split('#')[0].split('?')[0];
    if (seen.has(clean)) continue;
    if (/\/_next\/|\.(css|js|json|png|jpe?g|svg|webp|ico|woff2?)$/i.test(clean)) continue;
    if (/\/(video|videos|live|podcast|tag|topics?|author|graphics)\//i.test(clean)) continue;
    const match = outlet.re ? outlet.re.test(clean) : looksLikeArticle(clean, homeHost);
    if (!match) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= n) break;
  }
  return out;
}

// Raw-HTML fetch via Zyte. mode: 'raw' (httpResponseBody) | 'browser' (browserHtml).
// Returns HTML string. Throws on Zyte error (incl. 451 domain-forbidden) so the
// caller can record the failure mode — that distinction is the whole point of Phase 0.
async function fetchHTML(url, mode) {
  if (mode === 'browser') {
    const r = await zyte({ url, browserHtml: true });
    return r.browserHtml || '';
  }
  const r = await zyte({ url, httpResponseBody: true });
  return r.httpResponseBody ? Buffer.from(r.httpResponseBody, 'base64').toString('utf8') : '';
}

async function fetchHomepage(outlet) {
  // Homepages render fine from raw HTML for link discovery (<a href> are server-sent);
  // only fall back to browser render if raw yields too little markup.
  const raw = await fetchHTML(outlet.home, 'raw');
  if (raw.length > 5000) return raw;
  return fetchHTML(outlet.home, 'browser');
}

// Crude readability: prefer <article>, else all <p>. Strip tags/entities, count words.
// Good enough to separate a full body (hundreds–thousands of words) from a paywall
// teaser (a few dozen) — which is all Phase 0 needs to decide quotable vs headline-only.
function htmlToBodyText(html) {
  if (!html) return '';
  let h = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
              .replace(/<style[\s\S]*?<\/style>/gi, ' ')
              .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  const art = h.match(/<article[\s\S]*?<\/article>/i);
  const scope = art ? art[0] : h;
  const paras = [...scope.matchAll(/<p[\s>][\s\S]*?<\/p>/gi)].map(m => m[0]);
  const text = (paras.length ? paras.join(' ') : scope)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  return text;
}

async function extractArticle(url, mode) {
  const html = await fetchHTML(url, mode);
  const body = htmlToBodyText(html);
  return {
    words: wc(body),
    paywallMarker: PAYWALL_MARKERS.test(body.slice(0, 4000)),
  };
}

function classify(rawWords, browserWords, anyMarker) {
  const best = Math.max(rawWords, browserWords);
  if (best >= FULL_THRESHOLD && !(anyMarker && best < FULL_THRESHOLD * 1.5)) return 'FULL';
  if (best >= TEASER_THRESHOLD) return 'PARTIAL';
  if (best > 0) return 'TEASER';
  return 'FAIL';
}

// simple promise pool
async function pool(items, size, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: size }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---- run ----------------------------------------------------------------

async function processOutlet(outlet) {
  const rec = { id: outlet.id, home: outlet.home, articles: [], error: null };
  try {
    const html = await fetchHomepage(outlet);
    const urls = extractArticleUrls(html, outlet, ARTICLES_PER_OUTLET);
    rec.urlsFound = urls.length;
    if (urls.length === 0) { rec.error = 'no article URLs matched on homepage'; }
    for (const url of urls) {
      const a = { url, raw: null, browser: null };
      try { a.raw = await extractArticle(url, 'raw'); }
      catch (e) { a.raw = { error: e.message }; }
      try { a.browser = await extractArticle(url, 'browser'); }
      catch (e) { a.browser = { error: e.message }; }
      rec.articles.push(a);
    }
  } catch (e) {
    rec.error = e.message;
  }
  // aggregate
  const rawWords = rec.articles.map(a => a.raw && a.raw.words || 0);
  const browserWords = rec.articles.map(a => a.browser && a.browser.words || 0);
  const anyMarker = rec.articles.some(a => (a.raw && a.raw.paywallMarker) || (a.browser && a.browser.paywallMarker));
  const med = arr => { const s = [...arr].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  rec.medianRawWords = med(rawWords);
  rec.medianBrowserWords = med(browserWords);
  rec.anyPaywallMarker = anyMarker;
  const forbidden = /forbidden|451/i.test(rec.error || '');
  rec.verdict = forbidden ? 'FORBIDDEN'
    : rec.articles.length ? classify(rec.medianRawWords, rec.medianBrowserWords, anyMarker)
    : 'FAIL';
  rec.recommendation = rec.verdict === 'FULL' ? 'quotable'
    : rec.verdict === 'PARTIAL' ? 'quotable-with-caution (per-article gate)'
    : rec.verdict === 'FORBIDDEN' ? 'Zyte refuses domain — needs direct fetch/RSS, drop or headline-only'
    : 'headline-only';
  return rec;
}

(async () => {
  if (!process.env.ZYTE_API_KEY) { console.error('ERROR: ZYTE_API_KEY not set'); process.exit(1); }
  console.error(`Phase 0: ${OUTLETS.length} outlets × ${ARTICLES_PER_OUTLET} articles × 2 modes via Zyte...\n`);
  const t0 = Date.now();
  const results = await pool(OUTLETS, CONCURRENCY, async (o) => {
    const r = await processOutlet(o);
    console.error(`  ${r.id.padEnd(16)} ${r.verdict.padEnd(8)} raw≈${r.medianRawWords}  browser≈${r.medianBrowserWords}  (${r.urlsFound || 0} urls)${r.error ? '  ⚠ ' + r.error : ''}`);
    return r;
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);

  // matrix table
  const rows = results.map(r =>
    `| ${r.id.padEnd(15)} | ${String(r.verdict).padEnd(7)} | ${String(r.medianRawWords).padStart(6)} | ${String(r.medianBrowserWords).padStart(8)} | ${r.anyPaywallMarker ? 'yes' : 'no '} | ${r.recommendation} |`
  );
  const table = [
    '\n| outlet          | verdict | rawWds | browWds | wall | recommendation |',
    '|-----------------|---------|--------|---------|------|----------------|',
    ...rows,
  ].join('\n');
  console.log(table);
  console.log(`\nLegend: FULL≥${FULL_THRESHOLD}w · PARTIAL≥${TEASER_THRESHOLD}w · TEASER>0w · FAIL=no body. "wall"=paywall marker text seen in extracted body.`);
  console.log(`Zyte calls ≈ ${results.reduce((s, r) => s + 1 + r.articles.length * 2, 0)} · ${elapsed}s`);

  const outPath = path.join(__dirname, 'docs', 'phase0-matrix.json');
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), thresholds: { FULL_THRESHOLD, TEASER_THRESHOLD }, results }, null, 2));
  console.log(`\nWrote ${outPath}`);
})();
