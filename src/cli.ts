#!/usr/bin/env node
import { loadConfig, type AshwellConfig } from "./config.js";
import { readCredentials } from "./credentials.js";
import {
  DEFAULT_CC_VERSION,
  fetchUsage,
  getClaudeCodeVersion,
  RateLimitedError,
  TokenExpiredError,
} from "./sensor.js";
import { remaining, tierFor, windowStatus } from "./decider.js";
import { loadBacklog, pickTasks } from "./backlog.js";
import { loadState, saveState } from "./state.js";
import { windowsToast, writeLatestSuggestion } from "./notify.js";
import { initLogger, log } from "./log.js";
import type { State, Tier, UsageResponse } from "./types.js";

interface Flags {
  force: boolean;
  quiet: boolean;
  json: boolean;
  backlog?: string;
  config?: string;
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = { force: false, quiet: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") f.force = true;
    else if (a === "--quiet" || a === "-q") f.quiet = true;
    else if (a === "--json") f.json = true;
    else if (a === "--backlog") f.backlog = argv[++i];
    else if (a === "--config") f.config = argv[++i];
  }
  return f;
}

function fmtPct(n: number | null): string {
  return n == null ? "n/a" : `${n.toFixed(1)}%`;
}

function fmtHours(h: number | null): string {
  if (h == null) return "n/a";
  if (h < 0) return `${(-h).toFixed(1)}h 前`;
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
}

function handleSensorError(e: unknown): void {
  if (e instanceof TokenExpiredError || e instanceof RateLimitedError) log.warn(e.message);
  else log.error(`感測失敗:${(e as Error).message}`);
}

/**
 * Read usage, honouring the min-check interval (uses cache when within it,
 * unless --force or forced fresh). Mutates `state` on a live call.
 */
async function getUsage(
  cfg: AshwellConfig,
  state: State,
  flags: Flags,
  honorInterval: boolean,
): Promise<UsageResponse | null> {
  const now = Date.now();
  const lastChecked = state.lastCheckedAt ? Date.parse(state.lastCheckedAt) : 0;
  const minMs = cfg.minCheckIntervalMinutes * 60_000;

  if (honorInterval && !flags.force && state.lastUsage && now - lastChecked < minMs) {
    const ago = Math.round((now - lastChecked) / 60_000);
    log.info(`距上次檢查 ${ago}m < 最小間隔 ${cfg.minCheckIntervalMinutes}m;沿用快取,避免 429。`);
    return state.lastUsage;
  }

  const creds = readCredentials();
  log.info(
    `憑證來源:${creds.source}${creds.subscriptionType ? ` (plan: ${creds.subscriptionType})` : ""}`,
  );
  const version = cfg.userAgentVersion ?? getClaudeCodeVersion() ?? DEFAULT_CC_VERSION;
  const usage = await fetchUsage(creds, version);
  state.lastCheckedAt = new Date(now).toISOString();
  state.lastUsage = usage;
  return usage;
}

function reportUsage(cfg: AshwellConfig, usage: UsageResponse) {
  const sd = usage.seven_day;
  const remSd = remaining(sd);
  const ws = windowStatus(sd?.resets_at, cfg.window.sevenDayHours);
  const opus = remaining(usage.seven_day_opus);
  log.info(
    `weekly 剩餘 ${fmtPct(remSd)}(已用 ${sd?.utilization ?? "?"}%)| reset @ ${sd?.resets_at ?? "?"}(${fmtHours(ws.hoursUntilReset)} 後)`,
  );
  log.info(
    `窗口(T-${cfg.window.sevenDayHours}h):${ws.inWindow ? "✅ 開啟中" : `尚未開啟,${fmtHours(ws.hoursUntilOpen)} 後開`}`,
  );
  if (opus != null) log.info(`Opus weekly 剩餘 ${fmtPct(opus)}`);
  return { sd, remSd, ws, opus };
}

