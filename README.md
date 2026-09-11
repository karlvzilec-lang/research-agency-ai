# research-agency-ai

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An autonomous, LLM-powered multi-agent workflow that simulates a full research
agency — from strategy and client proposal through fieldwork, analysis, and
final report — using 12 expert-level specialist agents mapped 1:1 to real
agency roles, a **dynamic workflow** that scopes itself to what the brief
actually needs, and a **brutal QA + 360° review** layer on every deliverable.

Give it a client brief; it runs the whole engagement end-to-end and writes a
structured, QA-scored report to disk.

## The 12 agents

Every agent operates at partner/expert level (20+ years of equivalent
experience at a top-tier global research firm), is multilingual and
culturally fluent for any target market, and applies current global industry
standards (see [Standards & compliance](#standards--compliance) below).

| # | Role | Main responsibility |
|---|------|----------------------|
| 1 | Managing Director / Founder | Sets strategy, go/no-go, engagement mandate |
| 2 | Client / Account Director | Client relationship, proposal framing, budget, expectations |
| 3 | Research Director | Chooses methodology, **scopes the dynamic workflow**, oversees quality |
| 4 | Project Manager | Timelines, suppliers, fieldwork, deliverables, eTOM-aligned process |
| 5 | Research Consultant / Analyst | Desk research, analysis, working hypotheses |
| 6 | Qualitative Researcher / Moderator | Interview/FGD/ethnography design, multilingual instruments |
| 7 | Quantitative Researcher / Statistician | Survey, sampling, **higher-order analytics** (driver analysis, segmentation, MaxDiff/conjoint, predictive modeling) |
| 8 | Fieldwork Coordinator | Recruitment and data-collection operations |
| 9 | Data Analyst / Data Scientist | Cleans data, ML-based segmentation, driver/significance analysis, predictive scoring |
| 10 | Insights Strategist / Report Writer | Headline insights, "How Might We" opportunity framing, business narrative |
| 11 | Designer / Visualization Specialist | Chart choices, deck-or-memo outline sized to engagement scope |
| 12 | Operations, Finance, and Legal | Invoicing, procurement, compliance, close-out |

See [`src/agents/roles.ts`](src/agents/roles.ts) for each role's full system prompt.

Industry coverage: **agnostic by design** — it can take on a brief from any
sector — with **hardcore, practitioner-level specialist depth in Telco,
Ecommerce, Fintech, Banking, and FMCG** (real category KPIs and vocabulary:
ARPU/churn for Telco, GMV/CAC/LTV for Ecommerce, TPV/take-rate for Fintech,
NPL/CASA for Banking, distribution/share-of-shelf for FMCG).

## Research execution, not just report shape

Four things make this an execution engine rather than a report-shape generator:

- **Real desk research.** The Research Consultant/Analyst's call runs with live
  web search — through the Claude subscription passthrough's `WebSearch` tool,
  or Anthropic's native `web_search` tool on direct-API calls — whenever the
  active provider supports it, so findings can cite real, current, dated
  sources instead of only training-data recall. When search genuinely isn't
  available, the agent is required to say so and flag which claims are
  unverified recall, rather than presenting them as checked.
- **Real quantitative grounding.** Pass `--data your-file.csv` and the
  Quantitative Researcher / Data Analyst are handed actual computed statistics
  — means, medians, stdev, category frequencies, and pairwise Pearson
  correlations, computed deterministically in code (`src/analysis/stats.ts`),
  not estimated by an LLM — and required to work strictly from those numbers.
  With no dataset supplied, they're required to say so and produce a clearly
  labeled research design/analysis **plan**, never fabricated "illustrative"
  findings dressed up as results.
- **Independent QA.** The brutal-QA reviewer runs on a *different* provider
  than the one that generated the draft whenever more than one is actually
  available (e.g. Claude passthru generates, a local model or a different API
  key reviews) — so QA isn't just the same model grading its own homework. The
  report honestly flags when only one provider was available and QA had to be
  self-reviewed.
- **Persistent, cross-engagement learning.** Every QA critique that triggers a
  revision is written to a small local lesson store
  (`src/memory/agencyMemory.ts`) and fed back into that same role's prompt on
  the *next* engagement. An LLM call can't update its own weights, but the
  agency accumulates a durable playbook across runs — genuine improvement from
  experience, not a fixed prompt repeated forever. Disable with `--no-memory`,
  clear it with `--reset-memory`.

## Dynamic workflow

The workflow isn't a fixed 12-step checklist run on every brief — it flexes on two independent axes:

1. **How much research** — the **Research Director scopes the methodology**:
   full mixed-methods study, quant-only, qual-only, or a lightweight
   desk-research/advisory consultation — and the pipeline only runs the roles
   that scope actually calls for. See
   [`src/orchestrator/engagementPlan.ts`](src/orchestrator/engagementPlan.ts).
2. **How much ceremony** — an **intake triage decides engagement depth**:
   a `full_engagement` gets the complete client-management process (proposal,
   budget, timeline, sign-off, invoicing); a `direct_research` request — "can
   you look into X", "what's driving Y", "sanity-check this for me" — skips
   the Managing Director, Account Director, and Ops/Finance/Legal entirely and
   goes straight to delivering the research answer. Controls (QA, the 360°
   capstone) still apply regardless — this axis only cuts commercial ceremony,
   never quality checking. Force it with `--depth direct_research` /
   `--depth full_engagement`, or leave it on `auto`. See
   [`src/orchestrator/depthClassifier.ts`](src/orchestrator/depthClassifier.ts).

A "sanity check this hypothesis for us" request gets answered as a fast, cheap,
ceremony-free consultation; a commissioned churn-driver study gets the full
fieldwork treatment.

```
Intake triage — direct_research or full_engagement?
                                            │
              ┌─────────────────────────────┴─────────────────────────────┐
    [direct_research]                                            [full_engagement]
              │                                                             │
              │                                          Managing Director → Account Director
              │                                                             │
              └─────────────────────────────┬───────────────────────────────┘
                                             ▼
                          Research Director (scopes the RESEARCH — qual/quant/fieldwork/data)
                                             │
                     ┌───────────────────────┤ (parallel — all depend only on Research Director)
                     │                       │
             Project Manager   Desk Research (+ live web search)   [Qual Design]*   [Quant Design]*
                     │                                  │                                │
                     └──────────────────┬────────────────┴────────────────────────────────┘
                                         ▼
                        [Fieldwork Coordinator]*  (only if primary data collection is in scope)
                                         ▼
                       [Data Analyst / Scientist]*  (real stats if --data given, honest plan if not)
                                         ▼
                              Insights Strategist
                                         ▼
                     Designer / Visualization (deck for a study, memo for a consultation)
                                         │
              ┌───────────────────────────┴───────────────────────────┐
    [direct_research: stop here]                          [full_engagement]
                                                                        │
                                                    Operations, Finance & Legal
                                                                        ▼
                                                    Managing Director (final sign-off)
                                                                        │
              └───────────────────────────┬───────────────────────────┘
                                           ▼
                            360° Engagement Analysis (capstone — always runs, it's a control)

  * skipped entirely (with a recorded reason) when the Research Director scopes them out
```

Implemented in [`src/orchestrator/pipeline.ts`](src/orchestrator/pipeline.ts).
Project Manager, desk research, and whichever of qual/quant design are needed
have no dependency on each other — only on the Research Director's output —
so they run in parallel rather than serialized one after another.

## Brutal QA + 360° analysis

Every deliverable that actually runs is generated, then reviewed by an
adversarial "Chief Quality Officer" agent against a six-dimension rubric —
Strategic Fit, Methodological Rigor, Analytical Depth, Commercial
Actionability, Client-Readiness, and Risk/Compliance — **on a different
provider than the one that generated it, whenever more than one is actually
available**, and, if it fails, regenerated with the critique folded in, up to
`QA_MAX_REVISIONS` times before being force-accepted (clearly flagged, never
silently dropped). The report records whether each review was genuinely
independent or (with only one provider configured) necessarily self-reviewed.

The engagement closes with a **360° capstone**: a holistic audit of the whole
completed engagement across Client Value, Methodological Soundness,
Commercial Risk, Operational Feasibility, Competitive Differentiation, and
Actionability — ending in an overall grade and a **SHIP IT / DO NOT SHIP**
call.

The generated `FINAL-REPORT.md` leads with a QA scoreboard (verdict, score,
revision count per deliverable) and the dynamic-scoping decision, so the
report itself is the audit trail. See [`src/qa/`](src/qa/).

This roughly 2-3×'s the LLM calls per engagement — disable with `--no-qa` (or
`QA_ENABLED=false`) for fast/cheap dry runs.

## LLM provider routing — three ways to power it

### 1. `passthru` — your Claude subscription

Shells out to your own, already-authenticated `claude` CLI (the same binary
Claude Code uses) as a subprocess, in non-interactive print mode with tool use
disabled. This rides whatever plan you're logged into (Pro/Max/Team) — **no
separate per-token API billing**, because it is not calling the Anthropic API
directly; it's reusing your local CLI session.

> Anthropic's terms don't allow third-party SDKs/products to reuse a claude.ai
> login directly — the Claude *Agent SDK* itself requires `ANTHROPIC_API_KEY`.
> Shelling out to your own locally-installed, user-authenticated `claude` CLI
> is different: it's the same thing as running `claude -p "..."` yourself in a
> terminal, which is exactly what a Pro/Max subscription is for.

Setup: `npm install -g @anthropic-ai/claude-code` then `claude /login` once.

### 2. `local` — your own local LLM, if installed

Any OpenAI-compatible local server: **Ollama** (default), LM Studio,
llama.cpp's server, vLLM, text-generation-webui, etc. Auto-detected in `auto`
mode — if nothing's running at `LOCAL_LLM_BASE_URL`, it's silently skipped. No
model name required: it auto-picks the first model your local server reports
if `LOCAL_LLM_MODEL` is left blank. See [`src/providers/local.ts`](src/providers/local.ts).

### 3. `api` — direct API keys, with OpenRouter multi-key waterfall

A provider chain, tried in order, first one configured wins:

1. **Anthropic** direct (`ANTHROPIC_API_KEY`)
2. **OpenAI** direct (`OPENAI_API_KEY`)
3. **OpenRouter**, with **multiple keys and automatic rotation (waterfall)**:
   set `OPENROUTER_API_KEYS` to a comma-separated list. On a failure (bad key,
   rate limit, 5xx, network error) the failing key is put on a cooldown and
   the *next* key in the list is tried immediately, within the same call. The
   next call always starts again from key #1 unless it's still cooling down —
   true waterfall failover, not round-robin load spreading.

### Mode selection: `LLM_MODE`

| Value | Behavior |
|-------|----------|
| `auto` (default) | `passthru` → `local` (if running) → `api` chain, in that priority order — subscription first (already paid for), then free/local, then paid API keys as the last resort. |
| `passthru` | Only the subscription passthrough. |
| `local` | Only a local OpenAI-compatible server. |
| `api` | Only the direct API key chain. |
| `mock` | No network calls — deterministic placeholder text, for tests/dry runs. |

Copy [`.env.example`](.env.example) to `.env` and fill in what you have.

## Standards & compliance

Baked into every agent's instructions, not bolted on:

- **Research process**: ESOMAR, ISO 20252 (market/opinion/social research
  quality), MRS/Insights-Association-equivalent codes of practice.
- **Quality & data security**: ISO 9001-equivalent quality management,
  ISO/IEC 27001-equivalent information-security practice, GDPR-equivalent
  consent/anonymization for any personal data.
- **Telecom-specific**: eTOM (TM Forum's Business Process Framework) process
  alignment for the Project Manager's plan and Ops/Finance/Legal's compliance
  checklist whenever the client is a telecom operator.
- **Design Thinking**: built into the flow, not a separate step — qualitative
  work is the Empathize phase, the Research Director's framing is Define, the
  Insights Strategist reframes every headline insight as a "How Might We"
  opportunity statement (Ideate), and recommendations are left in a
  pilot-able, testable shape (Prototype/Test).
- **Global & multilingual**: every agent reads the brief for its actual
  target market/language and localizes accordingly (terminology, cultural
  framing, and — for qual/quant instruments — forward-translation +
  back-translation protocol), rather than defaulting to a single home market.

The brutal-QA reviewer's `risk_compliance` dimension specifically checks that
compliance is *demonstrated* in the text, not just asserted.

## Usage

```bash
npm install
npm run build

# Using your Claude subscription (default: auto — prefers passthru, then local, then API)
npm start -- run --brief-file examples/sample-brief.md

# Ground the quant/data workstreams in a real dataset instead of illustrative filler
npm start -- run --brief-file examples/sample-brief.md --data ./survey-results.csv

# Skip the commercial-engagement ceremony for a quick research question
npm start -- run --brief "What's likely driving our churn in the mid-tier segment?" --depth direct_research

# Force a local model (Ollama/LM Studio/etc.)
npm start -- run --brief-file examples/sample-brief.md --mode local

# Force direct API / OpenRouter waterfall mode
npm start -- run --brief-file examples/sample-brief.md --mode api

# Skip the brutal-QA loop and cross-engagement memory for a fast, cheap dry run
npm start -- run --brief-file examples/sample-brief.md --mode mock --no-qa --no-memory --out ./tmp
```

Or during development, skip the build step: `npm run dev -- run --brief "..."`.

Full flag reference: `npm start -- run --help`.

Output lands in `output/<timestamp>/`: one markdown file per agent turn (with
its QA verdict block), plus a combined `FINAL-REPORT.md` leading with the
engagement scope and QA scoreboard.

## Testing

```bash
npm test
```

Runs in `mock` mode (no network, no auth needed): the full pipeline wiring
test (asserts every role produces output, QA passes, the 360 capstone runs,
and the report renders correctly), a `--no-qa` test, and pure unit tests for
the QA-verdict parser and the dynamic engagement-plan parser (full-scope,
consultation-scope, and unparseable-fallback cases). See [`test/`](test/).

## Project layout

```
src/
  agents/
    roles.ts            12 expert-level role definitions
    agent.ts              binds a role to the provider router
  providers/
    types.ts               LLMProvider interface
    router.ts                mode switch + fallback chain (passthru -> local -> api) + cross-provider exclusion
    passthru.ts                Claude subscription via local CLI subprocess (+ real WebSearch/WebFetch)
    local.ts                    local OpenAI-compatible server (Ollama, LM Studio, ...)
    anthropicDirect.ts            direct Anthropic API (+ real web_search tool)
    openaiDirect.ts                 direct OpenAI API
    openrouterWaterfall.ts            multi-key waterfall failover
    mock.ts                            offline provider for tests
  qa/
    format.ts             QA rubric, tagged-output format, parser
    qaReviewer.ts            the "brutal QA" reviewer + 360° capstone
    reviewLoop.ts               generate -> review (independent provider) -> revise loop
  analysis/
    loadCsv.ts             small dependency-free CSV parser
    stats.ts                  real descriptive stats + Pearson correlations, computed not guessed
  memory/
    agencyMemory.ts       persistent cross-engagement lessons-learned store
  orchestrator/
    engagementPlan.ts     dynamic RESEARCH-scope decision + parser (qual/quant/fieldwork/data)
    depthClassifier.ts       dynamic CEREMONY-depth decision + parser (direct_research/full_engagement)
    context.ts               engagement context + markdown report writer
    pipeline.ts                 the dynamic, parallelized workflow across all 12 agents
  cli.ts                   command-line entry point
test/
  pipeline.test.ts       end-to-end wiring tests (mock provider) — full engagement + direct research
  engagementPlan.test.ts   research-scope parser unit tests
  depthClassifier.test.ts   ceremony-depth parser unit tests
  qaFormat.test.ts           QA-verdict parser unit tests
  stats.test.ts               CSV parsing + real-statistics unit tests
  agencyMemory.test.ts          lessons-learned store unit tests
examples/
  sample-brief.md      example client brief to try the CLI against
```

## Extending

- **New role:** add an entry to `src/agents/roles.ts` and a call to it in
  `src/orchestrator/pipeline.ts`.
- **New provider:** implement `LLMProvider` (`src/providers/types.ts`) and add
  it to the chain in `src/providers/router.ts`.
- **New scoping dimension:** extend the tagged block in
  `src/orchestrator/engagementPlan.ts` and the Research Director's prompt.

## License

[MIT](LICENSE) — do whatever you want with it.
