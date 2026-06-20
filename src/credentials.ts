import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export interface OAuthCreds {
  accessToken: string;
  refreshToken?: string;
  /** Epoch (ms or s — normalised by the sensor). */
  expiresAt?: number;
  subscriptionType?: string;
  scopes?: string[];
  /** Human label of where the credential came from (for logs). */
  source: string;
}

/** Windows + Linux both store the OAuth blob here; macOS uses the Keychain. */
export const CRED_FILE = join(homedir(), ".claude", ".credentials.json");

function parse(raw: string, source: string): OAuthCreds | null {
  const json = JSON.parse(raw);
  const o = json?.claudeAiOauth ?? json;
  if (!o || typeof o.accessToken !== "string" || !o.accessToken) return null;
  return {
    accessToken: o.accessToken,
    refreshToken: o.refreshToken,
    expiresAt: typeof o.expiresAt === "number" ? o.expiresAt : undefined,
    subscriptionType: o.subscriptionType,
    scopes: Array.isArray(o.scopes) ? o.scopes : undefined,
    source,
  };
}

function fromFile(): OAuthCreds | null {
  try {
    return parse(readFileSync(CRED_FILE, "utf8"), CRED_FILE);
  } catch {
    return null;
  }
}

function fromMacKeychain(): OAuthCreds | null {
  try {
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf8" },
    );
    return parse(raw, "macOS Keychain");
  } catch {
    return null;
  }
}

/**
 * Read Claude Code's OAuth credentials. macOS tries the Keychain first
 * (falling back to the file); every other platform reads the file.
 */
export function readCredentials(): OAuthCreds {
  const sources =
    platform() === "darwin" ? [fromMacKeychain, fromFile] : [fromFile];
  for (const get of sources) {
    const creds = get();
    if (creds) return creds;
  }
  const where =
    platform() === "darwin"
      ? `macOS Keychain ("Claude Code-credentials") 或 ${CRED_FILE}`
      : CRED_FILE;
  throw new Error(
    `找不到 Claude Code 憑證(${where})。請先在終端機登入並跑一次 \`claude\`。`,
  );
}
