# First Read — Design Document

**Date:** 2026-06-11 (rev 2, post-review — see §12)
**Status:** Revised after Murder Board (Fable, GO-WITH-CHANGES), GPT-5.4 critique, and review-plan. Awaiting Adam's sign-off.
**Working name:** `first-read` (rename freely; repo not yet created on GitHub)

---

## 1. What this is

A daily personal news briefing that replaces the format of the existing `news-briefing`
repo with a **layered 5-minute phone read**, built **Zyte-first** (full article text, not
headlines), with a **broad remit**: international news (core) + markets/econ + tech/AI +
US domestic + science/health + must-read longreads.

Audience: Adam, over morning coffee, on a phone. One reader. No email, no editions.

Key differences from the bureau briefings and the old news-briefing:

| | Old news-briefing / bureau fleet | First Read |
|---|---|---|
| Input | Headlines + RSS summaries (+ analyst bodies) | **Full article text via Zyte** for every story that matters |
| Format | Lead + bullets + Worth Knowing | **Three-layer read** (spine / worth-your-time / ticker) + longread slot |
| Organizing principle | Importance, sections | **Most compelling first; novelty-diffed against prior days** |
| Remit | International | International + markets + tech/AI + US + science/health + longreads |
| Selection unit | Article | **Story cluster** (one story, N outlets' coverage) |

## 2. Format spec

Total budget: **≤ 1,200 words** (5-minute phone scan). Published as a single
mobile-first HTML page on GitHub Pages. No greeting — a date and timestamp, then content.

### Layer 1 — The spine (target 6–8 items, 40–70 words each)

- Each item is a **cluster**: written from the full text of every outlet covering the
  story (typically 2–3 bodies).
- Ordered **most compelling first**. No sections, no per-vertical quotas.
- **Coverage divergence is content** — when outlets differ on framing or facts, the item
  says so. Any specific figure attributed to a named outlet is code-verified against
  that outlet's fetched body (§7, gate F4).
- One link per item: the single best piece, chosen from the bodies.
- Facts must come from body text — never headline rephrase.
- Item counts are **targets, not hard gates**: a thin Tuesday publishes 5 spine items
  rather than padding or blocking (§7).

### Layer 2 — Worth your time (≤ 3 items)

- 2–3 sentences of synthesis **plus one verbatim paragraph**, attributed, blockquoted.
- Quotes are selected by **ID, not free text**: `bodies.js` pre-segments top-cluster
  paragraphs with stable IDs; the writer emits `quote_id` + framing; the renderer
  inserts the exact paragraph text. The model never types the quote, so it cannot
  paraphrase it. (This keeps the proven extract-then-render pattern from news-briefing
  rather than trusting free-form verbatim quoting across ~50 bodies.)

### Layer 3 — The ticker (≤ 8 one-liners)

- Stories that exist but didn't earn space. One line, one link each.
- **Empty beats repeat**, applied with asymmetric caution (§4, diff.js): auto-drop is
  for ticker items only. A spine-tier story tagged as a repeat is rewritten to lead
  with the delta, not deleted — misclassification must never silently remove the top story.

### Longread slot (1–2 items, outside the word budget)

- Daily "dessert": 1–2 pieces worth full attention, each with a one-line case for why.
- Candidates capped at **6/day**, nominated by curator voices (kottke, WITI, Waxy,
  Curious About Everything, The Pudding) and magazine outlets (Atlantic, New Yorker,
  ProPublica). Judged on the **first ~2K words** of the fetched piece (stated
  limitation: a 9,000-word piece is judged by its opening third). Seen-list prevents repeats.

### Voice & style (inherited, enforced)

- Writing rules #1–7 (no 's-contractions for is/has, no "amid", no em-dash run-ons,
  no editorializing, no tacked-on context clauses, no awkward "while" links).
- No unearned synthesis; trust the reader; AI-telltale constructions banned
  (regex-checkable subset enforced in code).
