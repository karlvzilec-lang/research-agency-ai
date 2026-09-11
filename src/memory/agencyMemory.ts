import { readFile, writeFile } from "node:fs/promises";

export interface Lesson {
  id: string;
  roleId: string;
  lesson: string;
  createdAt: string;
  timesReinforced: number;
}

export interface MemoryStore {
  lessons: Lesson[];
}

const MAX_LESSONS_PER_ROLE = 5;
const MAX_LESSON_LENGTH = 500;

export function defaultMemoryPath(): string {
  return process.env.AGENCY_MEMORY_PATH || ".research-agency-memory.json";
}

export async function loadMemory(path: string): Promise<MemoryStore> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<MemoryStore>;
    return { lessons: Array.isArray(parsed.lessons) ? parsed.lessons : [] };
  } catch {
    return { lessons: [] };
  }
}

export async function saveMemory(store: MemoryStore, path: string): Promise<void> {
  await writeFile(path, JSON.stringify(store, null, 2), "utf8");
}

/** Most-reinforced lessons first — recurring patterns matter more than one-offs. */
export function lessonsFor(store: MemoryStore, roleId: string, limit = 3): Lesson[] {
  return store.lessons
    .filter((l) => l.roleId === roleId || l.roleId === "*")
    .sort((a, b) => b.timesReinforced - a.timesReinforced)
    .slice(0, limit);
}

export function formatLessons(lessons: Lesson[]): string {
  if (lessons.length === 0) return "";
  return [
    "## Lessons from prior engagements — do not repeat these",
    "",
    ...lessons.map((l) => `- ${l.lesson}`),
  ].join("\n");
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

/**
 * This is the actual "self-refining based on experience" mechanism: an LLM
 * call can't update its own weights, but the agency CAN accumulate a durable,
 * local playbook of what went wrong before and feed it back as context on the
 * next run. A recurring critique is reinforced (bumped) rather than
 * duplicated; the store is capped per-role so it stays a short, high-signal
 * playbook rather than an ever-growing transcript.
 */
export function recordLesson(store: MemoryStore, roleId: string, lessonText: string): void {
  const trimmed = lessonText.trim();
  if (!trimmed) return;
  const norm = normalize(trimmed);

  const existing = store.lessons.find((l) => l.roleId === roleId && normalize(l.lesson) === norm);
  if (existing) {
    existing.timesReinforced += 1;
    return;
  }

  store.lessons.push({
    id: `${roleId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    roleId,
    lesson: trimmed.slice(0, MAX_LESSON_LENGTH),
    createdAt: new Date().toISOString(),
    timesReinforced: 1,
  });

  const forRole = store.lessons.filter((l) => l.roleId === roleId);
  if (forRole.length > MAX_LESSONS_PER_ROLE) {
    forRole.sort((a, b) => a.timesReinforced - b.timesReinforced || a.createdAt.localeCompare(b.createdAt));
    const toDrop = new Set(forRole.slice(0, forRole.length - MAX_LESSONS_PER_ROLE).map((l) => l.id));
    store.lessons = store.lessons.filter((l) => !toDrop.has(l.id));
  }
}
