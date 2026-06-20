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

export interface WindowStatus {
  resetsAt: Date | null;
  opensAt: Date | null;
  inWindow: boolean;
  hoursUntilReset: number | null;
  hoursUntilOpen: number | null;
}

export function windowStatus(
  resetsAtIso: string | null | undefined,
  windowHours: number,
  now = Date.now(),
): WindowStatus {
  if (!resetsAtIso) {
    return {
      resetsAt: null,
      opensAt: null,
      inWindow: false,
      hoursUntilReset: null,
      hoursUntilOpen: null,
    };
  }
  const resetMs = new Date(resetsAtIso).getTime();
  const opensMs = resetMs - windowHours * 3_600_000;
  return {
    resetsAt: new Date(resetMs),
    opensAt: new Date(opensMs),
    inWindow: now >= opensMs && now < resetMs,
    hoursUntilReset: (resetMs - now) / 3_600_000,
    hoursUntilOpen: (opensMs - now) / 3_600_000,
  };
}
