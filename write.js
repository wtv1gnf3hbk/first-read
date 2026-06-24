#!/usr/bin/env node
'use strict';
/**
 * First Read — stage 6: write.  (Replaces the M2 pass-through stub.)
 *
 * ONE Sonnet call. Input is engineered < 190K tokens (top ≤15 clusters × ≤3 trimmed
 * bodies + segmented quote IDs + novelty tags + longreads). The writer emits a
 * structured briefing.json and references quotes BY ID — never typing the quote text
 * (quote-by-ID contract, design §2; render.js inserts the exact paragraph). Writing
 * rules #1-7 are in the prompt. If RETRY_FEEDBACK is set (the validator's error list
 * from a failed first pass), it's appended so the model can self-correct — the single
 * automatic retry (design §6). Long non-retryable timeout (rule #17 via lib/claude).
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadDotEnv } = require('./lib/env');
const { callClaude, extractJson } = require('./lib/claude');

loadDotEnv(__dirname);

const TOP_CLUSTERS = 15;
const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
const bodiesDoc = read('bodies.json');
const diffDoc = (() => { try { return read('diff.json'); } catch { return { clusters: [] }; } })();

// novelty keyed by lead id (diff.js annotates per cluster lead).
const noveltyByLead = Object.fromEntries((diffDoc.clusters || []).map((c) => [c.lead && c.lead.id, c.novelty]));

// Assemble the compact writer input: each cluster with its quotable bodies (trimmed)
// + the available quote IDs, plus longread candidates.
const clusters = bodiesDoc.clusters.slice(0, TOP_CLUSTERS).map((cl) => ({
  lead: cl.lead,
  outletCount: cl.outletCount,
  novelty: noveltyByLead[cl.lead && cl.lead.id] || { tag: 'new' },
  bodies: (cl.bodies || []).filter((b) => b.quotable).map((b) => ({
    id: b.id, url: b.url, outlet: b.sourceId, body: b.body,
    quote_ids: (b.quotes || []).map((q) => q.quote_id),
  })),
  headline_only: (cl.bodies || []).filter((b) => !b.quotable).map((b) => ({ url: b.url })),
}));
const longreads = (bodiesDoc.longreads || []).filter((l) => l.quotable).map((l) => ({ id: l.id, url: l.url }));

const RULES = `STYLE RULES (mandatory):
1. No 's contractions for is/has ("Disney named", never "Disney's named").
2. Never use "amid".
3. No em-dash run-on sentences joining loosely related clauses; use separate sentences.
4. No editorializing (no "saber-rattling", "makes diplomats nervous"); report facts.
5. No tacked-on "context" clauses; end the bullet on the fact.
6. No awkward "while"/"as" constructions linking unrelated events.
7. Lead each item with what is NEW today, not standing background.`;

const SCHEMA = `Return ONLY JSON (no prose) of this shape:
{
  "spine": [ { "headline": "...", "text": "40-70 words, facts from the bodies",
              "link_url": "<one body url from the cluster>",
              "citations": [ { "outlet": "<outlet id>", "figures": ["<any figure you attribute to that outlet>"] } ],
              "novelty": { "tag": "new|development|rehash", "delta": "<what's new, if development/rehash>" } } ],
  "worth": [ { "synthesis": "2-3 sentences", "quote_id": "<an EXACT quote_id from a body>", "attribution": "Outlet", "link_url": "<body url>" } ],
  "ticker": [ { "text": "one line", "url": "<a candidate/body url>" } ],
  "longreads": [ { "title": "...", "url": "<a longread url>", "why": "one line" } ]
}
HARD CONTRACT: quote text is inserted from quote_id by the renderer — output the quote_id, NEVER the quote text. Cite a figure to an outlet ONLY if it appears in that outlet's body. 6-8 spine items (fewer on a thin day), <=3 worth, <=8 ticker, 1-2 longreads. Total spine+worth+ticker <= 1200 words.`;

function buildPrompt() {
  const feedback = process.env.RETRY_FEEDBACK
    ? `\n\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION. Fix these and try again:\n${process.env.RETRY_FEEDBACK}\n`
    : '';
  return `You are writing "First Read", a layered 5-minute personal news briefing, ordered most-compelling-first.\n\n${RULES}\n\n${SCHEMA}\n${feedback}\nCLUSTERS (ranked):\n${JSON.stringify(clusters)}\n\nLONGREAD CANDIDATES:\n${JSON.stringify(longreads)}`;
}

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1); }
  const text = await callClaude(buildPrompt(), { maxTokens: 8000 });
  const briefing = extractJson(text);
  if (!briefing || !Array.isArray(briefing.spine)) {
    console.error('ERROR: writer did not return parseable briefing JSON');
    process.exit(1);
  }
  briefing.generatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, 'briefing.json'), JSON.stringify(briefing, null, 2));
  console.error(`write done → briefing.json (${briefing.spine.length} spine, ${(briefing.worth || []).length} worth, ${(briefing.ticker || []).length} ticker)${process.env.RETRY_FEEDBACK ? ' [retry]' : ''}`);
})();
