'use strict';
/**
 * Zyte fetch layer for First Read.
 *
 * Ported from news-briefing/generate-briefing.js:96-145 (`fetchViaZyte`, contract
 * verified 2026-06-05) and extended per the design (§4 Zyte usage policy):
 *   - raw (`httpResponseBody`) is the default; `browser` (`browserHtml`) renders JS.
 *   - a persistent per-domain ESCALATION MAP flips a domain raw→browser after 2
 *     consecutive raw failures (anti-bot 403s, NOT paywalls — Phase 0 showed JS
 *     rendering doesn't recover paywalled bodies). Stored at state/zyte-escalation.json.
 *   - a per-run BUDGET GUARD hard-stops at 150 requests/run, warns at 100, and tracks
 *     an estimated cost line for last-run-status.json.
 *
 * The fetch function takes an injectable `request` (default https.request) so the
 * https layer can be stubbed in tests without real network calls.
 */

const https = require('node:https');
const fs = require('node:fs');

// Rough Zyte list-price estimates (USD/request). Raw is cheap (no render);
// browser mode renders JS and costs ~6x. These drive the per-run cost line only
// (an estimate for observability, not billing) — tune against real invoices in burn-in.
const COST = Object.freeze({ raw: 0.0008, browser: 0.005 });

// --------------------------------------------------------------------- fetch

// Fetch `url` through the Zyte extract API. mode: 'raw' (httpResponseBody, default)
// | 'browser' (browserHtml). Returns { html, statusCode }. Throws on missing key,
// non-200, network error, or a 200 missing the expected body field.
function fetchViaZyte(url, opts = {}) {
  const { mode = 'raw', apiKey = process.env.ZYTE_API_KEY, request = https.request } = opts;
  return new Promise((resolve, reject) => {
    if (!apiKey) { reject(new Error('ZYTE_API_KEY not set')); return; }
    const payload = JSON.stringify(
      mode === 'browser' ? { url, browserHtml: true } : { url, httpResponseBody: true },
    );
    const req = request({
      hostname: 'api.zyte.com',
      path: '/v1/extract',
      method: 'POST',
      auth: `${apiKey}:`, // key = username, empty password
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          reject(new Error(`Zyte HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
          return;
        }
        try {
          const json = JSON.parse(raw);
          if (mode === 'browser') {
            if (typeof json.browserHtml !== 'string') { reject(new Error('Zyte response missing browserHtml body')); return; }
            resolve({ html: json.browserHtml, statusCode: 200 });
          } else {
            if (!json.httpResponseBody) { reject(new Error('Zyte response missing httpResponseBody body')); return; }
            resolve({ html: Buffer.from(json.httpResponseBody, 'base64').toString('utf8'), statusCode: 200 });
          }
        } catch (e) { reject(new Error(`Zyte parse error: ${e.message}`)); }
      });
    });
    req.on('error', (e) => reject(new Error(`Network error: ${e.message}`)));
    // Zyte's anti-ban can take longer than a direct GET — allow 90s.
    req.setTimeout(90000, () => { req.destroy && req.destroy(); reject(new Error('Zyte timeout')); });
    req.write(payload);
    req.end();
  });
}

// ----------------------------------------------------------- escalation map
// The map is a plain object keyed by domain: { mode: 'raw'|'browser', rawFailures }.
// Absent key = raw, 0 failures. Pure functions mutate-and-return the map; load/save
// persist it. Escalation is sticky: once a domain flips to 'browser', it stays there.

const ESCALATE_AFTER = 2; // consecutive raw failures

function shouldUseBrowser(map, domain) {
  return (map[domain] && map[domain].mode) === 'browser';
}

function recordRawFailure(map, domain) {
  const e = map[domain] || (map[domain] = { mode: 'raw', rawFailures: 0 });
  if (e.mode === 'browser') return map; // already escalated
  e.rawFailures += 1;
  if (e.rawFailures >= ESCALATE_AFTER) e.mode = 'browser';
  return map;
}

function recordSuccess(map, domain) {
  const e = map[domain];
  if (e && e.mode !== 'browser') e.rawFailures = 0; // reset; never de-escalate
  return map;
}

function loadEscalation(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {}; }
}

function saveEscalation(file, map) {
  fs.writeFileSync(file, JSON.stringify(map, null, 2) + '\n');
}

// ----------------------------------------------------------- budget guard

// Per-run request budget. hardCap = abort threshold, warnAt = log threshold.
function createZyteBudget({ hardCap = 150, warnAt = 100 } = {}) {
  let count = 0, raw = 0, browser = 0;
  return {
    canSpend() { return count < hardCap; },
    // Record one request of `mode`; returns { count, warned } where `warned` is
    // true only on the single charge that crosses warnAt.
    charge(mode) {
      count += 1;
      if (mode === 'browser') browser += 1; else raw += 1;
      return { count, warned: count === warnAt };
    },
    summary() {
      return {
        count, raw, browser,
        estCostUsd: raw * COST.raw + browser * COST.browser,
        hardCap, warnAt,
        overCap: count >= hardCap,
      };
    },
  };
}

module.exports = {
  fetchViaZyte,
  shouldUseBrowser, recordRawFailure, recordSuccess, loadEscalation, saveEscalation,
  createZyteBudget, COST,
};
