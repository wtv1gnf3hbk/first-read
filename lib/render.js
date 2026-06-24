'use strict';
/**
 * First Read — render helpers.
 *
 * M2 ships only `renderSkeleton`: a mobile-first single-column page that lists the
 * deduped candidate links straight from candidates.json. It exists so the end-to-end
 * pipeline produces a REAL page before the writer/clustering stages land. The full
 * three-layer renderer (spine / worth-your-time / ticker / longread, quote cards,
 * degraded mode) replaces this in Milestone 4.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Shared <head> + base styles: system fonts, dark mode, <50KB, no JS.
const HEAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>First Read</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         max-width: 40rem; margin: 0 auto; padding: 1.25rem; line-height: 1.5;
         background: #fff; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #14171a; color: #e6e6e6; } a { color: #7db4ff; } }
  header { border-bottom: 1px solid #8884; padding-bottom: .5rem; margin-bottom: 1rem; }
  h1 { font-size: 1.25rem; margin: 0; }
  h2 { font-size: .95rem; text-transform: uppercase; letter-spacing: .05em; color: #8888; margin: 1.6rem 0 .6rem; }
  .meta { color: #8888; font-size: .8rem; }
  .banner { background: #ffb70022; border: 1px solid #ffb70088; padding: .5rem .75rem;
            border-radius: .4rem; font-size: .85rem; margin-bottom: 1rem; }
  ul { list-style: none; padding: 0; }
  li { margin: 0 0 .9rem; }
  .src { color: #8888; font-size: .75rem; }
  .spine-item { margin: 0 0 1.1rem; }
  .spine-item .head { font-weight: 600; }
  .delta { color: #c0392b; font-size: .75rem; text-transform: uppercase; letter-spacing: .03em; }
  @media (prefers-color-scheme: dark) { .delta { color: #ff8a7a; } }
  .wk-card { margin: 0 0 1.1rem; padding: .75rem 1rem; border-left: 3px solid #8886; background: #8881; border-radius: .3rem; }
  .wk-card blockquote { margin: .4rem 0; font-style: italic; }
  .wk-card figcaption { font-size: .75rem; color: #8888; }
  .why { color: #8888; font-size: .85rem; }
</style>
</head>
<body>`;

function renderSkeleton(candidates = [], opts = {}) {
  const when = opts.generatedAt || '';
  const items = candidates.map((c) => {
    const srcs = (c.sources || []).join(', ');
    return `  <li><a href="${escapeHtml(c.url)}">${escapeHtml(c.title)}</a>` +
      (srcs ? ` <span class="src">${escapeHtml(srcs)}</span>` : '') + `</li>`;
  }).join('\n');

  return `${HEAD}
<header>
  <h1>First Read</h1>
  <div class="meta">${escapeHtml(when)}</div>
</header>
<div class="banner">SKELETON — candidate links only. The layered briefing renders here once the writer stage (M4) lands.</div>
<ul>
${items}
</ul>
</body>
</html>
`;
}

// Map every quote_id → exact segment text across all bodies. The renderer inserts
// this text; the writer only ever emitted the id (quote-by-ID contract, design §2).
function quoteMap(bodies) {
  const m = new Map();
  const all = [...((bodies && bodies.clusters) || []).flatMap((c) => c.bodies || []), ...((bodies && bodies.longreads) || [])];
  for (const b of all) (b.quotes || []).forEach((q) => m.set(q.quote_id, q.text));
  return m;
}

// Full three-layer page: spine / worth-your-time (quote cards) / ticker / longreads.
function renderBriefing(briefing, { bodies } = {}) {
  const quotes = quoteMap(bodies);
  const when = briefing.generatedAt || '';

  const spine = (briefing.spine || []).map((s) => {
    const delta = s.novelty && (s.novelty.tag === 'development' || s.novelty.tag === 'rehash') && s.novelty.delta
      ? `<div class="delta">Update: ${escapeHtml(s.novelty.delta)}</div>` : '';
    const link = s.link_url ? ` <a href="${escapeHtml(s.link_url)}">→</a>` : '';
    return `  <div class="spine-item">${delta}<span class="head">${escapeHtml(s.headline || '')}.</span> ${escapeHtml(s.text || '')}${link}</div>`;
  }).join('\n');

  // Worth-your-time: synthesis + verbatim quote card (skip cleanly if id unresolved).
  const worth = (briefing.worth || []).map((w) => {
    const text = quotes.get(w.quote_id);
    if (!text) return `  <div>${escapeHtml(w.synthesis || '')}</div>`;
    const cap = w.attribution ? `<figcaption>— ${escapeHtml(w.attribution)}</figcaption>` : '';
    const link = w.link_url ? ` <a href="${escapeHtml(w.link_url)}">→</a>` : '';
    return `  <div>${escapeHtml(w.synthesis || '')}${link}</div>\n` +
      `  <figure class="wk-card"><blockquote>${escapeHtml(text)}</blockquote>${cap}</figure>`;
  }).join('\n');

  const ticker = (briefing.ticker || []).map((t) =>
    `  <li><a href="${escapeHtml(t.url)}">${escapeHtml(t.text)}</a></li>`).join('\n');

  const longreads = (briefing.longreads || []).map((l) =>
    `  <div class="spine-item"><a href="${escapeHtml(l.url)}">${escapeHtml(l.title)}</a>` +
    (l.why ? ` <span class="why">${escapeHtml(l.why)}</span>` : '') + `</div>`).join('\n');

  const section = (title, body) => body ? `<h2>${title}</h2>\n${body}\n` : '';

  return `${HEAD}
<header>
  <h1>First Read</h1>
  <div class="meta">${escapeHtml(when)}</div>
</header>
${spine ? spine + '\n' : ''}${section('Worth your time', worth)}${section('The ticker', ticker ? `<ul>\n${ticker}\n</ul>` : '')}${section('Longreads', longreads)}</body>
</html>
`;
}

// Degraded fallback: a links-only page with a banner stating what failed. Published
// instead of a stale page when validation fails after the write retry (design §9).
function renderDegraded(candidates = [], reason = '') {
  const items = candidates.slice(0, 30).map((c) =>
    `  <li><a href="${escapeHtml(c.url)}">${escapeHtml(c.title || c.url)}</a></li>`).join('\n');
  return `${HEAD}
<header>
  <h1>First Read</h1>
  <div class="meta">degraded mode</div>
</header>
<div class="banner">Today's briefing could not be assembled (reason: ${escapeHtml(reason)}). Showing today's top links only — not yesterday's page.</div>
<ul>
${items}
</ul>
</body>
</html>
`;
}

module.exports = { renderSkeleton, renderBriefing, renderDegraded, escapeHtml, quoteMap };
