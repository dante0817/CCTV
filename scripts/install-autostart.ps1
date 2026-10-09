param([switch]$ExperimentalAtStartup)
$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $PSScriptRoot
$TaskName='CCTV Monitor'
$LegacyTaskName='CCTV Monitor P0.9'
if(Get-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue){ Unregister-ScheduledTask -TaskName $LegacyTaskName -Confirm:$false; Write-Host "[INFO] Removed legacy autostart task: $LegacyTaskName" -ForegroundColor Yellow }
$script=Join-Path $Root 'scripts\start-production-task.ps1'
$cache=Join-Path $Root '.cctv-cache'; New-Item -ItemType Directory -Force -Path $cache | Out-Null
$node=(Get-Command node.exe -ErrorAction Stop).Source
Set-Content -Path (Join-Path $cache 'node-path.txt') -Value $node -NoNewline
if(-not (Test-Path (Join-Path $Root 'dist-server\server.js')) -or -not (Test-Path (Join-Path $Root 'dist\index.html'))){ throw 'Build production first with START-CCTV-MONITOR-PRODUCTION.cmd.' }
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
if($ExperimentalAtStartup){
  Write-Warning 'Experimental SYSTEM-at-startup mode can fail with some DirectShow webcams. Qualify this on the actual CCTV PC before relying on it.'
  $trigger=New-ScheduledTaskTrigger -AtStartup
  $principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
} else {
  $user=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $trigger=New-ScheduledTaskTrigger -AtLogOn -User $user
  $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
}
Write-Host "[OK] Scheduled task installed: $TaskName" -ForegroundColor Green
Write-Host 'Default mode starts at Windows sign-in. Use -ExperimentalAtStartup only after hardware qualification.' -ForegroundColor Yellow
