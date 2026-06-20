import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./log.js";
import { STATE_DIR } from "./state.js";

/**
 * Best-effort Windows toast via PowerShell's WinRT API — no extra dependency.
 * Any failure is swallowed; the log file + latest-suggestion.txt are the
 * reliable channels.
 */
export function windowsToast(title: string, message: string): void {
  if (process.platform !== "win32") return;
  const script = `
$ErrorActionPreference='Stop'
try {
  $null=[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]
  $tpl=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
  $nodes=$tpl.GetElementsByTagName('text')
  $null=$nodes.Item(0).AppendChild($tpl.CreateTextNode($env:ASHWELL_TOAST_TITLE))
  $null=$nodes.Item(1).AppendChild($tpl.CreateTextNode($env:ASHWELL_TOAST_MSG))
  $toast=[Windows.UI.Notifications.ToastNotification]::new($tpl)
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Ashwell').Show($toast)
} catch {}
`;
  try {
    const child = execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        env: {
          ...process.env,
          ASHWELL_TOAST_TITLE: title,
          ASHWELL_TOAST_MSG: message,
        },
      },
      () => {},
    );
    child.on("error", () => {});
  } catch {
    /* best-effort */
  }
}

/** Persist the most recent suggestion so it can be read any time. */
export function writeLatestSuggestion(text: string, payload: unknown): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(join(STATE_DIR, "latest-suggestion.txt"), text, "utf8");
    writeFileSync(
      join(STATE_DIR, "latest-suggestion.json"),
      JSON.stringify(payload, null, 2),
      "utf8",
    );
  } catch (e) {
    log.warn(`寫入 latest-suggestion 失敗:${(e as Error).message}`);
  }
}

/** Persist a failure note so a desktop user can see it even if the toast is missed. */
export function writeLatestError(text: string): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(join(STATE_DIR, "latest-error.txt"), text, "utf8");
  } catch {
    /* best-effort */
  }
}

/** Remove a stale failure note after a successful run. */
export function clearLatestError(): void {
  try {
    rmSync(join(STATE_DIR, "latest-error.txt"), { force: true });
  } catch {
    /* ignore */
  }
}
