import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface AshwellConfig {
  /** Weekly wake anchor in the machine's LOCAL time (the Task Scheduler trigger).
   *  Defaults to Wednesday 08:00 (≈10h before the observed Wed 17:59 reset). */
  wake: { dayOfWeek: string; time: string };
  /** Remaining-% thresholds. >=large => large tier, etc. */
  tiers: { large: number; medium: number; small: number };
  /** Minimum minutes between live endpoint calls (429 protection). */
  minCheckIntervalMinutes: number;
  /** Path to the YAML backlog (relative to config file, or absolute). */
  backlogPath: string;
  /** Where to append the run log. ~ is expanded. */
  logFile: string;
  notify: { toast: boolean };
  /** Override the claude-code/<version> User-Agent. null = auto-detect. */
  userAgentVersion: string | null;
  /** Annotate suggestions with Opus headroom. */
  considerOpus: boolean;
}

const DEFAULTS: AshwellConfig = {
  wake: { dayOfWeek: "Wednesday", time: "08:00" },
  tiers: { large: 40, medium: 15, small: 5 },
  minCheckIntervalMinutes: 30,
  backlogPath: "./ashwell.backlog.yaml",
  logFile: "~/.ashwell/ashwell.log",
  notify: { toast: true },
  userAgentVersion: null,
  considerOpus: true,
};

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, over: unknown): T {
  if (!isPlainObject(over)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(over)) {
    const b = (base as Record<string, unknown>)[key];
    const o = over[key];
    out[key] = isPlainObject(b) && isPlainObject(o) ? deepMerge(b, o) : o;
  }
  return out as T;
}

export function loadConfig(
  opts: { configPath?: string; backlogOverride?: string } = {},
): AshwellConfig {
  const candidates = [
    opts.configPath,
    resolve(process.cwd(), "ashwell.config.json"),
    join(homedir(), ".ashwell", "config.json"),
  ].filter((c): c is string => Boolean(c));

  let userCfg: unknown = null;
  let cfgDir = process.cwd();
  for (const candidate of candidates) {
    try {
      userCfg = JSON.parse(readFileSync(candidate, "utf8"));
      cfgDir = resolve(candidate, "..");
      break;
    } catch {
      /* try next candidate */
    }
  }

  const cfg = deepMerge(DEFAULTS, userCfg);
  if (opts.backlogOverride) cfg.backlogPath = opts.backlogOverride;

  cfg.logFile = expandHome(cfg.logFile);
  const bp = expandHome(cfg.backlogPath);
  cfg.backlogPath = isAbsolute(bp) ? bp : resolve(cfgDir, bp);
  return cfg;
}
