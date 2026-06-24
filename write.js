#!/usr/bin/env node
'use strict';
/**
 * First Read — stage 6: write.  *** M2 STUB ***
 *
 * The real writer (single Sonnet call over clustered bodies + segmented quotes,
 * quote-by-ID contract, writing rules #1-7) lands in Milestone 4. For now this is a
 * pass-through that turns candidates.json into a plain markdown link list so the
 * end-to-end skeleton produces a briefing.md artifact. No API call.
 */

const fs = require('node:fs');
const path = require('node:path');

const candidates = JSON.parse(fs.readFileSync(path.join(__dirname, 'candidates.json'), 'utf8'));
const lines = [
  '# First Read (skeleton)',
  '',
  `_${candidates.count} candidates · ${candidates.generatedAt}_`,
  '',
  ...candidates.candidates.map((c) => `- [${c.title}](${c.url}) — ${(c.sources || []).join(', ')}`),
  '',
];
fs.writeFileSync(path.join(__dirname, 'briefing.md'), lines.join('\n'));
console.error(`write (stub): briefing.md ← ${candidates.count} candidates`);
