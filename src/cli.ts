#!/usr/bin/env node
import "dotenv/config";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { LLMRouter, type LLMMode } from "./providers/router.js";
import { runPipeline } from "./orchestrator/pipeline.js";
import type { EngagementDepth } from "./orchestrator/depthClassifier.js";
import { parseCsv } from "./analysis/loadCsv.js";
import { analyzeDataset, formatDatasetAnalysis } from "./analysis/stats.js";
import { defaultMemoryPath } from "./memory/agencyMemory.js";

interface Args {
  brief?: string;
  briefFile?: string;
  mode?: LLMMode;
  outDir: string;
  noQa: boolean;
  qaMaxRevisions?: number;
  depth?: "auto" | EngagementDepth;
  dataPath?: string;
  noMemory: boolean;
  resetMemory: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { outDir: "output", noQa: false, noMemory: false, resetMemory: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--brief":
        args.brief = argv[++i];
        break;
      case "--brief-file":
        args.briefFile = argv[++i];
        break;
      case "--mode":
        args.mode = argv[++i] as LLMMode;
        break;
      case "--out":
        args.outDir = argv[++i];
        break;
      case "--no-qa":
        args.noQa = true;
        break;
      case "--qa-max-revisions":
        args.qaMaxRevisions = Number(argv[++i]);
        break;
      case "--depth":
        args.depth = argv[++i] as "auto" | EngagementDepth;
        break;
      case "--data":
        args.dataPath = argv[++i];
        break;
      case "--no-memory":
        args.noMemory = true;
        break;
      case "--reset-memory":
        args.resetMemory = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        console.warn(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`research-agency-ai — autonomous research-agency agent workflow

Usage:
  research-agency run --brief "text of the client brief"
  research-agency run --brief-file examples/sample-brief.md
  research-agency run --brief-file examples/sample-brief.md --mode api
  research-agency run --brief-file examples/sample-brief.md --data ./survey.csv
  research-agency run --brief "Sanity-check my churn hypothesis" --depth direct_research
  research-agency run --brief-file examples/sample-brief.md --mode mock --out ./tmp

Options:
  --brief <text>          Client brief, inline.
  --brief-file <path>     Client brief, read from a file (overrides --brief).
  --data <path.csv>       A real dataset to ground the Quant Researcher / Data Analyst in actual
                           computed statistics instead of illustrative filler. CSV with a header row.
  --depth <value>         auto (default, classifies the request) | direct_research | full_engagement
                             direct_research  - skip the commercial-engagement ceremony (Managing
                                                 Director, Account Director, Ops/Finance/Legal) and
                                                 just deliver the research answer.
                             full_engagement  - always run the complete client-engagement process.
  --mode <mode>           auto (default) | passthru | local | api | mock
                             auto     - prefer your Claude subscription (passthru), then a local
                                        LLM if one is running, then API keys (Anthropic/OpenAI/OpenRouter)
                             passthru - only use your logged-in Claude subscription
                             local    - only use a local OpenAI-compatible server (Ollama, LM Studio, ...)
                             api      - only use direct API keys / OpenRouter waterfall
                             mock     - no network calls, deterministic placeholder text
  --out <dir>             Output directory for the engagement report (default: ./output)
  --no-qa                 Skip the brutal-QA revision loop (faster/cheaper, lower bar)
  --qa-max-revisions <n>  Max QA-triggered revisions per deliverable (default: 2)
  --no-memory             Don't load or record cross-engagement lessons-learned this run
  --reset-memory          Clear the lessons-learned store before running (${defaultMemoryPath()})
  -h, --help              Show this help.

The workflow is dynamic on two axes: the Research Director scopes WHICH research methods a brief
needs (full mixed-methods study, quant/qual-only, or a lightweight consultation), and intake triage
scopes HOW MUCH agency ceremony it needs (a full client engagement, or a direct research answer).
`);
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (!command || command === "help" || command === "-h" || command === "--help") {
    printHelp();
    return;
  }

  if (command !== "run") {
    console.error(`Unknown command "${command}". Try "research-agency run --help".`);
    process.exitCode = 1;
    return;
  }

  const args = parseArgs(rest);
  if (args.help) {
    printHelp();
    return;
  }

  let brief = args.brief;
  if (args.briefFile) {
    brief = await readFile(path.resolve(args.briefFile), "utf8");
  }
  if (!brief || !brief.trim()) {
    console.error("A client brief is required: pass --brief \"...\" or --brief-file <path>.");
    process.exitCode = 1;
    return;
  }

  let realDataset: string | undefined;
  if (args.dataPath) {
    const csvText = await readFile(path.resolve(args.dataPath), "utf8");
    const rows = parseCsv(csvText);
    if (rows.length === 0) {
      console.error(`No data rows found in ${args.dataPath} — check it has a header row plus data.`);
      process.exitCode = 1;
      return;
    }
    realDataset = formatDatasetAnalysis(analyzeDataset(rows));
    console.log(`Loaded real dataset: ${rows.length} rows from ${args.dataPath}\n`);
  }

  if (args.resetMemory) {
    await rm(defaultMemoryPath(), { force: true });
    console.log("Cleared lessons-learned memory.\n");
  }

  const router = new LLMRouter({
    mode: args.mode,
    onRouteUsed: (route) => console.log(`  -> ${route}`),
  });

  console.log(`Starting engagement (mode: ${args.mode ?? process.env.LLM_MODE ?? "auto"})\n`);

  const { outputDir } = await runPipeline({
    brief,
    router,
    outputDir: args.outDir,
    depth: args.depth,
    realDataset,
    qa: {
      enabled: !args.noQa,
      maxRevisions: args.qaMaxRevisions,
    },
    memory: {
      enabled: !args.noMemory,
    },
    onPhase: (phase, detail) => {
      console.log(detail ? `[${phase}] ${detail}` : `[${phase}]`);
    },
  });

  console.log(`\nEngagement complete. Report written to: ${outputDir}`);
}

main().catch((err) => {
  console.error("\nFatal error:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
