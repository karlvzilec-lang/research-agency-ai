import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEngagementPlan } from "../src/orchestrator/engagementPlan.js";

test("parseEngagementPlan reads a full mixed-methods scoping block", () => {
  const raw = `Methodology rationale: mixed methods makes sense here because...

ENGAGEMENT_TYPE: full_mixed_methods
NEEDS_QUALITATIVE: yes
NEEDS_QUANTITATIVE: yes
NEEDS_FIELDWORK: yes
NEEDS_DATA_ANALYSIS: yes
PLAN_RATIONALE: Both qual and quant are needed to triangulate the churn driver.`;

  const plan = parseEngagementPlan(raw);
  assert.equal(plan.parseOk, true);
  assert.equal(plan.engagementType, "full_mixed_methods");
  assert.equal(plan.needsQualitative, true);
  assert.equal(plan.needsQuantitative, true);
  assert.equal(plan.needsFieldwork, true);
  assert.equal(plan.needsDataAnalysis, true);
});

test("parseEngagementPlan reads a lightweight consultation scoping block", () => {
  const raw = `This is really an advisory question, not a fieldwork study.

ENGAGEMENT_TYPE: consultation_desk_research
NEEDS_QUALITATIVE: no
NEEDS_QUANTITATIVE: no
NEEDS_FIELDWORK: no
NEEDS_DATA_ANALYSIS: no
PLAN_RATIONALE: The client wants an expert read on existing data, not new primary research.`;

  const plan = parseEngagementPlan(raw);
  assert.equal(plan.parseOk, true);
  assert.equal(plan.engagementType, "consultation_desk_research");
  assert.equal(plan.needsQualitative, false);
  assert.equal(plan.needsQuantitative, false);
  assert.equal(plan.needsFieldwork, false);
  assert.equal(plan.needsDataAnalysis, false);
});

test("parseEngagementPlan falls back to the safe (run-everything) default when unparseable", () => {
  const plan = parseEngagementPlan("Some free-form text with no scoping tags at all.");
  assert.equal(plan.parseOk, false);
  assert.equal(plan.needsQualitative, true);
  assert.equal(plan.needsQuantitative, true);
  assert.equal(plan.needsFieldwork, true);
  assert.equal(plan.needsDataAnalysis, true);
});
