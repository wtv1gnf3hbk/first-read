#!/usr/bin/env node
'use strict';
/**
 * First Read — stage 2: extract.
 *
 * Turns fetch-raw.json into candidates.json:
 *   - Tier-1 outlets: extractCandidates() over each homepage HTML (generic
 *     article-URL + headline-anchor heuristic, per-domain urlRegex override).
 *     Prominence = DOM order.
 *   - Tier-2 voices: each RSS item is a candidate (prominence = feed order).
 *   - Cross-source dedup by canonical URL; stable per-candidate IDs.
 *
 * Enforces the candidate-count half of the minimum-source floor (design §4): if
 * today's candidate count is < 60% of yesterday's, abort and skip the state commit.
 *
 * Output: candidates.json (gitignored). Merges its summary into last-run-status.json.
 * Thin wrapper: extraction + floor logic are tested in lib/extract.js + lib/fetch.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const { extractCandidates, dedupeCandidates, canonicalizeUrl, candidateId, sourcesBelowFloor } = require('./lib/extract');
const { checkSourceFloor } = require('./lib/fetch');

const RAW_IN = path.join(__dirname, 'fetch-raw.json');
const CAND_OUT = path.join(__dirname, 'candidates.json');
const STATUS_FILE = path.join(__dirname, 'last-run-status.json');

const sources = JSON.parse(fs.readFileSync(path.join(__dirname, 'sources.json'), 'utf8'));
const sourceById = Object.fromEntries(sources.map((s) => [s.id, s]));
const raw = JSON.parse(fs.readFileSync(RAW_IN, 'utf8'));

function readStatus() { try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch { return {}; } }
function writeStatus(patch) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...readStatus(), ...patch }, null, 2) + '\n');
}

const prevStatus = readStatus();
const yesterdayCount = (prevStatus.extract && prevStatus.extract.candidateCount) || 0;

// --- build the raw candidate list (pre-dedup) -------------------------------
const rawCandidates = [];
const perSourceCounts = {};

for (const t of raw.tier1 || []) {
  const src = sourceById[t.id];
  if (!src || !t.ok || !t.html) { perSourceCounts[t.id] = 0; continue; }
  const cands = extractCandidates(t.html, src);
  perSourceCounts[t.id] = cands.length;
  rawCandidates.push(...cands);
}

for (const v of raw.voices || []) {
  const items = v.items || [];
  perSourceCounts[v.id] = items.length;
  items.forEach((it, i) => {
    rawCandidates.push({ url: canonicalizeUrl(it.url), title: it.title, sourceId: v.id, prominence: i });
  });
}

const candidates = dedupeCandidates(rawCandidates);
const candidateCount = candidates.length;
const zeroSourceFlags = sourcesBelowFloor(perSourceCounts, 1);

console.error(`extract: ${candidateCount} candidates from ${Object.keys(perSourceCounts).length} sources (${zeroSourceFlags.length} below floor)`);
if (zeroSourceFlags.length) console.error(`  below floor: ${zeroSourceFlags.join(', ')}`);

// --- candidate-count floor (vs yesterday) -----------------------------------
const tier1Succeeded = (raw.tier1 || []).filter((r) => r.ok).length;
const floor = checkSourceFloor({ tier1Succeeded, tier1Total: (raw.tier1 || []).length, candidateCount, yesterdayCount });
if (!floor.ok) {
  writeStatus({ ok: false, abortedAt: 'extract', abortReason: floor.reason, extract: { candidateCount, yesterdayCount, zeroSourceFlags } });
  console.error(`ABORT: ${floor.reason} — skipping state commit.`);
  process.exit(2);
}

fs.writeFileSync(CAND_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), count: candidateCount, candidates }, null, 2));
writeStatus({ extract: { candidateCount, yesterdayCount, zeroSourceFlags } });
console.error(`extract done → candidates.json (${candidateCount})`);
