import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDepthDecision } from "../src/orchestrator/depthClassifier.js";

test("parseDepthDecision reads direct_research", () => {
  const decision = parseDepthDecision(
    "DEPTH: direct_research\nDEPTH_RATIONALE: Just a quick research question, no client ceremony implied."
  );
  assert.equal(decision.parseOk, true);
  assert.equal(decision.depth, "direct_research");
});

test("parseDepthDecision reads full_engagement", () => {
  const decision = parseDepthDecision(
    "DEPTH: full_engagement\nDEPTH_RATIONALE: This is a commissioned engagement with a budget and timeline."
  );
  assert.equal(decision.parseOk, true);
  assert.equal(decision.depth, "full_engagement");
});

test("parseDepthDecision falls back to full_engagement (the safe default) when unparseable", () => {
  const decision = parseDepthDecision("No structured answer here.");
  assert.equal(decision.parseOk, false);
  assert.equal(decision.depth, "full_engagement");
});
