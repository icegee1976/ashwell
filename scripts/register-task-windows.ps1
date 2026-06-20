# Registers a Windows Scheduled Task that runs `ashwell run` once a week, at a
# fixed local time chosen to fall a few hours before the weekly quota reset.
# (Default: Wednesday 08:00, ~10h before the observed Wed 18:00 reset.)
#
# ASCII-only on purpose: Windows PowerShell 5.1 decodes a BOM-less .ps1 with the
# system codepage, so non-ASCII here can corrupt parsing. Keep messages English.
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
    Write-Error "node not found on PATH. Install Node.js or pass -NodeExe <full path>."
    exit 1
  }
  $NodeExe = $cmd.Source
}

$cli = Join-Path $ProjectDir "dist\cli.js"
if (-not (Test-Path $cli)) {
  Write-Error "Not found: $cli  -- run 'npm install; npm run build' in the project first."
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

Write-Output ("Registered scheduled task '{0}': every {1} {2}, runs `"node {3} run`" (WorkingDir={4})." -f $TaskName, $DayOfWeek, $At, $cli, $ProjectDir)
Write-Output ("Test now:  Start-ScheduledTask -TaskName '{0}'" -f $TaskName)
Write-Output ("Remove:    Unregister-ScheduledTask -TaskName '{0}' -Confirm:`$false" -f $TaskName)