function notify(
  cfg: AshwellConfig,
  title: string,
  body: string,
  payload: Record<string, unknown>,
  toast = true,
): void {
  const text = `${title}\n\n${body}\n`;
  writeLatestSuggestion(text, { at: new Date().toISOString(), ...payload });
  if (cfg.notify.toast && toast) windowsToast(title.slice(0, 120), body.slice(0, 300));
}

// ── commands ────────────────────────────────────────────────────────────────

async function cmdRun(flags: Flags): Promise<void> {
  const cfg = loadConfig({ configPath: flags.config, backlogOverride: flags.backlog });
  initLogger({ logFile: cfg.logFile, quiet: flags.quiet });
  const state = loadState();
  const now = Date.now();
  const windowMs = cfg.window.sevenDayHours * 3_600_000;
  const cachedReset = state.cachedResetsAt ? Date.parse(state.cachedResetsAt) : NaN;

  // Decide whether to touch the endpoint at all (429 thrift).
  let honorInterval = true;
  if (!state.cachedResetsAt || Number.isNaN(cachedReset)) {
    log.info("首次執行:bootstrap 一次以取得 resets_at。");
    honorInterval = false;
  } else if (now >= cachedReset) {
    log.info("快取的週期已重置,重新取得 resets_at。");
    honorInterval = false;
  } else if (now >= cachedReset - windowMs) {
    // inside the window — proceed, honouring the min-check interval
  } else {
    const opensAt = new Date(cachedReset - windowMs);
    log.info(
      `窗外。下次窗口 ${opensAt.toISOString()} 開啟(reset ${new Date(cachedReset).toISOString()})。不打端點,結束。`,
    );
    if (!flags.force) return;
    log.info("--force:仍強制檢查。");
    honorInterval = false;
  }

  let usage: UsageResponse | null;
  try {
    usage = await getUsage(cfg, state, flags, honorInterval);
  } catch (e) {
    handleSensorError(e);
    saveState(state);
    process.exitCode = 1;
    return;
  }
  if (!usage) {
    saveState(state);
    return;
  }

  const { sd, remSd, ws, opus } = reportUsage(cfg, usage);
  if (sd?.resets_at) state.cachedResetsAt = sd.resets_at;

  if (!ws.inWindow && !flags.force) {
    log.info("尚未進入觸發窗;已更新快取,結束(不建議任務)。");
    saveState(state);
    return;
  }
  if (remSd == null) {
    log.warn("沒有 seven_day 資料,無法決策。");
    saveState(state);
    return;
  }

  const tier = tierFor(remSd, cfg);
  if (tier === "skip") {
    const msg = `剩餘僅 ${fmtPct(remSd)}(< ${cfg.tiers.small}%);reset 前不啟動任務,避免中途撞牆。`;
    log.info(`決策:SKIP — ${msg}`);
    notify(cfg, "Ashwell: SKIP", msg, { tier, remaining: remSd, chosen: null });
    state.lastSuggestion = null;
    saveState(state);
    return;
  }

  const tasks = pickTasks(loadBacklog(cfg.backlogPath), tier, state.executedTaskIds ?? []);
  const chosen = tasks[0] ?? null;
  const opusNote =
    cfg.considerOpus && opus != null && opus >= cfg.tiers.large
      ? ` | Opus 餘量充足(${fmtPct(opus)}),可挑更重的任務。`
      : "";

  const headline = chosen
    ? `tier=${tier} · 剩 ${fmtPct(remSd)} · 建議:${chosen.title}`
    : `tier=${tier} · 剩 ${fmtPct(remSd)} · backlog 無符合 ${tier} 的任務`;
  const body = chosen
    ? `[${chosen.id}] ${chosen.title} (size=${chosen.size})\nprompt: ${chosen.prompt}\n\n其他候選:${tasks.slice(1, 4).map((t) => t.id).join(", ") || "(無)"}\nreset @ ${sd?.resets_at}(${fmtHours(ws.hoursUntilReset)} 後)${opusNote}`
    : `往 ${cfg.backlogPath} 補一個 size<=${tier} 的任務。\nreset @ ${sd?.resets_at}(${fmtHours(ws.hoursUntilReset)} 後)${opusNote}`;

  log.info("─".repeat(56));
  log.info(`決策:${headline}`);
  if (chosen) log.info(`  prompt: ${chosen.prompt}`);
  log.info("─".repeat(56));

  // De-dupe noisy hourly toasts: only fire when the chosen task changes.
  const prevId = state.lastSuggestion?.taskId ?? null;
  const curId = chosen?.id ?? "(none)";
  notify(
    cfg,
    `Ashwell: ${headline}`,
    body,
    { tier, remaining: remSd, opusRemaining: opus, resetsAt: sd?.resets_at, chosen },
    prevId !== curId,
  );
  state.lastSuggestion = { taskId: curId, at: new Date(now).toISOString(), tier };
  saveState(state);
}

