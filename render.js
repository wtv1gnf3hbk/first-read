#!/usr/bin/env node
'use strict';
/**
 * First Read — stage 9: render.
 *
 * Normal:   node render.js              → index.html + briefing.md from briefing.json.
 * Degraded: node render.js --degraded "reason"
 *           → links-only index.html from candidates.json + a banner. Used when
 *             validation stays fatal after the write retry, so we NEVER leave
 *             yesterday's page up (design §9). Logic in lib/render.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const { renderBriefing, renderDegraded } = require('./lib/render');

const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
const args = process.argv.slice(2);
const degradedIdx = args.indexOf('--degraded');

if (degradedIdx !== -1) {
  const reason = args[degradedIdx + 1] || 'validation failed';
  const candidates = read('candidates.json').candidates;
  fs.writeFileSync(path.join(__dirname, 'index.html'), renderDegraded(candidates, reason));
  // Also emit a degraded briefing.md so the committed artifact set is consistent
  // with a normal run (the commit step expects both).
  const md = [`# First Read — degraded`, '', `_could not assemble the briefing: ${reason}_`, '',
    ...candidates.slice(0, 30).map((c) => `- [${c.title || c.url}](${c.url})`), ''].join('\n');
  fs.writeFileSync(path.join(__dirname, 'briefing.md'), md);
  console.error(`render: DEGRADED page published (${reason})`);
  process.exit(0);
}

const briefing = read('briefing.json');
const bodies = read('bodies.json');
fs.writeFileSync(path.join(__dirname, 'index.html'), renderBriefing(briefing, { bodies }));

// briefing.md — committed markdown mirror of the page (design §4 outputs).
const md = [
  `# First Read`, '', `_${briefing.generatedAt || ''}_`, '',
  ...(briefing.spine || []).flatMap((s) => [`**${s.headline}.** ${s.text} [link](${s.link_url})`, '']),
  ...((briefing.ticker || []).length ? ['## The ticker', '', ...briefing.ticker.map((t) => `- [${t.text}](${t.url})`), ''] : []),
  ...((briefing.longreads || []).length ? ['## Longreads', '', ...briefing.longreads.map((l) => `- [${l.title}](${l.url}) — ${l.why || ''}`), ''] : []),
].join('\n');
fs.writeFileSync(path.join(__dirname, 'briefing.md'), md);
console.error(`render: index.html + briefing.md (${(briefing.spine || []).length} spine items)`);
