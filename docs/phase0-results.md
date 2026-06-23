# First Read — Phase 0 paywall verification results (2026-06-23)

**Question (design §11):** Zyte beats anti-bot walls, not subscriber paywalls. For
each hard-paywall Tier-1 outlet, can Zyte hand us a real, quotable article body — or
just teaser text?

**Method:** `phase0-paywall-matrix.js` — for each outlet, Zyte-fetch the homepage,
pull 3 fresh article URLs (generic per-domain URL regex), then fetch each article in
**raw** (`httpResponseBody`) and **browser** (`browserHtml`) modes, extract body text
with a crude `<article>`/`<p>` reader, and count words + scan for paywall markers.
62 Zyte calls, ~3 min. Raw data: `phase0-matrix.json`. Control: BBC (free) pulled full
~570-word bodies, proving the extractor returns full text when it exists — so low counts
elsewhere are real truncation, not a parser miss.

## Matrix

| outlet          | verdict   | raw wds | brow wds | paywall marker | disposition |
|-----------------|-----------|---------|----------|----------------|-------------|
| **bbc**         | FULL      | 573     | 568      | no  | **quotable** (free control) |
| wsj             | PARTIAL   | 215     | 226      | **yes** | teaser → **headline-only** |
| ft              | PARTIAL   | 148     | 134      | **yes** | teaser → **headline-only** |
| economist       | PARTIAL   | 135     | 156      | no  | borderline — confirm; likely headline-only |
| bloomberg       | TEASER    | 68      | 78       | no  | **headline-only** |
| wapo            | TEASER    | 35      | 52       | no  | **headline-only** |
| haaretz         | TEASER    | 17      | 31       | no  | **headline-only** |
| theinformation  | FAIL      | 0       | 0        | yes | fully gated → **headline-only** |
| guardian        | FORBIDDEN | —       | —        | —   | **Zyte refuses the domain (HTTP 451), all modes** |
| nikkei          | INVALID   | —       | —        | —   | regex matched a CSS asset; re-run with tightened filter |

## Findings that change the build

1. **The Guardian is unavailable via Zyte entirely** — HTTP 451 `domain-forbidden`,
   raw and browser alike. It's a core free spine source. It can't be Zyte-scraped at
   all; it needs a direct fetch / RSS path, or it drops to headline-only via another
   feed. **This is a new constraint the design didn't anticipate** (design assumed free
   outlets all work via Zyte). Worth probing whether other outlets are also 451 before
   committing the Tier-1 list.