async function cmdStatus(flags: Flags): Promise<void> {
  const cfg = loadConfig({ configPath: flags.config, backlogOverride: flags.backlog });
  initLogger({ logFile: cfg.logFile, quiet: flags.quiet });
  const state = loadState();
  try {
    const usage = await getUsage(cfg, state, flags, /* honorInterval */ true);
    saveState(state);
    if (!usage) return;
    const { sd, remSd, ws, opus } = reportUsage(cfg, usage);
    if (remSd != null) {
      const tier = tierFor(remSd, cfg);
      log.info(`目前 tier:${tier}`);
      if (tier !== "skip") {
        const ids = pickTasks(loadBacklog(cfg.backlogPath), tier, state.executedTaskIds ?? []).map(
          (t) => t.id,
        );
        log.info(`符合 tier 的候選:${ids.length ? ids.join(", ") : "(backlog 無符合項)"}`);
      }
    }
    if (flags.json) {
      process.stdout.write(
        JSON.stringify(
          {
            remaining: remSd,
            opusRemaining: opus,
            tier: remSd != null ? tierFor(remSd, cfg) : null,
            inWindow: ws.inWindow,
            resetsAt: sd?.resets_at ?? null,
            opensAt: ws.opensAt?.toISOString() ?? null,
          },
          null,
          2,
        ) + "\n",
      );
    }
  } catch (e) {
    handleSensorError(e);
    saveState(state);
    process.exitCode = 1;
  }
}

function cmdBacklog(flags: Flags): void {
  const cfg = loadConfig({ configPath: flags.config, backlogOverride: flags.backlog });
  initLogger({ logFile: null, quiet: flags.quiet });
  const tasks = loadBacklog(cfg.backlogPath);
  if (!tasks.length) {
    log.info(`backlog 空或讀不到:${cfg.backlogPath}`);
    return;
  }
  log.info(`backlog (${cfg.backlogPath}):`);
  for (const t of tasks) {
    log.info(`  [${t.size.padEnd(6)}] ${t.id} — ${t.title}${t.done ? " (done)" : ""}`);
  }
}

async function cmdInstall(flags: Flags): Promise<void> {
  initLogger({ logFile: null, quiet: flags.quiet });
  if (process.platform !== "win32") {
    log.info(
      "非 Windows:請見 scripts/com.ashwell.agent.plist(macOS launchd)或 README 的 systemd / cron 範例。",
    );
    return;
  }
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { dirname, resolve } = await import("node:path");
  const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const ps1 = resolve(projectDir, "scripts", "register-task-windows.ps1");
  log.info(`執行:powershell -File ${ps1}`);
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "-ProjectDir", projectDir],
      { encoding: "utf8" },
    );
    log.info(out.trim());
    log.info("完成。可在「工作排程器 / Task Scheduler」看到 Ashwell 工作。");
  } catch (e) {
    log.error(`註冊失敗:${(e as Error).message}`);
    log.info(`可手動跑:powershell -ExecutionPolicy Bypass -File "${ps1}"`);
  }
}

