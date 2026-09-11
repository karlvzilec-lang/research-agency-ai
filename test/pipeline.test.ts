import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LLMRouter } from "../src/providers/router.js";
import { runPipeline } from "../src/orchestrator/pipeline.js";
import { ROLES } from "../src/agents/roles.js";

test("runPipeline exercises all 12 roles + 360 capstone and writes a full engagement report (mock mode)", async () => {
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

    // Mock always resolves the Research Director's scoping block to "full scope",
    // so every role runs. MD runs twice (kickoff + sign-off), plus the 360 capstone.
    const expectedCount = ROLES.length + 1 /* MD twice */ + 1 /* 360 capstone */;
    assert.equal(context.outputs.length, expectedCount);

    const roleIdsCovered = new Set(context.outputs.map((o) => o.roleId));
    for (const role of ROLES) {
      assert.ok(roleIdsCovered.has(role.id), `missing output from ${role.title}`);
    }
    assert.ok(roleIdsCovered.has("qa_360_analysis"), "missing 360° capstone analysis");

    assert.ok(context.plan, "engagement plan should have been recorded");
    assert.equal(context.plan?.needsQualitative, true);

    const roleOutputs = context.outputs.filter((o) => o.roleId !== "qa_360_analysis");
    for (const output of roleOutputs) {
      assert.equal(output.route, "mock");
      assert.ok(output.output.length > 0);
      assert.ok(output.qa, `expected a QA verdict on ${output.roleTitle}`);
      assert.equal(output.qa?.verdict, "PASS");
      assert.equal(output.qa?.revisions, 0);
    }

    const capstone = context.outputs.find((o) => o.roleId === "qa_360_analysis");
    assert.ok(capstone && !capstone.qa, "the 360 capstone itself should not carry a QA verdict");

    const files = await readdir(outputDir);
    assert.ok(files.includes("00-brief.md"));
    assert.ok(files.includes("FINAL-REPORT.md"));
    assert.equal(files.length, expectedCount + 2 /* brief + final report */);

    const finalReport = await readFile(path.join(outputDir, "FINAL-REPORT.md"), "utf8");
    assert.match(finalReport, /Managing Director/);
    assert.match(finalReport, /Operations, Finance, and Legal/);
    assert.match(finalReport, /Quality Assurance Summary/);
    assert.match(finalReport, /Engagement Scope/);
    assert.match(finalReport, /360° Engagement Analysis/);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("runPipeline honors --no-qa (QA disabled entirely)", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "research-agency-test-noqa-"));
  try {
    const router = new LLMRouter({ mode: "mock" });
    const { context } = await runPipeline({
      brief: "Test brief.",
      router,
      outputDir: outDir,
      qa: { enabled: false },
    });

    for (const output of context.outputs) {
      assert.equal(output.qa, undefined);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
