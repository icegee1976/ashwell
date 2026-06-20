# Registers a Windows Scheduled Task that runs `ashwell run` once a week, at a
# fixed local time chosen to fall a few hours before the weekly quota reset.
# (Default: Wednesday 08:00, ~10h before the observed Wed 17:59 reset.)
#
# Ashwell stays cheap: a run outside the wake window reads the cached resets_at
# and exits without calling the endpoint. v1 never calls any Claude model.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\register-task-windows.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\register-task-windows.ps1 -DayOfWeek Wednesday -At 08:00
#
# Remove with:
#   Unregister-ScheduledTask -TaskName 'Ashwell' -Confirm:$false

[CmdletBinding()]
param(
  [string]$ProjectDir = (Split-Path -Parent $PSScriptRoot),
  [string]$TaskName = "Ashwell",
  [string]$NodeExe = "",
  [ValidateSet("Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday")]
  [string]$DayOfWeek = "Wednesday",
  [string]$At = "08:00"
)

if (-not $NodeExe) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $cmd) {
    Write-Error "找不到 node。請確認 Node.js 在 PATH,或用 -NodeExe 指定完整路徑。"
    exit 1
  }
  $NodeExe = $cmd.Source
}

$cli = Join-Path $ProjectDir "dist\cli.js"
if (-not (Test-Path $cli)) {
  Write-Error "找不到 $cli。請先在專案目錄執行: npm install; npm run build"
  exit 1
}

$action = New-ScheduledTaskAction -Execute $NodeExe `
  -Argument ('"{0}" run' -f $cli) `
  -WorkingDirectory $ProjectDir

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DayOfWeek -At $At

# StartWhenAvailable: if the PC is asleep/off at trigger time, run as soon as it
# wakes (recovers a missed weekly window).
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings `
  -Description "Ashwell: weekly leftover-quota finisher. Wakes $DayOfWeek $At local, a few hours before the weekly reset." `
  -Force | Out-Null

Write-Output "已註冊排程工作 '$TaskName':每週 $DayOfWeek $At 執行 `"node $cli run`" (WorkingDir=$ProjectDir)。"
Write-Output "立刻測試一次: Start-ScheduledTask -TaskName '$TaskName'"
Write-Output "移除:           Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
