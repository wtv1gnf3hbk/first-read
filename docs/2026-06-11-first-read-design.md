# First Read — Design Document

**Date:** 2026-06-11
**Status:** Draft for review (Murder Board + GPT critique pending)
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
mobile-first HTML page on GitHub Pages. No greeting, no date headline theatrics —
the date and a timestamp, then content.

### Layer 1 — The spine (6–8 items, 40–70 words each)

- Each item is a **cluster**: written from the full text of every outlet covering the
  story (typically 2–4 bodies).
- Ordered **most compelling first**. No sections, no per-vertical quotas. On a heavy
  geopolitics day markets can get zero items; on a slow day a science story can lead.
- **Coverage divergence is content.** When outlets differ on framing or facts, the item
  says so: "The FT puts the figure at $40B; Xinhua omits the casualty count entirely."
- One link per item: the single best piece, chosen from the bodies, not the headlines.
- Facts must come from body text (named sources, real numbers) — never headline rephrase.

### Layer 2 — Worth your time (2–3 items)

- Stories that earn more than 70 words: 2–3 sentences of synthesis **plus one verbatim
  paragraph** from the strongest piece, attributed, blockquoted.
- Verbatim discipline is code-gated (see §7): the quoted text must be an exact substring
  of the fetched body. Paraphrase presented as quote = hard validation error.

### Layer 3 — The ticker (≤ 8 one-liners)

- Stories that exist but didn't earn space. One line, one link each.
- **Empty beats repeat** at every layer: a story already told in a prior briefing appears
  only if something genuinely changed, and the item leads with the change.

### Longread slot (1–2 items, outside the word budget)

- Daily "dessert": one or two pieces worth Adam's full attention, each with a one-line
  case for why — judged from the full text (Zyte fetches the piece), not the headline.
- Candidates can be days old; novelty rules don't apply. A seen-list prevents repeats.

### Voice & style (inherited, enforced)

- Writing rules #1–7 (no 's-contractions for is/has, no "amid", no em-dash run-ons,
  no editorializing, no tacked-on context clauses, no awkward "while" links).
- No unearned synthesis: the lead never reaches for a grand unifying frame the evidence
  can't carry. Trust the reader: state facts in revealing order and stop.
- AI-telltale constructions banned (the "not just X but Y" / triadic-abstract-list /
  "what X actually looks like" family) — regex-checkable subset enforced in code.
- Wire-service citation rule: wire copy carried by another outlet cites "Reuters via
  Reforma"; the link belongs to the host domain.

## 3. Sources

Two tiers. The full catalog lives in `sources.json` (single config file; every entry has
`tier`, `vertical`, `fetch` strategy, and Zyte mode).

### Tier 1 — Outlets (~30; Zyte-scraped homepages/sections; feed the spine)

- **Wires & globals:** NYT, Reuters, AP, BBC, Guardian, Al Jazeera, WaPo
- **Financial:** FT, WSJ, Bloomberg, Economist
- **International depth:** Nikkei Asia, SCMP, Der Spiegel International, Le Monde (EN),
  Haaretz, Kyiv Independent, Semafor, Rest of World
- **US domestic:** Politico, Axios, NPR, ProPublica
- **Tech/AI:** The Verge, Ars Technica, The Information, Wired
- **Science/health:** STAT, Nature News, Quanta, Science (AAAS)
- **Longread grounds:** The Atlantic, New Yorker (+ ProPublica and magazines above)

### Tier 2 — Voices (~30; RSS, mostly free; from Adam's Feedly '1st read' folder only)

News/analysis: News Items, Matt Levine, Bloomberg Opinion, Noahpinion, Marginal
Revolution, Net Interest, Molly White, Your Local Epidemiologist, News Minimalist,
Feed Me. Tech/AI: Simon Willison, One Useful Thing, Benj Edwards, Clive Thompson,
Four Short Links, Tom Whitwell. Internet/media: Garbage Day, Read Max, Today in Tabs,
Tab Dump, Gabriel Snyder. Curation: kottke, Waxy, Why Is This Interesting?, The Pudding,
Curious About Everything, Cool Tools. Culture garnish: Perfectly Imperfect, La Briffe,
The Amplifier, Blackbird Spyplane, A Continuous Lean, xkcd.

Voices are not a separate section (Worth Knowing is dead). They feed the pipeline as
sources: a voice item can join a cluster (Levine on a markets story), surface a ticker
item, supply a Layer-2 quote, or nominate a longread. Verbatim discipline applies
whenever a voice is quoted.