/** Offline dry-run of the decide → pick path against a synthetic remaining %. */
function cmdSimulate(flags: Flags, rest: string[]): void {
  const cfg = loadConfig({ configPath: flags.config, backlogOverride: flags.backlog });
  initLogger({ logFile: null, quiet: flags.quiet });

  let remPct = 50;
  let opusPct: number | null = null;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--opus") opusPct = Number(rest[++i]);
    else if (/^\d+(\.\d+)?$/.test(a)) remPct = Number(a);
  }
  remPct = Math.max(0, Math.min(100, remPct));

  log.info(
    `[simulate] 假設 weekly 剩餘 ${remPct}%${opusPct != null ? `、Opus 剩餘 ${opusPct}%` : ""}(不打端點、不動 state)`,
  );
  const resetsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h → 必在窗內
  const usage: UsageResponse = {
    seven_day: { utilization: 100 - remPct, resets_at: resetsAt },
    seven_day_opus:
      opusPct != null ? { utilization: 100 - opusPct, resets_at: resetsAt } : null,
  };

  const { remSd, opus } = reportUsage(cfg, usage);
  if (remSd == null) return;
  const tier = tierFor(remSd, cfg);

  log.info("─".repeat(56));
  if (tier === "skip") {
    log.info(`決策:SKIP — 剩餘 < ${cfg.tiers.small}%,reset 前不啟動任務。`);
    log.info("─".repeat(56));
    return;
  }
  const tasks = pickTasks(loadBacklog(cfg.backlogPath), tier, []);
  const chosen = tasks[0] ?? null;
  const opusNote =
    cfg.considerOpus && opus != null && opus >= cfg.tiers.large
      ? ` | Opus 餘量充足(${fmtPct(opus)})`
      : "";
  if (chosen) {
    log.info(`決策:tier=${tier} · 剩 ${fmtPct(remSd)} · 建議:[${chosen.id}] ${chosen.title} (size=${chosen.size})`);
    log.info(`  prompt: ${chosen.prompt}`);
    log.info(`  其他候選:${tasks.slice(1, 4).map((t) => t.id).join(", ") || "(無)"}${opusNote}`);
  } else {
    log.info(`決策:tier=${tier} · 剩 ${fmtPct(remSd)} · backlog 無符合 ${tier} 的任務${opusNote}`);
  }
  log.info("─".repeat(56));
}

function cmdHelp(): void {
  process.stdout.write(`
ashwell — 排程觸發的 Claude 餘量收尾執行器 (v1: notify-only)

用法:
  ashwell run              主流程:窗外即退(不打端點);窗內讀餘量 → 決策 → 建議+通知
  ashwell status           立刻查一次目前餘量 / tier / 窗口(手動檢視;遵守最小間隔)
  ashwell status --force   忽略最小間隔強制查(注意:可能撞 429)
  ashwell status --json    額外輸出 JSON
  ashwell backlog          列出 backlog 任務
  ashwell simulate [剩餘%]  離線試算決策(不打端點/不動 state),例:ashwell simulate 35 --opus 80
  ashwell install          (Windows) 註冊每小時的排程工作
  ashwell help             顯示本說明

旗標:  --backlog <path>   --config <path>   --json   --quiet/-q   --force

檔案:  state   ~/.ashwell/state.json
        log     ~/.ashwell/ashwell.log
        建議    ~/.ashwell/latest-suggestion.txt
`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  switch ((cmd ?? "help").toLowerCase()) {
    case "run":
      await cmdRun(flags);
      break;
    case "status":
    case "check":
      await cmdStatus(flags);
      break;
    case "backlog":
      cmdBacklog(flags);
      break;
    case "simulate":
    case "sim":
      cmdSimulate(flags, rest);
      break;
    case "install":
      await cmdInstall(flags);
      break;
    default:
      cmdHelp();
      break;
  }
}

main().catch((e) => {
  log.error(`未預期錯誤:${e?.stack ?? e}`);
  process.exitCode = 1;
});