- Wire-service citation rule: "Reuters via Reforma"; link belongs to the host domain.

## 3. Sources

Two tiers, cataloged in `sources.json` (every entry: `tier`, `vertical`, `fetch`
strategy, Zyte mode, **extraction config** — see §4 stage 2).

### Tier 1 — Outlets (~30 candidates; Zyte-scraped; feed the spine)

- **Wires & globals:** NYT, Reuters, AP, BBC, Guardian, Al Jazeera, WaPo
- **Financial:** FT, WSJ, Bloomberg, Economist
- **International depth:** Nikkei Asia, SCMP, Der Spiegel International, Le Monde (EN),
  Haaretz, Kyiv Independent, Semafor, Rest of World
- **US domestic:** Politico, Axios, NPR, ProPublica
- **Tech/AI:** The Verge, Ars Technica, The Information, Wired
- **Science/health:** STAT, Nature News, Quanta, Science (AAAS)
- **Longread grounds:** The Atlantic, New Yorker (+ ProPublica and magazines above)

> **The Tier-1 list is provisional until the Phase-0 paywall matrix (§11).** Zyte
> defeats anti-bot walls, not paywalls — it has no subscriber session. FT, WSJ,
> Bloomberg, The Information, and possibly WaPo/Haaretz may serve teaser-only HTML.
> Phase 0 measures extracted body word-counts per outlet and re-scopes the list.
> An outlet that fails body extraction can still serve in **headline-only mode**
> (its homepage presence counts toward clustering and ranking; its text is never
> quoted or cited for facts) — Adam decides drop vs headline-only per outlet.

### Tier 2 — Voices (~30; RSS; from Adam's Feedly '1st read' folder only)

News/analysis: News Items, Matt Levine, Bloomberg Opinion, Noahpinion, Marginal
Revolution, Net Interest, Molly White, Your Local Epidemiologist, News Minimalist,
Feed Me. Tech/AI: Simon Willison, One Useful Thing, Benj Edwards, Clive Thompson,
Four Short Links, Tom Whitwell. Internet/media: Garbage Day, Read Max, Today in Tabs,
Tab Dump, Gabriel Snyder. Curation: kottke, Waxy, Why Is This Interesting?, The Pudding,
Curious About Everything, Cool Tools. Culture garnish: Perfectly Imperfect, La Briffe,
The Amplifier, Blackbird Spyplane, A Continuous Lean, xkcd.

Voices feed the pipeline as sources — cluster members, ticker items, Layer-2 quotes
(via quote-ID like everything else), longread nominations. **Note:** ~15 voices are
Substacks, which 403 GitHub Actions IPs on every run — those are guaranteed Zyte
fallback calls, counted in the request budget (§8).

### Explicitly cut

The Browser, Sinocism, Stratechery, Platformer, Volts, and everything else outside
'1st read'. No laptop/Bridge dependency anywhere — the pipeline runs entirely in CI.

## 4. Pipeline architecture

Node.js, minimal dependencies, fleet idioms. Each stage is a separate script writing
JSON to disk; any stage can be run and inspected alone.

```
fetch.js → extract.js → cluster.js → bodies.js → diff.js → write.js
        → fix.js → validate.js → render.js → (commit briefing + promote state)
```

