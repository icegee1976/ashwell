import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { BacklogTask, TaskSize, Tier } from "./types.js";

const SIZE_RANK: Record<TaskSize, number> = { small: 1, medium: 2, large: 3 };
const TIER_CAP: Record<Exclude<Tier, "skip">, number> = {
  small: 1,
  medium: 2,
  large: 3,
};

function isSize(v: unknown): v is TaskSize {
  return v === "small" || v === "medium" || v === "large";
}

export function loadBacklog(path: string): BacklogTask[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const doc = parseYaml(raw) as { tasks?: unknown } | null;
  const tasksRaw: unknown = doc && typeof doc === "object" ? doc.tasks : undefined;
  const list: any[] = Array.isArray(tasksRaw) ? tasksRaw : [];
  return list.filter(
    (t): t is BacklogTask =>
      Boolean(t) &&
      typeof t.id === "string" &&
      typeof t.title === "string" &&
      typeof t.prompt === "string" &&
      isSize(t.size),
  );
}

/**
 * Tasks that fit within the current tier's budget, ranked so we burn the most
 * quota first: biggest-that-fits, then FIFO. `excludeIds` are skipped.
 */
export function pickTasks(
  tasks: BacklogTask[],
  tier: Exclude<Tier, "skip">,
  excludeIds: string[] = [],
): BacklogTask[] {
  const cap = TIER_CAP[tier];
  const excluded = new Set(excludeIds);
  return tasks
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !t.done && !excluded.has(t.id) && SIZE_RANK[t.size] <= cap)
    .sort((a, b) => SIZE_RANK[b.t.size] - SIZE_RANK[a.t.size] || a.i - b.i)
    .map(({ t }) => t);
}