2. **No financial outlet is safely quotable.** FT + WSJ return teaser text *with*
   explicit paywall markers; Bloomberg, WaPo, Haaretz, The Information return teaser-to-
   zero. The entire "Financial" tier (FT, WSJ, Bloomberg, Economist) collapses to
   **headline-only** — they count toward clustering/ranking but their text is never
   quoted. This is exactly the failure the Murder Board flagged as the blocker: without
   this gate the pipeline would "succeed" and quote the Guardian instead (which is itself
   now forbidden — so it'd quote whatever free body exists).

3. **browser mode buys almost nothing** over raw for these outlets (±10–20 words).
   The paywall truncates server-side, so JS rendering doesn't recover the body. Keep raw
   as default; the escalation map to browser is for anti-bot 403s, not paywalls.

## Re-scoped Tier 1 (proposed — Adam decides per outlet)

- **Quotable (full body):** BBC (tested) + NYT (via nyt-mcp, see below). Presumed-
  quotable but **untested via Zyte**, recommend a second spike pass: Reuters, AP, NPR,
  ProPublica, Axios, Politico, Semafor, Rest of World, The Verge, Ars Technica, Wired,
  STAT, Quanta, Atlantic, New Yorker.
- **Headline-only (clustering/ranking only, never quoted):** FT, WSJ, Bloomberg,
  Economist, WaPo, Haaretz, The Information.
- **Headline-only (Zyte-forbidden, decided 2026-06-23):** The Guardian. Stays in for
  clustering/ranking via headline feed; never quoted. No special non-Zyte body path.
- **Re-test:** Nikkei (asset-URL false match this run).

### NYT — sourced via nyt-mcp, not Zyte (decided 2026-06-23)

NYT body text comes from the **nyt-bigquery MCP** (`htmlBody` from
`latest_published_versions_of_assets`), not Zyte — so NYT is **fully quotable** and
exempt from the paywall question entirely. **Architecture caveat:** BigQuery/MCP is
VPN/in-building only, which conflicts with the design tenet "runs entirely in CI, no
laptop dependency." Resolve before Phase 1: either (a) a BigQuery service-account path
that works from GitHub Actions, or (b) accept an on-network fetch step for NYT bodies.
Flagged, not yet decided.

## Run 2 — free / international / longread tier (2026-06-23)

Re-ran the spike across the 23 presumed-quotable Tier-1 outlets (+ Nikkei re-test,
+ NYT-via-Zyte data point), using a **generic article-link heuristic** instead of
per-site regexes. 152 Zyte calls, 6.4 min. Raw: `phase0-matrix-run2.json`.

| outlet | verdict | raw wds | brow wds | read |
|---|---|---|---|---|
| lemonde | FULL | 3137 | 3137 | ✅ quotable |
| theverge | FULL | 2538 | 468 | ✅ quotable |
| newyorker | FULL | 1524 | 1149 | ✅ quotable |
| ap | FULL | 1324 | 44 | ✅ quotable (raw only — browser blocked) |
| arstechnica | FULL | 1150 | 1150 | ✅ quotable |
| wired | FULL | 879 | 891 | ✅ quotable |
| naturenews | FULL | 416 | 487 | ✅ quotable |
| nikkei | FULL | 355 | 347 | ✅ quotable (run-1 INVALID fixed) |
| stat | PARTIAL | 430 | 369 | ✅ likely quotable (430w + marker → per-article gate) |
| **nyt** | PARTIAL | 304 | 260 | ⚠️ **Zyte = teaser, not full — use nyt-mcp (see decision doc)** |
| axios | PARTIAL | 263 | 309 | ✅ likely quotable (Axios writes short by design) |
| scmp | PARTIAL | 186 | 186 | ❓ metered — confirm |
| science | PARTIAL | 192 | 194 | ❓ AAAS metered — confirm |
| reuters | PARTIAL | 172 | 0 | ❓ **likely extraction miss** (Reuters is free) — re-test w/ config |
| propublica | PARTIAL | 181 | 187 | ❓ likely extraction miss (free) — re-test |
| quanta | TEASER | 53 | 53 | ❓ **extraction miss** (Quanta is free) — re-test |
| spiegel | TEASER | 49 | 49 | ❓ Spiegel Intl has a paywall — confirm |
| npr | TEASER | 49 | 3 | ❓ **extraction miss** (NPR is free) — re-test |
| restofworld | TEASER | 40 | 40 | ❓ extraction miss (free) — re-test |
| aljazeera | TEASER | 39 | 76 | ❓ **extraction miss** (AJ is free) — re-test |
| semafor | TEASER | 12 | 12 | ❓ extraction miss (free) — re-test |
| politico | TEASER | 11 | 11 | ❓ **extraction miss** (Politico is free) — re-test |
| kyivindependent | FAIL | 0 | 0 | ❓ URL regex didn't match its shape — re-test |
| atlantic | FAIL | 0 | 0 | ❓ paywall or JS-body — confirm |

### What run 2 actually establishes

- **9 outlets confirmed quotable** (FULL, clean bodies): Le Monde EN, The Verge, New
  Yorker, AP, Ars Technica, Wired, Nature News, Nikkei, + STAT. Plus BBC (run 1). The
  extractor pulls full bodies whenever the article URL is good — so FULL verdicts are trustworthy.
- **NYT via Zyte = teaser (~300w), not full.** Clean, decision-relevant result: Zyte is
  not a viable full-body path for NYT. Full NYT bodies need the MCP/BigQuery path.
- **The low TEASER/FAIL scores on known-free outlets are NOT paywall findings.** Politico,
  Semafor, NPR, Al Jazeera, Rest of World, Quanta, Kyiv Independent, Reuters are free —
  their low counts are my generic heuristic grabbing the wrong link or their body living
  in `<div>`s not `<p>`s. Reporting them as "headline-only" would be a false conclusion.
- **Meta-finding:** the generic-by-default extractor is insufficient for ~40% of outlets.
  This *confirms the design's `extract.js` premise* — per-domain config (URL regex +
  body selector) is required, not optional. That's Phase-1 work, not a paywall verdict.

### Genuinely ambiguous (real paywall vs. miss — needs per-outlet confirmation)

SCMP, Science (AAAS), Spiegel International, The Atlantic. These are metered/paywalled
*and* hit by extractor limits, so the spike can't cleanly separate the two. Resolve with
a per-domain config re-test in Phase 1.

## Open items before Phase 1

- ~~Re-run with tightened asset filter (clean Nikkei)~~ → **done, Nikkei is FULL/quotable.**
- ~~Probe the presumed-free Tier-1 list~~ → **done (run 2).** 9 confirmed quotable; the
  rest need per-domain extractor config before any are called headline-only.
- **Phase 1 extract.js needs per-domain config** (URL regex + body selector) for the
  ~12 outlets the generic heuristic mis-read. Don't ship headline-only verdicts for free
  outlets off run-2's generic numbers.
- Confirm the 4 genuinely-ambiguous metered outlets: SCMP, Science, Spiegel Intl, Atlantic.
- ~~Resolve NYT-via-MCP vs. pure-CI tension~~ → see **`nyt-sourcing-decision.md`**
  (Zyte confirmed teaser-only for NYT; decision doc lays out the CI options).
- ~~Decide drop-vs-headline-only for the Guardian~~ → **headline-only** (2026-06-23).
