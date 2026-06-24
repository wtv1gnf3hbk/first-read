#!/usr/bin/env node
'use strict';
/**
 * First Read — stage 1: fetch.
 *
 * Tier-1 outlets: homepage HTML via Zyte (raw by default; the persistent
 * escalation map flips a domain to browser mode after 2 raw failures).
 * Tier-2 voices: direct RSS GET, with a Zyte raw fallback on 403 (GitHub Actions
 * datacenter IPs get 403'd by many Substacks).
 *
 * Enforces the Tier-1 minimum-source floor (design §4): if fewer than
 * MIN_TIER1_SUCCESS homepages fetch, abort BEFORE spending more — write the reason
 * to last-run-status.json and exit non-zero so the workflow skips the state commit.
 * (The candidate-count-vs-yesterday half of the floor lives in extract.js, which is
 * where the candidate count is known.)
 *
 * Output: fetch-raw.json (gitignored, inspection + extract.js input).
 *
 * Thin wrapper: all decision logic is tested in lib/fetch.js + lib/zyte.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { loadDotEnv } = require('./lib/env');
const { fetchViaZyte, shouldUseBrowser, recordRawFailure, recordSuccess, loadEscalation, saveEscalation, createZyteBudget } = require('./lib/zyte');
const { parseRssItems, MIN_TIER1_SUCCESS } = require('./lib/fetch');

loadDotEnv(__dirname);

const ESCALATION_FILE = path.join(__dirname, 'state', 'zyte-escalation.json');
const STATUS_FILE = path.join(__dirname, 'last-run-status.json');
const RAW_OUT = path.join(__dirname, 'fetch-raw.json');

const sources = JSON.parse(fs.readFileSync(path.join(__dirname, 'sources.json'), 'utf8'));
const tier1 = sources.filter((s) => s.tier === 1);
const voices = sources.filter((s) => s.tier === 2);

// --- direct RSS GET (follows up to 3 redirects); resolves { status, body } ----
function httpGet(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (first-read/0.1)' } }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 307, 308].includes(status) && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        resolve(httpGet(next, redirects - 1));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Direct GET timeout')); });
  });
}

// Write/merge the run status file (so a later stage can append to it).
function writeStatus(patch) {
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch { /* fresh */ }
  fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...prev, ...patch }, null, 2) + '\n');
}

async function fetchTier1(escalation, budget) {
  const out = [];
  for (const s of tier1) {
    if (!budget.canSpend()) { out.push({ id: s.id, ok: false, error: 'zyte budget exhausted' }); continue; }
    const domain = new URL(s.home).host;
    const mode = shouldUseBrowser(escalation, domain) ? 'browser' : 'raw';
    const charge = budget.charge(mode);
    if (charge.warned) console.error(`  ⚠ Zyte budget crossed warn threshold (${charge.count} requests)`);
    try {
      const { html } = await fetchViaZyte(s.home, { mode });
      recordSuccess(escalation, domain);
      out.push({ id: s.id, ok: true, mode, bytes: html.length, html });
      console.error(`  ✓ ${s.id.padEnd(16)} ${mode} ${html.length}b`);
    } catch (e) {
      if (mode === 'raw') recordRawFailure(escalation, domain);
      out.push({ id: s.id, ok: false, mode, error: e.message });
      console.error(`  ✗ ${s.id.padEnd(16)} ${mode} ${e.message}`);
    }
  }
  return out;
}

async function fetchVoices(budget) {
  const out = [];
  for (const v of voices) {
    try {
      let body = '';
      const r = await httpGet(v.feed);
      if (r.status === 200 && r.body) {
        body = r.body;
      } else if (budget.canSpend()) {
        // 403/blocked → Zyte raw fallback (Substack datacenter-IP blocks).
        budget.charge('raw');
        body = (await fetchViaZyte(v.feed, { mode: 'raw' })).html;
      }
      const items = parseRssItems(body);
      out.push({ id: v.id, ok: items.length > 0, count: items.length, items });
      console.error(`  ${items.length ? '✓' : '✗'} ${v.id.padEnd(16)} rss ${items.length} items`);
    } catch (e) {
      out.push({ id: v.id, ok: false, error: e.message, items: [] });
      console.error(`  ✗ ${v.id.padEnd(16)} rss ${e.message}`);
    }
  }
  return out;
}

(async () => {
  if (!process.env.ZYTE_API_KEY) { console.error('ERROR: ZYTE_API_KEY not set'); process.exit(1); }
  const escalation = loadEscalation(ESCALATION_FILE);
  const budget = createZyteBudget();

  console.error(`fetch: ${tier1.length} Tier-1 outlets + ${voices.length} voices...`);
  const t1 = await fetchTier1(escalation, budget);
  const vx = await fetchVoices(budget);

  // Persist the escalation map (raw→browser flips) regardless of run outcome.
  saveEscalation(ESCALATION_FILE, escalation);

  const tier1Succeeded = t1.filter((r) => r.ok).length;
  const zyte = budget.summary();
  console.error(`fetch done: ${tier1Succeeded}/${tier1.length} Tier-1 ok · ${zyte.count} Zyte reqs · ~$${zyte.estCostUsd.toFixed(3)}`);

  fs.writeFileSync(RAW_OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), tier1: t1, voices: vx, zyte }, null, 2));

  // Tier-1 minimum-source floor: abort before extract if too few homepages loaded.
  if (tier1Succeeded < MIN_TIER1_SUCCESS) {
    const reason = `only ${tier1Succeeded}/${tier1.length} Tier-1 fetches succeeded (floor ${MIN_TIER1_SUCCESS})`;
    writeStatus({ runAt: new Date().toISOString(), ok: false, abortedAt: 'fetch', abortReason: reason, fetch: { tier1Succeeded, tier1Total: tier1.length, zyte } });
    console.error(`ABORT: ${reason} — skipping state commit.`);
    process.exit(2);
  }

  writeStatus({ runAt: new Date().toISOString(), fetch: { tier1Succeeded, tier1Total: tier1.length, voices: vx.filter((v) => v.ok).length, zyte } });
})();
