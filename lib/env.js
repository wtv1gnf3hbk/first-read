'use strict';
/**
 * Minimal .env loader — no dependency. Ported verbatim in spirit from
 * news-briefing/alison-review.js:26-35, but exported as a function so the
 * pipeline scripts can call it (and tests can target a throwaway env object).
 *
 * Fills ZYTE_API_KEY / ANTHROPIC_API_KEY etc. for LOCAL runs from `<dir>/.env`.
 * In CI those come from the workflow `env:` block (GitHub secrets), so the
 * .env file is absent and this is a no-op. NEVER overwrites an already-set var
 * — CI env always wins over a stale local .env.
 */

const fs = require('node:fs');
const path = require('node:path');

// Parse `<dir>/.env` and set any KEY=VALUE pairs into `env` (default
// process.env) that are not already set. Returns the list of keys it newly set.
// Non-fatal on any error (missing file, unreadable) — returns [].
function loadDotEnv(dir, env = process.env) {
  const loaded = [];
  try {
    const envPath = path.join(dir, '.env');
    if (!fs.existsSync(envPath)) return loaded;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) {
        env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        loaded.push(m[1]);
      }
    }
  } catch {
    /* non-fatal — missing/unreadable .env just means no local overrides */
  }
  return loaded;
}

module.exports = { loadDotEnv };
