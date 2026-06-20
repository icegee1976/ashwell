# Registers a Windows Scheduled Task that runs `ashwell run` every N minutes.
# Ashwell itself stays cheap: outside the weekly T-24h window it reads the cached
# resets_at and exits without calling the endpoint.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\register-task-windows.ps1
#
# Remove with:
#   Unregister-ScheduledTask -TaskName 'Ashwell' -Confirm:$false

[CmdletBinding()]
param(
  [string]$ProjectDir = (Split-Path -Parent $PSScriptRoot),
  [string]$TaskName = "Ashwell",
  [string]$NodeExe = "",
  [int]$IntervalMinutes = 60
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

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings `
  -Description "Ashwell: leftover Claude quota finisher. Checks every $IntervalMinutes min; acts only inside the weekly T-24h window." `
  -Force | Out-Null

Write-Output "已註冊排程工作 '$TaskName':每 $IntervalMinutes 分鐘執行 `"node $cli run`" (WorkingDir=$ProjectDir)。"
Write-Output "立刻測試一次: Start-ScheduledTask -TaskName '$TaskName'"
Write-Output "移除:           Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
