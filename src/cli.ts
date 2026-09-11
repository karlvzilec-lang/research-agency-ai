#!/usr/bin/env node
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { LLMRouter, type LLMMode } from "./providers/router.js";
import { runPipeline } from "./orchestrator/pipeline.js";

interface Args {
  brief?: string;
  briefFile?: string;
  mode?: LLMMode;
  outDir: string;
  noQa: boolean;
  qaMaxRevisions?: number;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { outDir: "output", noQa: false, help: false };
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
  research-agency run --brief-file examples/sample-brief.md --mode local
  research-agency run --brief-file examples/sample-brief.md --mode mock --out ./tmp

Options:
  --brief <text>          Client brief, inline.
  --brief-file <path>     Client brief, read from a file (overrides --brief).
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
  -h, --help              Show this help.

The workflow is dynamic: the Research Director scopes each brief (full mixed-methods study,
quant/qual-only, or a lightweight desk-research/advisory consultation) and the pipeline only
runs the roles that scope actually calls for.
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

  const router = new LLMRouter({
    mode: args.mode,
    onRouteUsed: (route) => console.log(`  -> ${route}`),
  });

  console.log(`Starting engagement (mode: ${args.mode ?? process.env.LLM_MODE ?? "auto"})\n`);

  const { outputDir } = await runPipeline({
    brief,
    router,
    outputDir: args.outDir,
    qa: {
      enabled: !args.noQa,
      maxRevisions: args.qaMaxRevisions,
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
