'use strict';
/**
 * Novelty / running-thread primitives for First Read (design §4 stage 5).
 *
 * diff.js (the script) asks Haiku to classify each cluster against the running
 * threads in state/threads.json as new / development / rehash, then applies the
 * BIAS RULE here (low-confidence rehash → development — a misclassified top story
 * must never be silently suppressed). It writes state/proposed-threads.json;
 * promoteThreads is applied at PUBLISH time (M4 commit step) so a failed run never
 * records stories as "told". Threads decay over 14 days via pruneThreads.
 *
 * Pure functions only — no API calls, no I/O. Times are epoch ms (passed in, so the
 * functions stay deterministic and testable).
 */

const DECAY_DAYS = 14;
const REHASH_CONFIDENCE_FLOOR = 0.5; // below this, a 'rehash' is downgraded to 'development'

// Drop threads not seen within `days` of `now`.
function pruneThreads(threads, now, days = DECAY_DAYS) {
  const cutoff = now - days * 86400000;
  return (threads || []).filter((t) => typeof t.lastSeen === 'number' && t.lastSeen >= cutoff);
}

// Apply the asymmetric-caution bias: only a CONFIDENT rehash stays a rehash;
// an uncertain one becomes a development (which leads with the delta, not dropped).
function applyNoveltyBias(tag, confidence, floor = REHASH_CONFIDENCE_FLOOR) {
  if (tag === 'rehash' && confidence < floor) return 'development';
  return tag;
}

// Merge today's published clusters into the running threads. Existing keys bump
// lastSeen + seenCount (firstSeen preserved); new keys are added; untouched older
// threads are retained (they age out via pruneThreads). Used at publish time only.
function promoteThreads(threads, publishedClusters, now) {
  const byKey = new Map((threads || []).map((t) => [t.key, { ...t }]));
  for (const c of publishedClusters || []) {
    const existing = byKey.get(c.key);
    if (existing) {
      existing.lastSeen = now;
      existing.seenCount = (existing.seenCount || 0) + 1;
      if (c.title) existing.title = c.title; // keep the latest framing
    } else {
      byKey.set(c.key, { key: c.key, title: c.title, firstSeen: now, lastSeen: now, seenCount: 1 });
    }
  }
  return [...byKey.values()];
}

module.exports = { pruneThreads, applyNoveltyBias, promoteThreads, DECAY_DAYS, REHASH_CONFIDENCE_FLOOR };
