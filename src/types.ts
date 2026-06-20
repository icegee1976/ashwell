/** One usage window as returned by GET /api/oauth/usage. */
export interface UsageWindow {
  /** Percentage already consumed, 0–100. Remaining = 100 − utilization. */
  utilization: number;
  /** ISO-8601 UTC reset timestamp, or null when not applicable. */
  resets_at: string | null;
}

/**
 * Shape of the (undocumented) usage endpoint response. Fields are optional /
 * nullable on purpose — the endpoint is unofficial and may add or drop keys.
 */
export interface UsageResponse {
  five_hour?: UsageWindow | null;
  seven_day?: UsageWindow | null;
  seven_day_oauth_apps?: UsageWindow | null;
  seven_day_opus?: UsageWindow | null;
  // The live endpoint also returns extra_usage / spend / limits[] / scoped
  // windows etc. We only read the windows above, so allow anything else through.
  [key: string]: unknown;
}

export type Tier = "large" | "medium" | "small" | "skip";

export type TaskSize = "small" | "medium" | "large";

export interface BacklogTask {
  id: string;
  title: string;
  size: TaskSize;
  prompt: string;
  done?: boolean;
}

export interface State {
  /** ISO timestamp of the last successful endpoint call. */
  lastCheckedAt?: string;
  /** Cached full usage response (used to avoid re-hitting the endpoint). */
  lastUsage?: UsageResponse;
  /** Cached seven_day.resets_at so we can gate the window without a call. */
  cachedResetsAt?: string | null;
  /** Last suggestion we surfaced, to de-dupe hourly notifications. */
  lastSuggestion?: { taskId: string; at: string; tier: Tier } | null;
  /** Task ids already executed (reserved for v2 auto-exec). */
  executedTaskIds?: string[];
  /** Ashwell's self-refreshed OAuth tokens — kept here, NOT in .credentials.json. */
  auth?: { accessToken: string; refreshToken?: string; expiresAt?: number };
}