### Explicitly cut

The Browser, Sinocism, Stratechery, Platformer, Volts, and everything else from the
other Feedly folders (Adam's call: '1st read' only). The paywalled analyst tier's
laptop-cron/Bridge dependency is **not** carried over — this pipeline must run entirely
in CI with no laptop dependency. (Risk: Levine/Bloomberg via Zyte is unverified — §9.)

## 4. Pipeline architecture

Node.js, minimal dependencies, same idioms as the existing fleet. Each stage is a
separate script writing JSON to disk, so any stage can be run and inspected alone.

```
fetch.js → extract.js → cluster.js → bodies.js → diff.js → write.js
        → fix.js → validate.js → render.js → (commit & publish)
```

| Stage | What it does | Model | Zyte calls |
|---|---|---|---|
| 1. `fetch.js` | Outlets: homepage HTML via Zyte (raw mode; per-domain `browserHtml` escalation map). Voices: direct RSS, Zyte fallback on 403. | — | ~30 raw |
| 2. `extract.js` | Parse homepages → candidate `{title, url, source, prominence}`. Per-source parsers with a generic article-URL-shape fallback (the Reuters-fix pattern). Parse RSS items. Output: `candidates.json` (~300–600/day). | — | 0 |
| 3. `cluster.js` | Group candidates into story clusters. Cheap entity-token pass first, then one Haiku call over all titles to refine. Rank clusters by outlet count × prominence. | Haiku | 0 |
| 4. `bodies.js` | Fetch full text for top ~15 clusters (≤ 4 bodies each) + longread candidates. **Hard cap: 80 article fetches/run.** Bodies trimmed to ~3K words, cached by URL hash. Strip to text via readability-style extraction. | — | ≤ 80 |
| 5. `diff.js` | Novelty pass: compare clusters against `state/threads.json` (running story threads, what was already told, 14-day decay). Tag each cluster `new` / `development` (with the delta) / `rehash`. | Haiku | 0 |
| 6. `write.js` | **Single API call**: top clusters w/ bodies + novelty tags + voice items + longread candidates → `briefing.md` per format spec. Same single-shot philosophy that beat the 3-pass chain. | Sonnet 4.6 | 0 |
| 7. `fix.js` | Deterministic auto-fixers (ported/adapted): contractions, "amid", verbatim-quote restore, repeat-drop vs yesterday. | — | 0 |
| 8. `validate.js` | Code gates, exit 0/1/2 (§7). | — | 0 |
| 9. `render.js` | `briefing.md` → mobile-first `index.html`. | — | 0 |

State (`state/threads.json`, `state/longreads-seen.json`, `last-run-status.json`) is
committed; `cache/` is gitignored (ephemeral per CI run; actions/cache optional later).

### Model choices

- **Haiku 4.5** for clustering + novelty (high volume, structured output, cheap).
- **Sonnet 4.6** for the single write call — proven in the current pipeline; the writer
  receives ~80–120K tokens of bodies and produces ~2K. Revisit Opus 4.8 (~2× write cost,
  ~$0.40/day extra) after a few weeks of output review, not before.

### Zyte usage policy

- Default `httpResponseBody` (raw, cheap). Per-domain escalation map starts with the
  known case (`nytimes.com` → `browserHtml`) and grows by observed failure, flipping a
  domain after 2 consecutive raw-mode failures. The 2026-06-05 `fetchViaZyte` contract
  is the reference implementation.
- Per-run budget guard: counter in `last-run-status.json`; hard-stop at 150 Zyte
  requests/run, warn at 100. Cost visibility from day one.

## 5. Scheduling & publishing

- **GitHub Actions cron, daily 09:25 UTC** (≈ 5:25am EDT) + `workflow_dispatch` manual
  trigger. GH cron can run 5–40 min late; acceptable for v1. (Known fix if it grates:
  Cloudflare Worker cron triggering repository_dispatch, the dach-digest pattern.)
- Publishes to GitHub Pages: `https://wtv1gnf3hbk.github.io/first-read/`.
- Repo: `wtv1gnf3hbk/first-read`, **private code is fine but Pages must be public** —
  same as the rest of the fleet. Secrets: `ZYTE_API_KEY`, `ANTHROPIC_API_KEY`.
- `gh auth switch --user wtv1gnf3hbk` before repo creation (hard-won rule #18).
- Web-only. No email, ever, unless Adam asks (no send-email.js, no email-once guard
  needed).

## 6. HTML page

Mobile-first, single column, fast: system font stack, no JS frameworks, dark-mode via
`prefers-color-scheme`. Structure: timestamp header → spine (numbered items) →
Worth Your Time (blockquotes) → ticker (compact list) → longread card(s). Inline links
only — no footnotes. Target < 50KB total. Design detail deferred to implementation;
this is deliberately the least interesting part.

## 7. Validation gates (rule #11: prose rules need code gates)

`validate-draft.js` equivalent, adapted. Exit 1 = publish blocked.

1. Word budget: body ≤ 1,200 words (longread slot exempt).
2. Layer structure: 6–8 spine items, ≤ 3 worth-your-time, ≤ 8 ticker lines.
3. **Verbatim quotes:** every blockquote must be a normalized substring of a fetched
   body (Check 15 port, including the `normalizeForMatch` quote-handling lessons).
4. **Link integrity:** every URL in the briefing must exist in `candidates.json` or a
   fetched body — no hallucinated links, period.
5. **Citation integrity:** an item may attribute a fact to an outlet only if that outlet
   is in the item's cluster (catches "the FT reports" when no FT piece was fetched).
6. Style: 's-contraction detector, "amid", em-dash run-on heuristic, AI-telltale regex
   subset, wire-via-host citation format.
7. Repeat-drop: any spine/ticker item whose cluster is tagged `rehash` and whose text
   doesn't lead with a delta is dropped (fix.js), and an all-rehash briefing publishes
   short rather than padded.

## 8. Cost model (estimates — measure in week 1)

| Component | Est./day | Est./month |
|---|---|---|
| Zyte (~30 homepage raw + ≤ 80 bodies, some browser-mode) | $0.10–0.60 | $3–18 |
| Haiku (cluster + diff, ~250K in / 20K out) | ~$0.35 | ~$11 |
| Sonnet write (~120K in / 2.5K out) | ~$0.40 | ~$12 |
| **Total** | **~$0.85–1.35** | **~$26–41** |

Levers if it runs hot: fewer bodies per cluster, body trim length, raw-mode discipline,
Haiku batch API (50% off, latency-tolerant at 5am).

## 9. Risks & open questions

| Risk | Mitigation |
|---|---|
| Bloomberg (Levine, Opinion) & The Information may defeat Zyte raw *and* browser modes | Test in week 1. If they fail: drop them (Adam decides) — **no laptop/Bridge fallback** in this design. |
| Economist World in Brief needs login; Zyte can't replicate the credentialed session | Try Zyte browser on public Economist pages; World in Brief gobbets may be excluded in v1. The old puppeteer login stays in news-briefing, not here. |
| Clustering quality — bad clusters poison the spine | Clusters logged as a build artifact for inspection; entity-pass + Haiku refine; iterate on real output. |
| GH Actions cron drift (5–40 min) | Accept in v1; CF Worker dispatch is the known upgrade. |
| Zyte cost overrun | Hard request cap per run + per-run cost line in `last-run-status.json`. |
| Writer context size (15 clusters × 4 bodies × 3K words ≈ 130K tokens) | Body trim + per-cluster body cap; Sonnet 4.6 has 1M context — headroom is fine, cost is the constraint. |
| Old news-briefing duplication (both run daily) | Keep both during burn-in; Adam retires news-briefing when First Read sticks. No code shared; clean break. |

## 10. Explicitly not building (YAGNI)

- Email delivery, editions, A/B testing
- Feedback widget (retrofit via `briefing-feedback` skill later if wanted)
- Cloudflare Worker refresh button (v2 if cron drift annoys)
- RSS/JSON feed output, screenshot vision, source-layer integration
- Any reuse of the analyst paywall cache / Bridge manifests

## 11. Build plan (high level — detailed plan doc follows approval)

1. Scaffold repo, `sources.json`, Zyte fetcher module + escalation map, CI skeleton.
2. `fetch` + `extract` working for all ~30 outlets (the parser grind — biggest chunk).
3. `cluster` + `bodies` + `diff` with logged artifacts.
4. `write` + `fix` + `validate` + `render`.
5. Burn-in week: run daily alongside news-briefing, measure Zyte cost, tune clusters
   and the writer prompt against real mornings.

Tests first per repo convention (`node --test`, unquoted globs — rule #14): parser
fixtures per outlet, validator unit tests, cluster heuristic tests.
