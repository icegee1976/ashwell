import type { AshwellConfig } from "./config.js";
import type { Tier, UsageWindow } from "./types.js";

/** Remaining percentage for a window, or null if unavailable. */
export function remaining(w?: UsageWindow | null): number | null {
  if (!w || typeof w.utilization !== "number") return null;
  return Math.max(0, Math.min(100, 100 - w.utilization));
}

export function tierFor(remainingPct: number, cfg: AshwellConfig): Tier {
  if (remainingPct >= cfg.tiers.large) return "large";
  if (remainingPct >= cfg.tiers.medium) return "medium";
  if (remainingPct >= cfg.tiers.small) return "small";
  return "skip";
}

// ── wake-time helpers (everything in the machine's LOCAL time) ───────────────

const DOW: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};
const DOW_FULL = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

export function parseDayOfWeek(s: string): number {
  return DOW[s.trim().toLowerCase()] ?? 3; // default Wednesday
}

export function fullDayName(dow: number): string {
  return DOW_FULL[dow] ?? "Wednesday";
}

export function parseTime(s: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return { hour: 8, minute: 0 };
  return { hour: Math.min(23, Number(m[1])), minute: Math.min(59, Number(m[2])) };
}

/** The configured wake instant on the reset's local day (or the day before if
 *  that time would land after the reset). */
export function computeWake(reset: Date, hour: number, minute: number): Date {
  const w = new Date(reset);
  w.setHours(hour, minute, 0, 0);
  if (w.getTime() > reset.getTime()) w.setDate(w.getDate() - 1);
  return w;
}

/** Next occurrence (>= now) of a weekday + local time — the Task Scheduler trigger. */
export function nextWeekly(
  dow: number,
  hour: number,
  minute: number,
  now = Date.now(),
): Date {
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  let delta = (dow - d.getDay() + 7) % 7;
  if (delta === 0 && d.getTime() <= now) delta = 7;
  d.setDate(d.getDate() + delta);
  return d;
}

export interface WindowStatus {
  resetsAt: Date | null;
  wakeAt: Date | null;
  inWindow: boolean;
  hoursUntilReset: number | null;
  hoursUntilWake: number | null;
}

/** Are we inside [wake, reset) for the given reset timestamp? */
export function windowStatus(
  resetsAtIso: string | null | undefined,
  cfg: AshwellConfig,
  now = Date.now(),
): WindowStatus {
  if (!resetsAtIso) {
    return {
      resetsAt: null,
      wakeAt: null,
      inWindow: false,
      hoursUntilReset: null,
      hoursUntilWake: null,
    };
  }
  const reset = new Date(resetsAtIso);
  const { hour, minute } = parseTime(cfg.wake.time);
  const wake = computeWake(reset, hour, minute);
  return {
    resetsAt: reset,
    wakeAt: wake,
    inWindow: now >= wake.getTime() && now < reset.getTime(),
    hoursUntilReset: (reset.getTime() - now) / 3_600_000,
    hoursUntilWake: (wake.getTime() - now) / 3_600_000,
  };
}
