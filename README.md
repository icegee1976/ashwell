# Ashwell

> 排程觸發的 **Claude 餘量收尾執行器**。每週在用量(weekly session)重置前幾小時自動醒來,讀剩餘額度,依剩餘量決定「該拿這些快過期的餘量去 build 什麼」,並建議給你。

核心迴圈:**sense → decide →(act)→ log**。

Ashwell 不是即時監控器(那種一堆了:ccusage、usage-monitor…)。它是排程觸發、只在「reset 前的喚醒窗」內動作的收尾器——感測只是前置,差異點在 **decide**(依餘量分級挑任務)。

**v1 是 notify-only**:只建議+通知,**不自動執行**。auto-exec 留 v2。

---

## 它怎麼運作

每週固定時間被喚醒一次(預設**週三 08:00 本機時間**,約 weekly reset 前 10 小時),跑 `ashwell run`:

1. **窗外**(手動跑時)→ 讀 state 快取的 `resets_at`,直接結束,**不打端點、不碰憑證**(端點限流極兇,絕不輪詢)。
2. **在喚醒窗內** → 打 `GET /api/oauth/usage`,算 `remaining = 100 − seven_day.utilization`;若偵測到 reset 日與設定不符會示警(Anthropic 改了 reset 時間時提醒你更新)。
3. **依剩餘量分級**(tier),從 `ashwell.backlog.yaml` 挑「塞得進當前 tier 的最大任務」。
4. **通知**:寫 `~/.ashwell/latest-suggestion.txt` + log + 盡力跳 Windows toast。

| remaining | tier | 行為 |
|---|---|---|
| ≥ 40% | `large` | 挑 large(或更小)任務 |
| 15–40% | `medium` | 挑 medium / small |
| 5–15% | `small` | 只挑 small |
| < 5% | `skip` | 不啟動,避免 reset 前卡在任務中途 |

> 為什麼用「固定每週 X 日」而不是「動態算 reset − 24h」:你的 weekly reset 穩定落在同一時刻,固定觸發器最簡單、最可靠(Task Scheduler 原生處理週期與漏跑),而 `run` 內仍用 live `resets_at` 做窗內確認與漂移示警——簡單但會自我校正。

---

## 安裝(Windows,主要平台)

需求:**Node.js ≥ 20**(實測 Node 24)。

```powershell
cd "E:\@_CLAUDE CODE\ashwell"
npm install
npm run build          # tsc → dist/

# 先離線確認排程時間與決策邏輯(不打端點)
node dist\cli.js when
node dist\cli.js simulate 35

# 手動驗證感測(讀本機憑證 + 打端點一次)
node dist\cli.js status

# 註冊每週排程工作(週三 08:00,時間讀 config.wake)
node dist\cli.js install
```

`install` 會註冊一個名為 **Ashwell** 的 Task Scheduler 工作,每週於 `config.wake`(預設週三 08:00)執行 `node dist\cli.js run`;`StartWhenAvailable` 會在電腦當時關機/睡眠時開機後補跑。
移除:

```powershell
Unregister-ScheduledTask -TaskName 'Ashwell' -Confirm:$false
```

> 想全域 `ashwell` 指令:在專案目錄跑 `npm link`,即可用 `ashwell status` / `ashwell when`。

---

## 指令

```
ashwell run              主流程(排程跑這個);窗外即退、不打端點
ashwell status           立刻查餘量 / tier / 喚醒窗(手動檢視)
ashwell status --json    額外輸出 JSON
ashwell when             顯示下次觸發時間;加 --reset <ISO> 可驗算喚醒/窗口
ashwell backlog          列出 backlog 任務
ashwell simulate [剩餘%]  離線試算決策,例:ashwell simulate 35 --opus 80
ashwell install          (Windows) 註冊每週排程工作
ashwell help

旗標: --backlog <path>  --config <path>  --json  --quiet/-q  --force
```

---

## 設定

`ashwell.config.json`(放專案目錄或 `~/.ashwell/config.json`;省略則用內建預設)。範例見 `ashwell.config.example.json`:

```json
{
  "wake": { "dayOfWeek": "Wednesday", "time": "08:00" },
  "tiers": { "large": 40, "medium": 15, "small": 5 },
  "minCheckIntervalMinutes": 30,
  "backlogPath": "./ashwell.backlog.yaml",
  "logFile": "~/.ashwell/ashwell.log",
  "notify": { "toast": true },
  "userAgentVersion": null,
  "considerOpus": true
}
```

- `wake.dayOfWeek` / `wake.time` — 每週喚醒的星期與**本機時間**(排程觸發器)。預設週三 08:00;改了要重跑 `ashwell install`。
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

- **macOS**:`scripts/com.ashwell.agent.plist`(launchd;範例用 `StartCalendarInterval` 設每週三 08:00)。
- **Linux**:systemd timer 或 cron,每週三 08:00 跑 `node /path/to/dist/cli.js run`(cron 例:`0 8 * * 3`)。

---

## 路線圖

- **v1(現在)**:notify-only。感測正確、不踩限流、決策合理、精準排程已驗證。
- **v2**:auto-exec —— wake 後的「是否執行」階段。可能形態:`ashwell go`(你一鍵核准跑 `claude -p`)或全自動(config flag + 執行前再讀餘量的安全閥);用 refreshToken 自行續期;多帳號輪替。
  - 注意:backlog 任務會修改真實程式碼,自動執行需謹慎(建議跑在隔離 worktree)。

> 官方缺口:社群多次要求官方 `claude usage` 指令/端點(anthropics/claude-code #44328、#32796、#31637)。目前只能走這個未公開端點;官方若出正式 API 應優先切換。

## License

MIT
