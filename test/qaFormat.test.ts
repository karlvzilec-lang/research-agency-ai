import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQAVerdict } from "../src/qa/format.js";

test("parseQAVerdict reads a clean PASS", () => {
  const raw = `VERDICT: PASS
SCORES:
- strategic_fit: 9
- methodology: 8
- analytical_depth: 8
- commercial_actionability: 9
- client_readiness: 8
- risk_compliance: 9
OVERALL: 8.5
CRITIQUE:
Solid, but the sampling rationale could cite a source.`;

  const verdict = parseQAVerdict(raw);
  assert.equal(verdict.parseOk, true);
  assert.equal(verdict.verdict, "PASS");
  assert.equal(verdict.overallScore, 8.5);
  assert.equal(verdict.scores.strategic_fit, 9);
  assert.match(verdict.critique, /sampling rationale/);
});

test("parseQAVerdict reads a REVISE", () => {
  const raw = `VERDICT: REVISE
SCORES:
- strategic_fit: 4
- methodology: 5
- analytical_depth: 3
- commercial_actionability: 4
- client_readiness: 5
- risk_compliance: 6
OVERALL: 4.5
CRITIQUE:
No actual evidence cited for the headline claim.`;

  const verdict = parseQAVerdict(raw);
  assert.equal(verdict.verdict, "REVISE");
  assert.equal(verdict.overallScore, 4.5);
});

test("parseQAVerdict overrides a self-contradictory PASS with a low score to REVISE", () => {
  const raw = `VERDICT: PASS
OVERALL: 3
CRITIQUE:
This should not have passed at this score.`;

  const verdict = parseQAVerdict(raw);
  assert.equal(verdict.verdict, "REVISE");
});

test("parseQAVerdict falls back safely when the response doesn't match the format", () => {
  const verdict = parseQAVerdict("Looks good to me!");
  assert.equal(verdict.parseOk, false);
  assert.equal(verdict.verdict, "REVISE");
});
