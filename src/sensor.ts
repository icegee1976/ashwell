import { execFileSync } from "node:child_process";
import type { UsageResponse } from "./types.js";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const BETA = "oauth-2025-04-20";

/** Fallback User-Agent version when detection fails. */
export const DEFAULT_CC_VERSION = "2.1.91";

export class TokenExpiredError extends Error {
  constructor(msg = "usage 端點回 401(access token 無效)。") {
    super(msg);
    this.name = "TokenExpiredError";
  }
}

export class RateLimitedError extends Error {
  constructor(
    msg = "usage 端點回 429(限流,且無 Retry-After)。Ashwell 不輪詢;將於下次排程喚醒(且超過最小間隔)時重試。",
  ) {
    super(msg);
    this.name = "RateLimitedError";
  }
}

/** Best-effort `claude --version` so the User-Agent matches a real client. */
export function getClaudeCodeVersion(): string | null {
  try {
    // On Windows `claude` is a .cmd shim, so go via cmd /c (fixed command,
    // no user input) instead of `shell: true`, which triggers DEP0190.
    const out =
      process.platform === "win32"
        ? execFileSync("cmd.exe", ["/c", "claude --version"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 5000,
            windowsHide: true,
          })
        : execFileSync("claude", ["--version"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 5000,
          });
    const m = out.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export async function fetchUsage(
  accessToken: string,
  ccVersion: string,
): Promise<UsageResponse> {
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(USAGE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": BETA,
        "Content-Type": "application/json",
        "User-Agent": `claude-code/${ccVersion}`,
      },
    });
  } catch (e) {
    throw new Error(`連線 usage 端點失敗:${(e as Error).message}`);
  }

  if (res.status === 401) throw new TokenExpiredError();
  if (res.status === 429) throw new RateLimitedError();
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`usage 端點回 ${res.status} ${res.statusText}. ${body.slice(0, 200)}`);
  }
  return (await res.json()) as UsageResponse;
}
