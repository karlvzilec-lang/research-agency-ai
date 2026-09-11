import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  formatLessons,
  lessonsFor,
  loadMemory,
  recordLesson,
  saveMemory,
  type MemoryStore,
} from "../src/memory/agencyMemory.js";

test("recordLesson reinforces a duplicate instead of adding a second copy", () => {
  const store: MemoryStore = { lessons: [] };
  recordLesson(store, "insights_strategist", "Cite the actual driver analysis, don't just assert insights.");
  recordLesson(store, "insights_strategist", "cite the actual driver analysis, don't just assert insights.   ");

  assert.equal(store.lessons.length, 1);
  assert.equal(store.lessons[0].timesReinforced, 2);
});

test("recordLesson caps lessons per role, dropping the least-reinforced first", () => {
  const store: MemoryStore = { lessons: [] };
  for (let i = 0; i < 7; i++) {
    recordLesson(store, "data_analyst", `distinct lesson number ${i}`);
  }
  const forRole = store.lessons.filter((l) => l.roleId === "data_analyst");
  assert.ok(forRole.length <= 5);
});

test("lessonsFor prioritizes the most-reinforced lessons and includes role '*' generic ones", () => {
  const store: MemoryStore = { lessons: [] };
  recordLesson(store, "*", "General: always name the actual technique, never 'we will analyze the data'.");
  recordLesson(store, "quantitative_researcher", "Justify sample size with a real confidence/margin rationale.");
  recordLesson(store, "quantitative_researcher", "Justify sample size with a real confidence/margin rationale.");

  const lessons = lessonsFor(store, "quantitative_researcher");
  assert.equal(lessons.length, 2);
  assert.equal(lessons[0].timesReinforced, 2); // most-reinforced first

  const formatted = formatLessons(lessons);
  assert.match(formatted, /Lessons from prior engagements/);
  assert.match(formatted, /sample size/);
});

test("formatLessons returns empty string for no lessons", () => {
  assert.equal(formatLessons([]), "");
});

test("loadMemory / saveMemory round-trip through disk", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "research-agency-memory-test-"));
  const file = path.join(dir, "memory.json");
  try {
    const store: MemoryStore = { lessons: [] };
    recordLesson(store, "designer_visualization", "Don't pad a memo into a fake slide deck.");
    await saveMemory(store, file);

    const reloaded = await loadMemory(file);
    assert.equal(reloaded.lessons.length, 1);
    assert.equal(reloaded.lessons[0].roleId, "designer_visualization");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadMemory returns an empty store when the file doesn't exist", async () => {
  const store = await loadMemory(path.join(tmpdir(), "definitely-does-not-exist-12345.json"));
  assert.deepEqual(store, { lessons: [] });
});
