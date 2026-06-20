# Ashwell

> 排程觸發的 **Claude 餘量收尾執行器**。在每週用量(weekly session)重置前約 24 小時自動醒來,讀剩餘額度,依剩餘量決定「該拿這些快過期的餘量去 build 什麼」,並建議給你。

核心迴圈:**sense → decide →(act)→ log**。

Ashwell 不是即時監控器(那種一堆了:ccusage、usage-monitor…)。它是排程觸發、只在「reset 前 24h 窗」內動作的收尾器——感測只是前置,差異點在 **decide**(依餘量分級挑任務)。

**v1 是 notify-only**:只建議+通知,**不自動執行**。auto-exec 留 v2。

---

## 它怎麼運作

每小時被排程喚醒一次,跑 `ashwell run`:

1. **窗外** → 讀 state 快取的 `resets_at`,直接結束,**不打端點**(端點限流極兇,絕不輪詢)。
2. **進入 weekly reset 前 24h 窗** → 打 `GET /api/oauth/usage`,算 `remaining = 100 − seven_day.utilization`。
3. **依剩餘量分級**(tier),從 `ashwell.backlog.yaml` 挑「塞得進當前 tier 的最大任務」。
4. **通知**:寫 `~/.ashwell/latest-suggestion.txt` + log + 盡力跳 Windows toast。

| remaining | tier | 行為 |
|---|---|---|
| ≥ 40% | `large` | 挑 large(或更小)任務 |
| 15–40% | `medium` | 挑 medium / small |
| 5–15% | `small` | 只挑 small |
| < 5% | `skip` | 不啟動,避免 reset 前卡在任務中途 |

---

## 安裝(Windows,主要平台)

需求:**Node.js ≥ 20**(實測 Node 24)。

```powershell
cd "E:\@_CLAUDE CODE\ashwell"
npm install
npm run build          # tsc → dist/

# 先手動驗證感測(讀你本機憑證 + 打端點一次)
node dist\cli.js status

# 註冊每小時排程工作(內部呼叫 scripts\register-task-windows.ps1)
node dist\cli.js install
```

`install` 會註冊一個名為 **Ashwell** 的 Task Scheduler 工作,每 60 分鐘執行 `node dist\cli.js run`。
移除:

```powershell
Unregister-ScheduledTask -TaskName 'Ashwell' -Confirm:$false
```

> 想全域 `ashwell` 指令:在專案目錄跑 `npm link`,即可用 `ashwell status` / `ashwell run`。

---

## 指令

```
ashwell run              主流程(排程跑這個)
ashwell status           立刻查餘量 / tier / 窗口(手動檢視)
ashwell status --json    額外輸出 JSON
ashwell status --force   忽略最小間隔強制查(注意:可能撞 429)
ashwell backlog          列出 backlog 任務
ashwell install          (Windows) 註冊排程工作
ashwell help

旗標: --backlog <path>  --config <path>  --json  --quiet/-q  --force
```

---

## 設定

`ashwell.config.json`(放專案目錄或 `~/.ashwell/config.json`;省略則用內建預設)。範例見 `ashwell.config.example.json`:

```json
{
  "window": { "sevenDayHours": 24 },
  "tiers": { "large": 40, "medium": 15, "small": 5 },
  "minCheckIntervalMinutes": 30,
  "backlogPath": "./ashwell.backlog.yaml",
  "logFile": "~/.ashwell/ashwell.log",
  "notify": { "toast": true },
  "userAgentVersion": null,
  "considerOpus": true
}
```

- `window.sevenDayHours` — 觸發窗寬度(reset 前幾小時開窗)。
- `minCheckIntervalMinutes` — 兩次「真的打端點」之間的最小間隔,防 429。
- `userAgentVersion` — `null` 時自動偵測 `claude --version`。
- `considerOpus` — Opus 餘量充足時在建議裡加註(不改動核心 tier,保持可預測)。

---

## Backlog

`ashwell.backlog.yaml` — 平常把想做的東西丟進來、標 `size`(`small`/`medium`/`large`):

```yaml
tasks:
  - id: refactor-camverse-logs
    title: "CamVerse 日誌模組重構"
    size: medium
    prompt: "重構 ./src/logging,拆出 structured logger,補測試。"
```

挑選規則:當前 tier 內,**挑塞得進的最大任務**(把快過期的額度燒成產出),同級依 FIFO。

---

## 兩個關鍵雷(已內建對策)

1. **429 限流極兇且無 `Retry-After`**,可連卡 30+ 分鐘 → Ashwell **絕不輪詢**:窗外不打、窗內最多每 `minCheckIntervalMinutes` 打一次,結果快取進 state。
2. **Token 會過期**:Ashwell 讀到的 accessToken 可能已被 CC 續期掉而失效(401) → v1 記 log 後優雅退出,提示你「先跑一次任意 `claude` 指令續期」。v2 再做用 refreshToken 自行續期。

---

## 憑證與隱私

- 憑證在 **runtime 由你本機讀取**:
  - **Windows / Linux**:`~/.claude/.credentials.json`
  - **macOS**:Keychain 項目 `"Claude Code-credentials"`(失敗則退回檔案)
- accessToken **只**送往官方端點 `api.anthropic.com`,不外送任何第三方。
- state / log / 建議都在本機 `~/.ashwell/`。

---

## 其他平台排程

- **macOS**:`scripts/com.ashwell.agent.plist`(launchd,每小時)。
- **Linux**:systemd timer 或 cron,每小時跑 `node /path/to/dist/cli.js run`。

---

## 路線圖

- **v1(現在)**:notify-only。先把感測正確、不踩限流、決策合理跑順。
- **v2**:auto-exec —— `claude -p "<task.prompt>"` headless 實際執行;執行前再讀一次 remaining 當安全閥,低於門檻不啟動。用 refreshToken 自行續期。多帳號輪替(挑餘量最多的)。

> 官方缺口:社群多次要求官方 `claude usage` 指令/端點(anthropics/claude-code #44328、#32796、#31637)。目前只能走這個未公開端點;官方若出正式 API 應優先切換。

## License

MIT
