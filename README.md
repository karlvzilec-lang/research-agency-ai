# research-agency-ai

An autonomous, LLM-powered multi-agent workflow that simulates a full research
agency — from strategy and client proposal through fieldwork, analysis, and
final report — using 12 specialist agents mapped 1:1 to real agency roles.

Give it a client brief; it runs the whole engagement end-to-end and writes a
structured report to disk.

## The 12 agents

| # | Role | Main responsibility |
|---|------|----------------------|
| 1 | Managing Director / Founder | Sets strategy, go/no-go, engagement mandate |
| 2 | Client / Account Director | Client relationship, proposal framing, budget, expectations |
| 3 | Research Director | Chooses methodology, oversees quality, guides conclusions |
| 4 | Project Manager | Timelines, suppliers, fieldwork, deliverables |
| 5 | Research Consultant / Analyst | Desk research, analysis, working hypotheses |
| 6 | Qualitative Researcher / Moderator | Interview/FGD/ethnography design |
| 7 | Quantitative Researcher / Statistician | Survey, sampling, analysis plan |
| 8 | Fieldwork Coordinator | Recruitment and data-collection operations |
| 9 | Data Analyst / Data Scientist | Cleans data, segments audiences, surfaces patterns |
| 10 | Insights Strategist / Report Writer | Headline insights, business implications, narrative |
| 11 | Designer / Visualization Specialist | Chart choices, deck outline |
| 12 | Operations, Finance, and Legal | Invoicing, procurement, compliance, close-out |

See [`src/agents/roles.ts`](src/agents/roles.ts) for each role's full system prompt.

## Workflow

```
Managing Director  →  Account Director  →  Research Director  →  Project Manager
                                                                        │
                        ┌───────────────────────────────────────────────┤
                        │ (parallel)                                    │
                Desk Research      Qualitative Design      Quantitative Design
                        │                    │                        │
                        └───────────────┬────┴────────────────────────┘
                                         ▼
                              Fieldwork Coordinator
                                         ▼
                              Data Analyst / Scientist
                                         ▼
                              Insights Strategist
                                         ▼
                          Designer / Visualization Specialist
                                         ▼
                            Operations, Finance & Legal
                                         ▼
                       Managing Director (final sign-off)
```

Implemented in [`src/orchestrator/pipeline.ts`](src/orchestrator/pipeline.ts).
Every agent sees the brief plus whichever colleagues' outputs are relevant to
its role (not the entire history indiscriminately), the way a real hand-off
works.

## LLM provider routing — two modes

This is the part that satisfies "use my current subscription where possible,
otherwise fail over to API keys / OpenRouter with rotation":

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
> terminal, which is exactly what a Pro/Max subscription is for. This is why
> `passthru` mode requires the CLI to be installed and logged in — see setup
> below — rather than depending on the Agent SDK's own auth.

Setup:

```bash
npm install -g @anthropic-ai/claude-code
claude /login
```

### 2. `api` — direct API keys, with OpenRouter multi-key waterfall

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
| `auto` (default) | Try `passthru` first (it's the subscription you're already paying for); if it's unavailable or a call fails, fall back to the `api` chain. |
| `passthru` | Only use the subscription passthrough. |
| `api` | Only use the direct API key chain. |
| `mock` | No network calls — deterministic placeholder text, for tests/dry runs. |

Copy [`.env.example`](.env.example) to `.env` and fill in what you have.

## Usage

```bash
npm install
npm run build

# Using your Claude subscription (default: auto, prefers passthru)
npm start -- run --brief-file examples/sample-brief.md

# Force direct API / OpenRouter waterfall mode
npm start -- run --brief-file examples/sample-brief.md --mode api

# Dry run, no network calls, verifies wiring only
npm start -- run --brief-file examples/sample-brief.md --mode mock --out ./tmp
```

Or during development, skip the build step:

```bash
npm run dev -- run --brief "Why is our mid-tier prepaid segment churning?"
```

Output lands in `output/<timestamp>/`: one markdown file per agent turn, plus
a combined `FINAL-REPORT.md`.

## Testing

```bash
npm test
```

Runs the pipeline end-to-end in `mock` mode (no network, no auth needed) and
asserts every one of the 12 roles produced output and the report was written
correctly. See [`test/pipeline.test.ts`](test/pipeline.test.ts).

## Project layout

```
src/
  agents/
    roles.ts        12 role definitions (title, responsibility, system prompt)
    agent.ts         binds a role to the provider router
  providers/
    types.ts          LLMProvider interface
    router.ts          mode switch + fallback chain (the "2 options" logic)
    passthru.ts         Claude subscription via local CLI subprocess
    anthropicDirect.ts   direct Anthropic API
    openaiDirect.ts       direct OpenAI API
    openrouterWaterfall.ts  multi-key waterfall failover
    mock.ts                offline provider for tests
  orchestrator/
    context.ts        engagement context + markdown report writer
    pipeline.ts         the 11-phase workflow across all 12 agents
  cli.ts               command-line entry point
test/
  pipeline.test.ts     end-to-end wiring test (mock provider)
examples/
  sample-brief.md      example client brief to try the CLI against
```

## Extending

- **New role:** add an entry to `src/agents/roles.ts` and a call to it in
  `src/orchestrator/pipeline.ts`.
- **New provider:** implement `LLMProvider` (`src/providers/types.ts`) and add
  it to the chain in `src/providers/router.ts`.
