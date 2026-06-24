'use strict';
/**
 * Deterministic auto-fixers for First Read (design §4 stage 7).
 *
 * Run after the writer, before validation, to mechanically clear the cheap,
 * unambiguous style/structure violations so the (advisory) validator stays quiet and
 * the writer-retry budget is spent on things only the model can fix. Conservative by
 * design — a fixer that might corrupt meaning is left as an advisory instead.
 *
 * Pure: each fixer takes a value and returns the fixed value; applyFixes runs them
 * over a briefing and returns { briefing, changes }.
 */

const { canonicalizeUrl } = require('./extract');

// Verbs where "<Noun>'s <verb>" means "<Noun> has/is <verb>" — the rule-#1 trap.
// (Possessive "Disney's CEO" is safe: CEO/profits/etc. are not in this list.)
const HAS_IS_VERBS = 'named|said|announced|launched|unveiled|set|been|expected|now|warned|added|agreed|signed|won|lost|filed|raised|cut';

// "Disney's named" → "Disney named". Only fires before a known has/is verb.
function fixContractions(text) {
  return String(text).replace(new RegExp(`\\b([A-Za-z][\\w]+)'s\\s+(${HAS_IS_VERBS})\\b`, 'g'), '$1 $2');
}

// Banned word "amid" → "during" (a clean temporal drop-in that avoids the awkward
// "as"/"while" constructions rules #3/#6 also ban).
function removeAmid(text) {
  return String(text).replace(/\bamid\b/gi, 'during');
}

// Apply the text fixers to every prose field of the briefing.
function fixProse(briefing) {
  const fix = (t) => removeAmid(fixContractions(t));
  return {
    ...briefing,
    spine: (briefing.spine || []).map((s) => ({ ...s, text: s.text ? fix(s.text) : s.text })),
    worth: (briefing.worth || []).map((w) => ({ ...w, synthesis: w.synthesis ? fix(w.synthesis) : w.synthesis })),
    ticker: (briefing.ticker || []).map((t) => ({ ...t, text: t.text ? fix(t.text) : t.text })),
  };
}

// Drop ticker items whose URL already appears in the spine (empty beats repeat).
function dropTickerRepeats(briefing) {
  const spineLinks = new Set((briefing.spine || []).map((s) => s.link_url && canonicalizeUrl(s.link_url)).filter(Boolean));
  return { ...briefing, ticker: (briefing.ticker || []).filter((t) => !(t.url && spineLinks.has(canonicalizeUrl(t.url)))) };
}

// Collapse spine items sharing a link to the first occurrence.
function dedupeSpine(briefing) {
  const seen = new Set();
  const spine = [];
  for (const s of briefing.spine || []) {
    const u = s.link_url ? canonicalizeUrl(s.link_url) : null;
    if (u && seen.has(u)) continue;
    if (u) seen.add(u);
    spine.push(s);
  }
  return { ...briefing, spine };
}

function applyFixes(briefing) {
  const before = JSON.stringify(briefing);
  let out = fixProse(briefing);
  out = dedupeSpine(out);
  out = dropTickerRepeats(out);
  const changes = [];
  if (JSON.stringify(out.spine) !== JSON.stringify(briefing.spine)) changes.push('spine prose/dedupe');
  if (JSON.stringify(out.ticker) !== JSON.stringify(briefing.ticker)) changes.push('ticker repeats/prose');
  if (JSON.stringify(out.worth) !== JSON.stringify(briefing.worth)) changes.push('worth prose');
  if (JSON.stringify(out) === before) changes.length = 0;
  return { briefing: out, changes };
}

module.exports = { fixContractions, removeAmid, fixProse, dropTickerRepeats, dedupeSpine, applyFixes, HAS_IS_VERBS };
