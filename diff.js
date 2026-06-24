#!/usr/bin/env node
'use strict';
/**
 * First Read — stage 5: diff (novelty).
 *
 * Classifies each top cluster against the running threads in state/threads.json as
 * new / development / rehash (Haiku), then applies the bias rule (low-confidence
 * rehash → development; design §4). Threads decay over 14 days. Degraded modes that
 * never suppress a story:
 *   - no ANTHROPIC_API_KEY or unparseable output → tag everything 'new'.
 *
 * Writes diff.json (per-cluster novelty for the writer) and state/proposed-threads.json
 * — which the workflow promotes to state/threads.json ONLY on a successful publish
 * (a failed run never records stories as "told"). Logic tested in lib/diff.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadDotEnv } = require('./lib/env');
const { callHaiku, extractJson } = require('./lib/claude');
const { pruneThreads, applyNoveltyBias, promoteThreads } = require('./lib/diff');

loadDotEnv(__dirname);

const TOP_CLUSTERS = 15;
const THREADS_FILE = path.join(__dirname, 'state', 'threads.json');
const PROPOSED_FILE = path.join(__dirname, 'state', 'proposed-threads.json');

const clustersDoc = JSON.parse(fs.readFileSync(path.join(__dirname, 'clusters.json'), 'utf8'));
let threadsState = { threads: [], updatedAt: null };
try { threadsState = JSON.parse(fs.readFileSync(THREADS_FILE, 'utf8')); } catch { /* cold start */ }

const now = Date.now();
const activeThreads = pruneThreads(threadsState.threads || [], now);

// Stable-ish thread key for a cluster: slug of the lead title (lowercase, hyphenated).
// Real cross-day matching is what Haiku provides via matchedKey; this is the key a
// brand-new story gets.
function clusterKey(cl) {
  const t = (cl.lead && cl.lead.title) || cl.members[0] || 'untitled';
  return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function noveltyPrompt(cl) {
  const threadList = activeThreads.map((t) => `- [${t.key}] ${t.title}`).join('\n') || '(none)';
  return `You are tracking running news threads. Given the active threads and a new story, classify the new story.\n\n` +
    `ACTIVE THREADS:\n${threadList}\n\nNEW STORY: ${(cl.lead && cl.lead.title) || ''}\n\n` +
    `Return ONLY JSON: {"tag": "new"|"development"|"rehash", "confidence": 0..1, "matchedKey": "<thread key or null>", "delta": "<one phrase: what's new today, or null>"}. No prose.`;
}

async function classify(cl) {
  const fallback = { tag: 'new', confidence: 1, matchedKey: null, delta: null };
  if (!process.env.ANTHROPIC_API_KEY) return fallback;
  try {
    const parsed = extractJson(await callHaiku(noveltyPrompt(cl), { maxTokens: 300 }));
    if (!parsed || !parsed.tag) return fallback;
    return { tag: parsed.tag, confidence: Number(parsed.confidence) || 0, matchedKey: parsed.matchedKey || null, delta: parsed.delta || null };
  } catch (e) {
    console.error(`  ⚠ novelty Haiku error (${e.message}) → 'new'`);
    return fallback;
  }
}

(async () => {
  const top = clustersDoc.clusters.slice(0, TOP_CLUSTERS);
  const usingHaiku = !!process.env.ANTHROPIC_API_KEY;
  console.error(`diff: ${top.length} clusters vs ${activeThreads.length} active threads · ${usingHaiku ? 'Haiku' : 'cold/no-key → all new'}`);

  const annotated = [];
  const publishedKeys = [];
  for (const cl of top) {
    const c = await classify(cl);
    const tag = applyNoveltyBias(c.tag, c.confidence);
    const key = c.matchedKey && activeThreads.some((t) => t.key === c.matchedKey) ? c.matchedKey : clusterKey(cl);
    annotated.push({ lead: cl.lead, outletCount: cl.outletCount, score: cl.score, members: cl.members,
      novelty: { tag, confidence: c.confidence, delta: c.delta, threadKey: key } });
    publishedKeys.push({ key, title: (cl.lead && cl.lead.title) || '' });
  }

  // Proposed next-state of the running threads — promoted only on a successful publish.
  const proposed = { threads: promoteThreads(activeThreads, publishedKeys, now), updatedAt: new Date(now).toISOString() };
  fs.writeFileSync(PROPOSED_FILE, JSON.stringify(proposed, null, 2) + '\n');
  fs.writeFileSync(path.join(__dirname, 'diff.json'),
    JSON.stringify({ generatedAt: new Date(now).toISOString(), clusters: annotated }, null, 2));

  const tally = annotated.reduce((m, a) => { m[a.novelty.tag] = (m[a.novelty.tag] || 0) + 1; return m; }, {});
  console.error(`diff done → diff.json + proposed-threads.json · ${JSON.stringify(tally)}`);
})();
