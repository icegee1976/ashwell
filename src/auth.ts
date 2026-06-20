import type { OAuthCreds } from "./credentials.js";
import type { State } from "./types.js";
import { log } from "./log.js";

// Claude Code's public OAuth client id (reverse-engineered, undocumented).
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

// api.anthropic.com reaches the backend with a claude-code User-Agent; the
// console.anthropic.com endpoint sits behind a browser-oriented Cloudflare
// challenge that blocks headless refresh. Try api first, console as fallback.
const TOKEN_URLS = [
  "https://api.anthropic.com/v1/oauth/token",
  "https://console.anthropic.com/v1/oauth/token",
];

const MARGIN_MS = 60_000;

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
}

export class RefreshFailedError extends Error {
  constructor(
    msg = "refresh token 失效或被拒。請在終端機跑一次 `claude` 重新登入,讓 ~/.claude/.credentials.json 取得新的 refresh token。",
  ) {
    super(msg);
    this.name = "RefreshFailedError";
  }
}

/** Claude Code stores expiresAt in ms; tolerate a seconds value just in case. */
function toMs(t?: number): number | undefined {
  if (!t) return undefined;
  return t < 1e12 ? t * 1000 : t;
}

/** Exchange a refresh token for a fresh access token (OAuth refresh grant). */
export async function refreshTokens(
  refreshToken: string,
  ccVersion: string,
): Promise<AuthTokens> {
  const params = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  };
  let lastErr = "";
  for (const url of TOKEN_URLS) {
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": `claude-code/${ccVersion}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
        body: new URLSearchParams(params),
      });
    } catch (e) {
      lastErr = `${url} → ${(e as Error).message}`;
      continue;
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      lastErr = `${url} → ${res.status} ${t.slice(0, 120)}`;
      continue;
    }
    const j = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!j.access_token) {
      lastErr = `${url} → 回應缺 access_token`;
      continue;
    }
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? refreshToken,
      expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined,
    };
  }
  throw new RefreshFailedError(
    `refresh 失敗(${lastErr})。可能 refresh token 已輪替/過期,或端點被擋。請在終端機跑一次 \`claude\` 重新登入。`,
  );
}

/**
 * Return a valid access token, refreshing via the refresh token when needed.
 * Tokens are cached in state.auth — NEVER written back to .credentials.json
 * (avoids the known refresh-corruption bug, anthropics/claude-code#61912).
 */
export async function ensureAccessToken(
  creds: OAuthCreds,
  state: State,
  ccVersion: string,
): Promise<string> {
  const a = state.auth;
  if (a?.accessToken && a.expiresAt && Date.now() < a.expiresAt - MARGIN_MS) {
    return a.accessToken;
  }
  const rt = a?.refreshToken ?? creds.refreshToken;
  if (rt) {
    log.info("access token 過期/不存在,用 refresh token 自助續期…");
    const t = await refreshTokens(rt, ccVersion);
    state.auth = { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt };
    const mins = t.expiresAt ? Math.round((t.expiresAt - Date.now()) / 60_000) : NaN;
    log.info(`✅ 續期成功${Number.isFinite(mins) ? `,新 token 約 ${mins}m 後到期` : ""}。`);
    return t.accessToken;
  }
  const expMs = toMs(creds.expiresAt);
  if (creds.accessToken && (!expMs || Date.now() < expMs - MARGIN_MS)) {
    return creds.accessToken;
  }
  throw new RefreshFailedError("找不到可用的 refresh token。請先在終端機跑一次 `claude` 登入。");
}

/** Force a refresh (reactive path, after a 401 from the API). Mutates state.auth. */
export async function forceRefresh(
  creds: OAuthCreds,
  state: State,
  ccVersion: string,
): Promise<string> {
  const rt = state.auth?.refreshToken ?? creds.refreshToken;
  if (!rt) throw new RefreshFailedError("找不到可用的 refresh token。");
  const t = await refreshTokens(rt, ccVersion);
  state.auth = { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt };
  return t.accessToken;
}
