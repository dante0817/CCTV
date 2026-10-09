$Root=Split-Path -Parent $PSScriptRoot
$port=3000
try { $envLine=Get-Content (Join-Path $Root '.env') -ErrorAction Stop | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -Last 1; if($envLine){$port=[int](($envLine -split '=',2)[1].Trim())} } catch {}
Write-Host '=== CCTV Monitor P0.10 Status ===' -ForegroundColor Cyan
try { $h=Invoke-RestMethod "http://127.0.0.1:$port/api/v1/health" -TimeoutSec 2; if($h.ok){Write-Host "[OK] App responds on port $port" -ForegroundColor Green} } catch { Write-Host "[FAIL] App is not responding on port $port" -ForegroundColor Red }
$task=Get-ScheduledTask -TaskName 'CCTV Monitor' -ErrorAction SilentlyContinue
if(-not $task){ $task=Get-ScheduledTask -TaskName 'CCTV Monitor P0.9' -ErrorAction SilentlyContinue }
if($task){Write-Host "[OK] Autostart task: $($task.State)" -ForegroundColor Green}else{Write-Host '[INFO] Autostart task not installed.' -ForegroundColor Yellow}
$ts=Get-Command tailscale.exe -ErrorAction SilentlyContinue
if($ts){ & $ts.Source status; Write-Host ''; & $ts.Source serve status } else { Write-Host '[WARN] Tailscale CLI not in PATH.' -ForegroundColor Yellow }
