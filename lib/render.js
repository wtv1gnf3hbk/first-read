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
  .meta { color: #8888; font-size: .8rem; }
  .banner { background: #ffb70022; border: 1px solid #ffb70088; padding: .5rem .75rem;
            border-radius: .4rem; font-size: .85rem; margin-bottom: 1rem; }
  ul { list-style: none; padding: 0; }
  li { margin: 0 0 .9rem; }
  .src { color: #8888; font-size: .75rem; }
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

module.exports = { renderSkeleton, escapeHtml };
