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

## Open items before Phase 1

- Re-run with the tightened asset filter to get a clean Nikkei number + confirm Economist.
- Probe the *presumed-free* Tier-1 list for 451-forbidden and teaser truncation — same
  script, swap the outlet list. (NYT excluded — sourced via nyt-mcp.)
- Resolve the NYT-via-MCP vs. pure-CI tension (BigQuery needs VPN/in-building).
- ~~Decide drop-vs-headline-only for the Guardian~~ → **headline-only** (2026-06-23).
