#!/usr/bin/env node
'use strict';
/**
 * First Read — stage 7: fix. Deterministic auto-fixers (contractions, "amid",
 * ticker repeats, spine dedupe) over briefing.json. Logic in lib/fix.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const { applyFixes } = require('./lib/fix');

const file = path.join(__dirname, 'briefing.json');
const briefing = JSON.parse(fs.readFileSync(file, 'utf8'));
const { briefing: fixed, changes } = applyFixes(briefing);
fs.writeFileSync(file, JSON.stringify(fixed, null, 2));
console.error(changes.length ? `fix: applied ${changes.join(', ')}` : 'fix: nothing to change');
