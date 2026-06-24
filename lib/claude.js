'use strict';
/**
 * Anthropic API call layer for First Read.
 *
 * Ported from news-briefing/write-briefing.js:29-109 (`callClaude`), with ONE
 * deliberate change per hard-won rule #17: a client-side TIMEOUT is NON-RETRYABLE
 * (fatal). A non-streaming Opus/Sonnet generation can exceed a short client timeout
 * while the server completes and bills; retrying re-bills. So we (a) use a generous
 * 300s timeout and (b) never classify the timeout error as retryable.
 *
 * Models: write path uses `claude-sonnet-4-6` (default); `callHaiku` targets
 * `claude-haiku-4-5` for clustering/novelty. `request` and `sleep` are injectable
 * so the https layer and backoff can be stubbed in tests (no network, no real waits).
 */

const https = require('node:https');

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const HAIKU_MODEL = 'claude-haiku-4-5';

// Classify an error message as transient (retry) vs fatal (give up). Transient:
// rate limits, 5xx/gateway errors (incl. Cloudflare 520/529), network resets, and
// non-JSON gateway bodies. FATAL (notably): client-side timeout (rule #17) and any
// 4xx client error. Exported so the rule-#17 contract is unit-tested directly.
function isRetryable(message) {
  return message.includes('Overloaded') ||
    message.includes('529') ||
    message.includes('HTTP 429') ||
    /HTTP 5\d\d/.test(message) ||
    message.includes('Network error') ||
    message.includes('Failed to parse API response');
  // NB: 'timeout' is intentionally absent — timeouts are fatal (rule #17).
}

function callClaudeOnce(prompt, opts = {}) {
  const {
    model = DEFAULT_MODEL,
    maxTokens = 4000,
    apiKey = process.env.ANTHROPIC_API_KEY,
    request = https.request,
  } = opts;

  return new Promise((resolve, reject) => {
    if (!apiKey) { reject(new Error('ANTHROPIC_API_KEY not set')); return; }
    const body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

    const req = request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const status = res.statusCode || 0;
        // Classify on status BEFORE parsing — 429/5xx often arrive as non-JSON
        // HTML error pages from the gateway.
        if (status === 429 || status >= 500) {
          return reject(new Error(`HTTP ${status} from Anthropic API: ${data.slice(0, 150)}`));
        }
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message));
          else resolve(json.content[0].text);
        } catch {
          reject(new Error('Failed to parse API response: ' + data.slice(0, 200)));
        }
      });
    });

    req.on('error', (e) => reject(new Error(`Network error: ${e.message}`)));
    // 300s to outlast a long single-shot generation; the timeout is FATAL (rule #17).
    req.setTimeout(300000, () => {
      req.destroy && req.destroy();
      reject(new Error('API request exceeded 300s (non-retryable)'));
    });

    req.write(body);
    req.end();
  });
}

// Retry wrapper for transient errors only. Backoff 15s/30s/60s by default; `sleep`
// is injectable so tests don't wait. Fatal errors (timeout, 4xx) throw immediately.
async function callClaude(prompt, opts = {}) {
  const {
    maxRetries = 3,
    backoff = [15000, 30000, 60000],
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    log = console.log,
  } = opts;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callClaudeOnce(prompt, opts);
    } catch (err) {
      if (!isRetryable(err.message) || attempt === maxRetries) throw err;
      const wait = backoff[attempt] || 60000;
      log(`  ⚠ ${err.message} — retrying in ${wait / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
      await sleep(wait);
    }
  }
}

// Convenience wrapper for the Haiku-driven stages (cluster/diff).
function callHaiku(prompt, opts = {}) {
  return callClaude(prompt, { ...opts, model: HAIKU_MODEL });
}

module.exports = { callClaudeOnce, callClaude, callHaiku, isRetryable, DEFAULT_MODEL, HAIKU_MODEL };
