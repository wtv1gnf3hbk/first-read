# First Read — NYT body sourcing: CI vs. VPN

**Status: RESOLVED (2026-06-23) — Option 5 (graceful hybrid).**

## Decision

- **Option 1 (BigQuery-from-CI via SA key): NO-GO.** Not attempting the spike.
- **Chosen: Option 5 — graceful hybrid.** NYT's headline always feeds clustering/ranking
  (via Zyte). NYT is **quoted only when the run can reach BigQuery**; on the unattended
  5:25am CI cron it can't, so **NYT is headline-only day-to-day** and a co-covering
  quotable outlet in the same cluster supplies the verbatim quote. The briefing never
  blocks on NYT body availability. Full NYT quoting only occurs on a manual on-network run.
- **Accepted trade-off:** we lose quoting NYT's *own wording* on automated runs. That's
  fine because clustering means another of the 10 confirmed-quotable outlets (AP, Reuters,
  Le Monde, BBC, Verge, Ars, Wired, Nature, New Yorker, STAT) carries the quote for an
  NYT-led story. NYT still drives *what's in the briefing and how it ranks*.
- **Rejected: Option 3 (self-hosted on-network runner)** — reintroduces the laptop
  dependency the design exists to avoid. Revisit only if NYT-verbatim fidelity proves
  essential during burn-in.

### Phase-1 implication

`bodies.js` treats NYT like any headline-only source by default (Zyte headline → cluster),
and attempts an MCP/BigQuery body fetch **best-effort**: success → NYT quote; failure or
unreachable → silently fall back to the next quotable cluster member. No hard dependency,
no fatal gate on NYT body availability.

---

## Original analysis (for the record)

**Status:** open architecture decision. Adam's call. Recommendation below.

## The conflict

- **Design tenet (§3, §5):** "runs entirely in CI, no laptop/Bridge dependency anywhere."
- **NYT body path:** the nyt-bigquery MCP (`htmlBody` from
  `latest_published_versions_of_assets`) is **VPN / in-building only** — the endpoint
  `tools.ai.nyt.net` and the `nyt-pubp-prd` project are network-gated. A GitHub-hosted
  runner cannot reach it.
- **Phase-0 data point (2026-06-23):** NYT via **Zyte** returns ~300-word **teaser**
  bodies, not full text (metered paywall — Zyte has no subscriber session). So Zyte is
  *not* a full-body fallback for NYT. Full NYT bodies require the MCP/BigQuery path.

NYT is the single most important source. Resolving this is a Phase-1 blocker for the
"quote NYT" capability (not for clustering — NYT headlines work via Zyte regardless).

## Options

**1. BigQuery direct from CI via a GCP service-account key (GH secret).**
Pipeline calls `bigquery.googleapis.com` directly for `htmlBody`.
- ➕ Keeps full NYT bodies; stays pure-CI; no laptop.
- ➖ **Unknown + likely blocked:** `nyt-pubp-prd` is almost certainly behind VPC Service
  Controls / org policy that rejects off-network or non-NYT-identity access (the MCP being
  VPN-gated is the tell). Also a real security ask: a long-lived prod-data SA key living in
  a *personal* repo's secrets — NYT-IT may not permit it.
- **Resolvable only by a spike** (create repo + SA secret + a one-query workflow, observe
  pass/fail). I can't test reachability from here — no SA key, and provisioning one needs
  GCP approvals.

**2. NYT as headline-only (clustering/ranking, never quoted).**
- ➕ Trivial, pure-CI, zero new infra/security.
- ➖ Big quality loss — NYT is the #1 source; never quoting it guts the spine.

**3. Self-hosted GitHub Actions runner on the NYT network.**
Register a self-hosted runner (laptop or an NYT box on VPN); the run reaches BQ/MCP.
- ➕ Full NYT bodies; BQ works.
- ➖ Reintroduces exactly the laptop/on-network dependency the design forbids; laptop off → no briefing.

**4. Two-stage hybrid: on-network pre-fetch → CI consumes.**
A small on-network job fetches NYT bodies for candidate URLs, pushes to a store (Bridge KV
/ committed JSON); CI reads it.
- ➖ Laptop dependency again + a two-phase coupling problem (CI must produce candidate URLs
  before bodies can be fetched). Worst of both worlds.

**5. Graceful hybrid: NYT bodies via MCP *when reachable*, else NYT drops to headline-only
for that run; other cluster members supply the quote.**
- ➕ Pure-CI by default; full NYT bodies on the days/paths where BQ is reachable (e.g. an
  occasional on-network manual run); never blocks the briefing.
- ➖ Inconsistent NYT quoting; most CI runs = NYT headline-only in practice.

## Recommendation

**Spike Option 1 first (gated), with Option 5 as the fallback.**

Reasoning: Option 1 is the only one that delivers full NYT bodies *and* honors the pure-CI
tenet — but it rests on an untested, probably-restricted reachability assumption. So treat
it as Phase-0-style verification: a ~30-min spike (throwaway repo + SA key + single
`SELECT htmlBody ... LIMIT 1` from a GH runner). **If it returns rows → Option 1, done.**
**If it's blocked by VPC-SC/org policy → fall back to Option 5** (NYT headline-only in
unattended CI; full bodies only when a run happens on-network), and revisit a self-hosted
runner only if NYT-quote fidelity proves essential during burn-in.

Reject 3 and 4 outright — both break the no-laptop tenet for a one-reader product, which is
the maintenance tarpit the Murder Board already warned about.

**What's needed from Adam:** (a) go/no-go on attempting the SA-key spike (it needs a GCP
service account with read access to `nyt-pubp-prd` — an approvals/security question, not a
coding one), and (b) confirm Option 5 is an acceptable fallback if the spike fails.
