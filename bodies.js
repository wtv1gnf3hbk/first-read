#!/usr/bin/env node
'use strict';
/**
 * First Read — stage 4: bodies.
 *
 * Fetches full article text for the top clusters' members (≤3 bodies/cluster, from
 * QUOTABLE outlets only) + longread candidates (≤6). HARD CAP 80 Zyte fetches/run.
 * Each body is trimmed to ~2K words, run through the per-body quality gate (a teaser
 * or paywall-marked body demotes that member to headline-only — never reaches the
 * writer as a body), then paragraph-segmented with stable quote_ids. Cached by URL
 * hash in cache/ (gitignored) to dedup re-runs.
 *
 * Output: bodies.json (gitignored). Pure logic tested in lib/bodies.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadDotEnv } = require('./lib/env');
const { fetchViaZyte, shouldUseBrowser, recordRawFailure, recordSuccess, loadEscalation, saveEscalation, createZyteBudget } = require('./lib/zyte');
const { htmlToParagraphs, trimWords, bodyQualityGate, segmentParagraphs, wordCount, PAYWALL_MARKERS } = require('./lib/bodies');

loadDotEnv(__dirname);

const TOP_CLUSTERS = 15;
const BODIES_PER_CLUSTER = 3;
const LONGREAD_CAP = 6;
const HARD_CAP = 80;
const CACHE_DIR = path.join(__dirname, 'cache');
const ESCALATION_FILE = path.join(__dirname, 'state', 'zyte-escalation.json');

const sources = JSON.parse(fs.readFileSync(path.join(__dirname, 'sources.json'), 'utf8'));
const sourceById = Object.fromEntries(sources.map((s) => [s.id, s]));
const hostToSource = Object.fromEntries(sources.filter((s) => s.home).map((s) => [new URL(s.home).host, s]));
const candidatesDoc = JSON.parse(fs.readFileSync(path.join(__dirname, 'candidates.json'), 'utf8'));
const byId = Object.fromEntries(candidatesDoc.candidates.map((c) => [c.id, c]));
const clustersDoc = JSON.parse(fs.readFileSync(path.join(__dirname, 'clusters.json'), 'utf8'));

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
const escalation = loadEscalation(ESCALATION_FILE);
const budget = createZyteBudget();

// Is this candidate quotable? Prefer the URL's owning outlet; fall back to whether
// any surfacing source is quotable (the voice case).
function isQuotable(cand) {
  let host = '';
  try { host = new URL(cand.url).host; } catch { /* */ }
  const owner = hostToSource[host];
  if (owner) return owner.quotable === true;
  return (cand.sources || []).some((id) => sourceById[id] && sourceById[id].quotable === true);
}

function cachePath(url) { return path.join(CACHE_DIR, 'body_' + crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + '.json'); }

// Fetch + extract one article body, caching by URL hash. Returns
// { url, words, body, paywallMarker } or { url, error }.
async function fetchBody(url) {
  const cp = cachePath(url);
  try { return JSON.parse(fs.readFileSync(cp, 'utf8')); } catch { /* cache miss */ }
  if (!budget.canSpend()) return { url, error: 'zyte budget exhausted' };

  let host = '';
  try { host = new URL(url).host; } catch { /* */ }
  const mode = shouldUseBrowser(escalation, host) ? 'browser' : 'raw';
  budget.charge(mode);
  try {
    const { html } = await fetchViaZyte(url, { mode });
    recordSuccess(escalation, host);
    const paras = htmlToParagraphs(html);
    const bodyText = paras.join(' ');
    const rec = { url, words: wordCount(bodyText), paragraphs: paras, paywallMarker: PAYWALL_MARKERS.test(bodyText.slice(0, 4000)) };
    fs.writeFileSync(cp, JSON.stringify(rec));
    return rec;
  } catch (e) {
    if (mode === 'raw') recordRawFailure(escalation, host);
    return { url, error: e.message };
  }
}

// Build the per-member body record, applying the quality gate + segmentation.
async function processMember(cand) {
  const rec = await fetchBody(cand.url);
  if (rec.error) return { id: cand.id, url: cand.url, quotable: false, error: rec.error };
  const gate = bodyQualityGate({ words: rec.words, paywallMarker: rec.paywallMarker });
  if (gate.demote) {
    return { id: cand.id, url: cand.url, quotable: false, words: rec.words, demoted: gate.reason };
  }
  const trimmedParas = trimWords((rec.paragraphs || []).join('\n'), 2000).split('\n');
  const quotes = segmentParagraphs(trimmedParas, cand.id);
  return { id: cand.id, url: cand.url, sourceId: cand.sources && cand.sources[0], quotable: true, words: rec.words,
    body: trimWords((rec.paragraphs || []).join(' '), 2000), quotes };
}

(async () => {
  if (!process.env.ZYTE_API_KEY) { console.error('ERROR: ZYTE_API_KEY not set'); process.exit(1); }
  const top = clustersDoc.clusters.slice(0, TOP_CLUSTERS);
  const outClusters = [];

  for (const cl of top) {
    const members = cl.members.map((id) => byId[id]).filter(Boolean).filter(isQuotable).slice(0, BODIES_PER_CLUSTER);
    const bodies = [];
    for (const m of members) bodies.push(await processMember(m));
    outClusters.push({ members: cl.members, lead: cl.lead, outletCount: cl.outletCount, score: cl.score, bodies });
  }

  // Longreads: candidates from longread-vertical outlets or curator voices, capped.
  const longreadSourceIds = new Set(sources.filter((s) => s.vertical === 'longread' || s.tier === 2).map((s) => s.id));
  const longreadCands = candidatesDoc.candidates
    .filter((c) => (c.sources || []).some((id) => longreadSourceIds.has(id)))
    .slice(0, LONGREAD_CAP);
  const longreads = [];
  for (const c of longreadCands) longreads.push(await processMember(c));

  saveEscalation(ESCALATION_FILE, escalation);
  const zyte = budget.summary();
  fs.writeFileSync(path.join(__dirname, 'bodies.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), zyte, clusters: outClusters, longreads }, null, 2));

  const demoted = outClusters.flatMap((c) => c.bodies).filter((b) => b.demoted).length;
  console.error(`bodies done → bodies.json · ${zyte.count} Zyte fetches (~$${zyte.estCostUsd.toFixed(3)}) · ${demoted} bodies demoted to headline-only`);
})();
