param([int]$Port=3000)
$ErrorActionPreference='Continue'
$Root=Split-Path -Parent $PSScriptRoot
Write-Host '=== CCTV Monitor P0.9 Qualification ===' -ForegroundColor Cyan
function Result($ok,[string]$text){ if($ok){Write-Host "[PASS] $text" -ForegroundColor Green}else{Write-Host "[FAIL] $text" -ForegroundColor Red} }
try { $h=Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 3; Result ([bool]$h.ok) 'Local application health endpoint' } catch { Result $false "Local application health endpoint: $($_.Exception.Message)" }
$listener=Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; Result ([bool]$listener) "TCP $Port listener"
$mtx=Get-NetTCPConnection -LocalPort 9997 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; Result ([bool]$mtx) 'MediaMTX loopback Control API listener'
$ff=Get-Process ffmpeg -ErrorAction SilentlyContinue; Write-Host "[INFO] FFmpeg process count: $(@($ff).Count)"
$ts=Get-Command tailscale.exe -ErrorAction SilentlyContinue
if($ts){
  try { $status=& $ts.Source status --json | ConvertFrom-Json; Result ($status.BackendState -eq 'Running') 'Tailscale connected'; Write-Host "[INFO] Tailscale IPs: $($status.TailscaleIPs -join ', ')" } catch { Result $false 'Tailscale status' }
  try { $serve=& $ts.Source serve status; $serveOk=($serve -match 'https://' -or $serve -match 'proxy'); Result $serveOk 'Tailscale Serve configured'; if($serve){$serve | ForEach-Object {Write-Host "       $_"}} } catch { Result $false 'Tailscale Serve status' }
} else { Result $false 'Tailscale CLI available' }
$task=Get-ScheduledTask -TaskName 'CCTV Monitor P0.9' -ErrorAction SilentlyContinue
if($task){Write-Host "[INFO] Autostart task installed: $($task.State)"}else{Write-Host '[INFO] Autostart task is not installed yet.'}
Write-Host ''
Write-Host 'Manual release gates still required:' -ForegroundColor Yellow
Write-Host '  [ ] Tablet remote HTTPS login + live HLS'
Write-Host '  [ ] Webcam unplug/replug recovery'
Write-Host '  [ ] FFmpeg kill/recovery'
Write-Host '  [ ] 2-4 simultaneous viewers with one FFmpeg publisher'
Write-Host '  [ ] Windows reboot and automatic recovery'
Write-Host '  [ ] 8-24 hour unattended soak test'
