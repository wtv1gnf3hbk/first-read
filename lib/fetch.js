'use strict';
/**
 * Fetch-stage pure helpers for First Read (design §4 stage 1).
 *
 * The network orchestration (Zyte homepage pulls + escalation, RSS with Zyte 403
 * fallback, budget guard) lives in the top-level fetch.js script, which calls
 * lib/zyte.js. The decision logic that's worth testing without a network lives here:
 *   - parseRssItems: minimal RSS/Atom parser (no xml2js dependency).
 *   - checkSourceFloor: the minimum-source abort rule that protects ranking quality
 *     and skips the state commit on a degenerate fetch.
 */

const MIN_TIER1_SUCCESS = 20;   // design §4: abort if < 20/30 Tier-1 fetches succeed
const YESTERDAY_FRACTION = 0.6; // abort if candidate count < 60% of yesterday's

// Decode the handful of XML/HTML entities that show up in feed titles.
function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#[0-9]+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Parse RSS <item> and Atom <entry> blocks into [{ title, url }]. Tolerant by
// design — returns [] on anything that isn't a feed.
function parseRssItems(xml) {
  if (typeof xml !== 'string') return [];
  const items = [];
  const blockRe = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let b;
  while ((b = blockRe.exec(xml)) !== null) {
    const block = b[0];
    const titleM = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    // RSS uses <link>URL</link>; Atom uses <link href="URL" .../>.
    let url = null;
    const rssLink = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
    const atomLink = block.match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i);
    if (rssLink && rssLink[1].trim()) url = decodeEntities(rssLink[1]);
    else if (atomLink) url = atomLink[1];
    const title = titleM ? decodeEntities(titleM[1]) : '';
    if (url && title) items.push({ title, url });
  }
  return items;
}

// Decide whether the fetch produced enough to publish. Returns { ok, reason }.
// A false `ok` means: abort, skip the state commit, write the reason to
// last-run-status.json (never record stories as "told" on a degenerate run).
function checkSourceFloor({ tier1Succeeded, tier1Total, candidateCount, yesterdayCount }) {
  if (tier1Succeeded < MIN_TIER1_SUCCESS) {
    return { ok: false, reason: `only ${tier1Succeeded}/${tier1Total} Tier-1 fetches succeeded (floor ${MIN_TIER1_SUCCESS})` };
  }
  if (yesterdayCount > 0 && candidateCount < YESTERDAY_FRACTION * yesterdayCount) {
    return { ok: false, reason: `candidate count ${candidateCount} < 60% of yesterday (${yesterdayCount})` };
  }
  return { ok: true, reason: 'ok' };
}

module.exports = { parseRssItems, checkSourceFloor, MIN_TIER1_SUCCESS, YESTERDAY_FRACTION };
