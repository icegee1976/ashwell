import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

let logFile: string | null = null;
let quiet = false;

export function initLogger(opts: { logFile?: string | null; quiet?: boolean }): void {
  logFile = opts.logFile ?? null;
  quiet = opts.quiet ?? false;
}

function stamp(): string {
  return new Date().toISOString();
}

function write(level: string, msg: string, toStderr = false): void {
  const line = `[${stamp()}] ${level} ${msg}`;
  if (!quiet) (toStderr ? process.stderr : process.stdout).write(line + "\n");
  if (logFile) {
    try {
      mkdirSync(dirname(logFile), { recursive: true });
      appendFileSync(logFile, line + "\n", "utf8");
    } catch {
      /* never let logging crash the run */
    }
  }
}

export const log = {
  info: (m: string) => write("INFO ", m),
  warn: (m: string) => write("WARN ", m, true),
  error: (m: string) => write("ERROR", m, true),
};
