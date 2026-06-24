#!/usr/bin/env node
'use strict';
/**
 * First Read — stage 8: validate (design §7; rule #11).
 *
 * Exit codes: 0 = clean · 1 = FATAL integrity violation (workflow retries the writer
 * once, then publishes degraded) · 2 = advisory only (publish with warnings).
 * Writes the fatal error list to validation-errors.txt (consumed as RETRY_FEEDBACK)
 * and records both tiers in last-run-status.json. Logic in lib/validate.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const { validate } = require('./lib/validate');

const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
const briefing = read('briefing.json');
const bodies = read('bodies.json');
const candidates = read('candidates.json').candidates;

const { errors, warnings } = validate(briefing, { bodies, candidates });

for (const e of errors) console.error(`  ✗ [${e.code}] ${e.message}`);
for (const w of warnings) console.error(`  ⚠ [${w.code}] ${w.message}`);

fs.writeFileSync(path.join(__dirname, 'validation-errors.txt'), errors.map((e) => `[${e.code}] ${e.message}`).join('\n'));

// Merge validation result into last-run-status.json.
const STATUS = path.join(__dirname, 'last-run-status.json');
let prev = {};
try { prev = JSON.parse(fs.readFileSync(STATUS, 'utf8')); } catch { /* fresh */ }
fs.writeFileSync(STATUS, JSON.stringify({ ...prev, validation: { errors, warnings, fatal: errors.length > 0 } }, null, 2) + '\n');

if (errors.length) { console.error(`validate: ${errors.length} FATAL`); process.exit(1); }
if (warnings.length) { console.error(`validate: ${warnings.length} advisory`); process.exit(2); }
console.error('validate: clean');
process.exit(0);
