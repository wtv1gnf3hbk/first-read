'use strict';
/**
 * Clustering primitives for First Read (design §4 stage 3).
 *
 * cluster.js (the script) runs two passes: a deterministic entity-token grouping
 * (this module) seeds groups, then Haiku refines in ~100-title chunks, then
 * mergeClusters stitches the chunks back together. On Haiku parse failure the
 * script falls back to entityGroup alone (degraded but functional). rankClusters
 * orders the result.
 *
 * Pure functions only — no API calls here (those live in cluster.js).
 */

// Common words that carry no clustering signal. Kept small + general.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for', 'with',
  'as', 'by', 'from', 'into', 'over', 'after', 'before', 'is', 'are', 'was', 'were',
  'be', 'been', 'has', 'have', 'had', 'will', 'would', 'can', 'could', 'says', 'say',
  'said', 'new', 'amid', 'about', 'up', 'down', 'out', 'off', 'than', 'that', 'this',
  'it', 'its', 'their', 'his', 'her', 'they', 'we', 'you', 'he', 'she', 'who', 'what',
]);

// Significant tokens for entity grouping: lowercase, >=4 chars (or all-caps acronyms /
// numbers), stopwords removed, deduped. Errs toward shared proper nouns / topics.
function entityTokens(title) {
  const seen = new Set();
  const out = [];
  for (const rawTok of String(title).split(/[^A-Za-z0-9]+/)) {
    if (!rawTok) continue;
    const tok = rawTok.toLowerCase();
    if (STOPWORDS.has(tok)) continue;
    const isAcronymOrNum = /^[A-Z0-9]{2,}$/.test(rawTok) || /\d/.test(rawTok);
    if (tok.length < 4 && !isAcronymOrNum) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

// Deterministic first-pass grouping: union candidates that share >= MIN_SHARED
// salient tokens. Single-link clustering over the shared-entity graph.
function entityGroup(candidates, minShared = 2) {
  const tokens = candidates.map((c) => new Set(entityTokens(c.title)));
  const parent = candidates.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (x, y) => { parent[find(x)] = find(y); };

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      let shared = 0;
      for (const t of tokens[i]) if (tokens[j].has(t)) shared++;
      if (shared >= minShared) union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < candidates.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(candidates[i].id);
  }
  return [...groups.values()].map((members) => ({ members }));
}

// Merge clusters across chunks: any two clusters sharing a member id become one.
// Input: array of chunk results, each an array of { members: [id...] }.
function mergeClusters(chunks) {
  const all = chunks.flat();
  const merged = [];
  for (const cluster of all) {
    const members = new Set(cluster.members);
    // Absorb any already-merged cluster that overlaps.
    for (let i = merged.length - 1; i >= 0; i--) {
      if (merged[i].some((m) => members.has(m))) {
        merged[i].forEach((m) => members.add(m));
        merged.splice(i, 1);
      }
    }
    merged.push([...members]);
  }
  return merged.map((members) => ({ members }));
}

// Rank by distinct-outlet count (primary importance signal), with a sub-1
// prominence boost as a tiebreak — so a higher homepage placement can break a tie
// but never overtake a story carried by a full extra outlet.
function rankClusters(clusters, candidatesById) {
  return clusters
    .map((cl) => {
      const outlets = new Set();
      let bestProminence = Infinity;
      for (const id of cl.members) {
        const c = candidatesById[id];
        if (!c) continue;
        (c.sources || []).forEach((s) => outlets.add(s));
        if (typeof c.prominence === 'number') bestProminence = Math.min(bestProminence, c.prominence);
      }
      if (!isFinite(bestProminence)) bestProminence = 999;
      const outletCount = outlets.size;
      const score = outletCount + 1 / (bestProminence + 1);
      return { ...cl, outletCount, bestProminence, score };
    })
    .sort((a, b) => b.score - a.score);
}

module.exports = { entityTokens, entityGroup, mergeClusters, rankClusters, STOPWORDS };
