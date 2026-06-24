#!/usr/bin/env node
'use strict';
/**
 * First Read — stage 3: cluster.
 *
 * Two passes (design §4): a deterministic entity-token grouping seeds clusters,
 * then Haiku refines in ~100-title chunks (schema-by-parse via extractJson). Chunk
 * results are stitched with mergeClusters and ranked by outlet-count/prominence.
 * Degraded modes that never block the pipeline:
 *   - no ANTHROPIC_API_KEY  → entity-pass-only clustering.
 *   - a chunk's Haiku output won't parse → entity-pass fallback for that chunk only.
 *
 * Output: clusters.json (gitignored build artifact; inspected during burn-in).
 * Decision logic is tested in lib/cluster.js; this is the thin API wrapper.
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadDotEnv } = require('./lib/env');
const { callHaiku, extractJson } = require('./lib/claude');
const { entityGroup, mergeClusters, rankClusters } = require('./lib/cluster');

loadDotEnv(__dirname);

const CHUNK_SIZE = 100;
const candidatesDoc = JSON.parse(fs.readFileSync(path.join(__dirname, 'candidates.json'), 'utf8'));
const candidates = candidatesDoc.candidates;
const byId = Object.fromEntries(candidates.map((c) => [c.id, c]));

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Keep only clusters whose member ids exist in this chunk (guards against Haiku
// inventing ids), and drop empties.
function normalize(parsed, chunkIds) {
  if (!Array.isArray(parsed)) return null;
  const valid = new Set(chunkIds);
  const out = parsed
    .map((cl) => ({ members: (cl.members || cl.ids || []).filter((id) => valid.has(id)) }))
    .filter((cl) => cl.members.length > 0);
  return out.length ? out : null;
}

function clusterPrompt(chunkCands) {
  const list = chunkCands.map((c) => `${c.id}: ${c.title}`).join('\n');
  return `Group these news headlines by STORY — items about the same underlying event/story go in one cluster. ` +
    `A headline that is about a unique story is its own single-member cluster. ` +
    `Return ONLY a JSON array, each element {"members": ["<id>", ...]} using the ids exactly as given. No prose.\n\n${list}`;
}

async function refineChunk(chunkCands) {
  const ids = chunkCands.map((c) => c.id);
  const fallback = () => entityGroup(chunkCands);
  if (!process.env.ANTHROPIC_API_KEY) return fallback();
  try {
    const text = await callHaiku(clusterPrompt(chunkCands), { maxTokens: 4000 });
    const parsed = normalize(extractJson(text), ids);
    if (!parsed) { console.error('  ⚠ chunk parse failed → entity fallback'); return fallback(); }
    return parsed;
  } catch (e) {
    console.error(`  ⚠ Haiku error (${e.message}) → entity fallback`);
    return fallback();
  }
}

function attachLead(cluster) {
  // Lead = member with the best (lowest) prominence; carries title + link.
  let lead = null;
  for (const id of cluster.members) {
    const c = byId[id];
    if (!c) continue;
    if (!lead || c.prominence < lead.prominence) lead = c;
  }
  return { ...cluster, lead: lead ? { id: lead.id, title: lead.title, url: lead.url } : null };
}

(async () => {
  const chunks = chunk(candidates, CHUNK_SIZE);
  const usingHaiku = !!process.env.ANTHROPIC_API_KEY;
  console.error(`cluster: ${candidates.length} candidates in ${chunks.length} chunk(s) · ${usingHaiku ? 'Haiku refine' : 'entity-only (no API key)'}`);

  const chunkResults = [];
  for (const ch of chunks) chunkResults.push(await refineChunk(ch));

  const merged = mergeClusters(chunkResults);
  const ranked = rankClusters(merged, byId).map(attachLead);

  fs.writeFileSync(path.join(__dirname, 'clusters.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), count: ranked.length, mode: usingHaiku ? 'haiku' : 'entity-only', clusters: ranked }, null, 2));
  const multi = ranked.filter((c) => c.outletCount > 1).length;
  console.error(`cluster done → clusters.json (${ranked.length} clusters, ${multi} multi-outlet, top score ${ranked[0] ? ranked[0].score.toFixed(2) : 'n/a'})`);
})();