| Stage | What it does | Model | Zyte calls |
|---|---|---|---|
| 1. `fetch.js` | Outlets: homepage HTML via Zyte (raw mode; persistent per-domain `browserHtml` escalation map at `state/zyte-escalation.json`). Voices: direct RSS, Zyte fallback on 403 (≈15 guaranteed Substack fallbacks). **Minimum-source floor:** if < 20/30 Tier-1 fetches succeed or candidate count < 60% of yesterday's, abort the run, skip the state commit, write the reason to `last-run-status.json`. | — | ~30 raw + ~15 RSS fallback |
| 2. `extract.js` | **Generic-by-default extraction:** article-URL-shape regex + headline-like-anchor heuristic (the Reuters-fix pattern), configured per domain in `sources.json` (URL regex, base, kill-list, prominence source). Bespoke parsers only where the generic demonstrably fails. Prominence = DOM-order rank within the source's homepage. Per-source minimum-candidate floors; a source yielding 0 candidates is flagged in `last-run-status.json`. URL canonicalization + cross-source dedup (tracking params stripped, same-URL merge). Output: `candidates.json` with stable per-candidate IDs. | — | 0 |
| 3. `cluster.js` | Two-pass: (a) deterministic entity-token grouping; (b) Haiku refinement in **chunks of ~100 titles** with stable candidate IDs, JSON-schema-validated output, and a cross-chunk merge pass. On parse failure: fall back to entity-pass-only clusters (degraded but functional). Rank clusters by outlet count × max prominence. | Haiku | 0 |
| 4. `bodies.js` | Fetch full text for top ~15 clusters (**≤ 3 bodies each**) + longread candidates (≤ 6). **Hard cap: 80 Zyte fetches/run.** Bodies trimmed to **~2K words**. **Per-body quality gate:** minimum word count + paywall-marker detection; a teaser body demotes that outlet to headline-only for the cluster — teaser text never reaches the writer as if it were a body. Paragraph segmentation with stable `quote_id`s for top clusters. Cache by URL hash (ephemeral). | — | ≤ 80 |
| 5. `diff.js` | Novelty pass against `state/threads.json` (running story threads, what was already told, 14-day decay). Tags: `new` / `development` (with the delta) / `rehash`. **Bias rule: low confidence → `development`, never `rehash`.** Writes `state/proposed-threads.json` — **promoted to `state/threads.json` only in the same commit as a successfully published briefing** (a failed run never records stories as "told"). | Haiku | 0 |
| 6. `write.js` | **Single API call**, input engineered to stay **< 190K tokens** (below the 200K long-context pricing boundary): top clusters w/ trimmed bodies + segmented quote IDs + novelty tags + voice items + longread candidates → `briefing.md`. Streaming client, long non-retryable timeout (hard-won rule #17 — no timeout-retry re-billing). **One automatic retry** with the validator's error list appended if validation fails (then degraded publish, §7). | Sonnet 4.6 | 0 |
| 7. `fix.js` | Deterministic auto-fixers: contractions, "amid", quote-ID render verification, ticker repeat-drop, spine same-story dedup. | — | 0 |
| 8. `validate.js` | Two-tier gates (§7): exit 1 = integrity violation (degraded publish), exit 2 = advisory (publish with warnings). | — | 0 |
| 9. `render.js` | `briefing.md` → mobile-first `index.html`. **Always publishes something:** on fatal validation failure after the retry, renders a degraded links-only page (deterministic ticker from `candidates.json`, banner stating what failed). Yesterday's page is never silently left in place. | — | 0 |

State (`state/threads.json`, `state/longreads-seen.json`, `state/zyte-escalation.json`,
`last-run-status.json`) is committed — transactionally, alongside the published
briefing, with a GitHub Actions `concurrency:` group preventing cron/manual races.
`cache/` is gitignored.

### Model choices

- **Haiku 4.5** for clustering + novelty (chunked, schema-validated).
- **Sonnet 4.6** for the single write call. Revisit Opus 4.8 after a few weeks of
  output review.

### Zyte usage policy

- Default `httpResponseBody` (raw). Persistent per-domain escalation map
  (`state/zyte-escalation.json`), flipping a domain to `browserHtml` after 2
  consecutive raw failures. Reference implementation: news-briefing's `fetchViaZyte`
  (contract verified 2026-06-05).
- Per-run budget guard: hard-stop at 150 Zyte requests/run, warn at 100. Per-run
  request count and estimated cost written to `last-run-status.json`.

## 5. Scheduling, publishing, monitoring

- **GitHub Actions cron, daily 09:25 UTC** (≈ 5:25am EDT) + `workflow_dispatch`,
  with a `concurrency:` group. GH cron drift (5–40 min) accepted in v1; CF Worker
  dispatch is the known upgrade.
- GitHub Pages: `https://wtv1gnf3hbk.github.io/first-read/`. Repo `wtv1gnf3hbk/first-read`.
  Secrets: `ZYTE_API_KEY`, `ANTHROPIC_API_KEY`. `gh auth switch --user wtv1gnf3hbk`
  before repo creation (rule #18).
- **Failure surfacing:** `last-run-status.json` is committed on every run including
  failures (source coverage, Zyte spend, validation results, degraded-mode flag).
  **First Read joins the briefings-manager manifest as a monitored repo** so the
  2-hour sweep and morning briefing surface failures — it is not a silent island.
  (Default: monitored, no auto-recipes until burn-in ends — Adam confirms.)
- Web-only. No email.

## 6. HTML page

Mobile-first, single column: system font stack, no JS frameworks, dark-mode via
`prefers-color-scheme`. Timestamp header → spine → Worth Your Time → ticker →
longread card(s). Degraded-mode banner slot. Target < 50KB. Detail deferred to
implementation.

## 7. Validation gates (rule #11: prose rules need code gates)

Two tiers. **Fatal (exit 1)** = integrity violations → triggers the one write retry,
then degraded links-only publish. **Advisory (exit 2)** = publish with warnings in
`last-run-status.json`.

**Fatal (integrity):**
- F1. **Quote integrity:** every blockquote renders from a valid `quote_id`; rendered
  text byte-matches the segmented paragraph.
- F2. **Link integrity:** every URL exists in `candidates.json` or a fetched body.
- F3. **Citation integrity:** facts attributed to an outlet only if that outlet is in
  the item's cluster *with a real body* (headline-only members can't be cited for facts).
- F4. **Figure-attribution check:** any numeral/figure in a sentence naming an outlet
  must appear (normalized) in that outlet's fetched body. Catches "the FT puts it at
  $40B" fabrications — the worst possible failure for this reader.
- F5. Same story twice in the spine (post-dedup).

**Advisory (quality):**
- A1. Word budget ≤ 1,200 (longreads exempt).
- A2. Layer counts (spine 6–8 target, ≤ 3 WYT, ≤ 8 ticker) — short days publish short.
- A3. Style: 's-contraction, "amid", em-dash run-on, AI-telltale regexes, wire-via-host
  citation format.
- A4. Spine rehash items must lead with a delta (fix.js rewrites ticker repeats away;
  spine items get flagged, not dropped).

## 8. Cost model (corrected per review; measure in week 1)

Write-call input is engineered < 190K tokens (≤ 15 clusters × ≤ 3 bodies × ~2K words
≈ 120K tokens of bodies + prompt/quotes/voices overhead ≈ 160–185K total) — below the
200K long-context premium boundary.

| Component | Est./day | Est./month |
|---|---|---|
| Zyte (~30 homepage raw + ~15 Substack fallback + ≤ 80 bodies, some browser-mode) | $0.15–0.70 | $5–21 |
| Haiku (cluster chunks + diff, ~300K in / 25K out) | ~$0.45 | ~$14 |
| Sonnet write (~175K in / 2.5K out, ×2 on retry days) | ~$0.55–0.75 | ~$17–23 |
| **Total** | **~$1.15–1.90** | **~$36–58** |

Levers if hot: 2 bodies/cluster, tighter trims, Haiku batch API (50% off; fine at 5am),
raw-mode discipline. Per-run cost line in `last-run-status.json` from day one.

## 9. Risks & open questions

| Risk | Mitigation |
|---|---|
| **Paywalls (FT, WSJ, Bloomberg, The Information, possibly WaPo/Haaretz):** Zyte beats bot-walls, not subscriber walls | **Phase-0 verification matrix before any build** (§11). Per-body quality gate demotes teasers to headline-only. Adam decides drop vs headline-only per failing outlet. No laptop/Bridge fallback. |
| Economist World in Brief needs login | Excluded from v1. The old puppeteer login stays in news-briefing. |
| Clustering quality (the ranking signal rides on it) | Chunked + schema-validated + merge pass + entity-pass fallback; clusters logged as build artifact; fragmentation watched during burn-in (it undercounts outlet-count and demotes big stories). |
| Generic extraction admits junk (promos, liveblogs) | Per-domain kill-lists; per-source candidate floors; burn-in inspection. |
| GH Actions cron drift | Accept v1; CF Worker dispatch is the upgrade. |
| Zyte cost overrun | 150-request hard cap + per-run cost logging. |
| State corruption / cron-manual race | Transactional state promotion + `concurrency:` group. |
| Partial fetch failure skews ranking | Minimum-source floor aborts the run and skips state commit. |
| Long-context format adherence (single 175K-token write) | Two-tier gates + one validator-feedback retry + degraded publish. |
| Old news-briefing duplication | Both run during burn-in; Adam retires news-briefing when First Read sticks. |

## 10. Explicitly not building (YAGNI)

- Email delivery, editions, A/B testing
- Feedback widget (retrofit via `briefing-feedback` later)
- Cloudflare Worker refresh button (v2 if cron drift annoys)
- RSS/JSON output, screenshot vision, source-layer integration
- Analyst paywall cache / Bridge manifests
- External KV state store (GPT suggestion — rejected: transactional git state keeps
  the fleet pattern and avoids a new dependency)

## 11. Build plan (high level — detailed plan doc follows approval)

**Phase 0 — paywall verification spike (before any other code).** Fetch 3 article
bodies from each paywalled Tier-1 outlet via Zyte raw and browser modes; record
extracted word counts; produce the matrix; re-scope Tier 1 with Adam. This is the only
step that can invalidate the premise.

1. Scaffold repo, `sources.json`, Zyte fetcher module + escalation map, CI skeleton.
2. `fetch` + `extract` (generic-by-default) for all surviving outlets.
3. `cluster` + `bodies` + `diff` with logged artifacts.
4. `write` + `fix` + `validate` + `render`, including degraded mode.
5. Burn-in week: daily alongside news-briefing; measure Zyte cost; inspect clusters;
   tune the writer prompt against real mornings. Add to briefings-manager manifest.

Tests first per fleet convention (`node --test`, unquoted globs — rule #14): extraction
fixtures, validator units (esp. F1–F4), cluster heuristics, state promotion logic.

## 12. Review log (2026-06-11)

- **review-plan:** ESCALATE (3 flags: unproven clustering, stage inflation, parser
  maintenance) → escalated to Murder Board.
- **Murder Board (fresh Fable 5 instance):** GO-WITH-CHANGES. 1 blocker (unverified
  paywall premise → Phase 0), 10 serious (cost math ~2–3x off and crossing the 200K
  pricing boundary; quote-restore impossible without extraction stage; contradictory
  gates; silent-stale-page failure mode; state corruption on failed runs; no
  minimum-source floor; clustering underspecified; unverified divergence claims;
  parser-grind inversion; rehash over-suppression), 4 minor (escalation-map
  persistence, Substack 403 budget, longread caps, rule #17 streaming). All
  incorporated above.
- **GPT-5.4 critique:** same core themes independently (degraded-mode publishing,
  clustering brittleness, novelty-state drift, source-count overreach, validator
  false-negatives, observability). Adopted via the Murder Board fixes. Rejected:
  external KV state store; cutting sources to 8–12 (generic-by-default extraction
  makes ~30 sources cheap to carry — revisit if burn-in says otherwise); dropping
  persistent threads entirely (the novelty diff is the product's reason to exist;
  hardened instead via transactional promotion + bias-to-development).
