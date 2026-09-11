import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LLMRouter } from "../src/providers/router.js";
import { runPipeline } from "../src/orchestrator/pipeline.js";
import { ROLES } from "../src/agents/roles.js";

test("runPipeline exercises all 12 roles and writes a full engagement report (mock mode)", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "research-agency-test-"));
  try {
    const router = new LLMRouter({ mode: "mock" });
    const phases: string[] = [];

    const { context, outputDir } = await runPipeline({
      brief: "Test brief: why are premium subscribers downgrading plans?",
      router,
      outputDir: outDir,
      onPhase: (phase) => phases.push(phase),
    });

    // Managing Director runs twice (kickoff mandate + final sign-off), everyone else once.
    assert.equal(context.outputs.length, ROLES.length + 1);

    const roleIdsCovered = new Set(context.outputs.map((o) => o.roleId));
    for (const role of ROLES) {
      assert.ok(roleIdsCovered.has(role.id), `missing output from ${role.title}`);
    }

    for (const output of context.outputs) {
      assert.equal(output.route, "mock");
      assert.ok(output.output.length > 0);
    }

    const files = await readdir(outputDir);
    assert.ok(files.includes("00-brief.md"));
    assert.ok(files.includes("FINAL-REPORT.md"));
    assert.equal(files.length, ROLES.length + 1 /* MD twice */ + 2 /* brief + final */);

    const finalReport = await readFile(path.join(outputDir, "FINAL-REPORT.md"), "utf8");
    assert.match(finalReport, /Managing Director/);
    assert.match(finalReport, /Operations, Finance, and Legal/);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
