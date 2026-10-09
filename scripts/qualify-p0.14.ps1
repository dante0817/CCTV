param([int]$Port=3000)
$ErrorActionPreference='Continue'
$Root=Split-Path -Parent $PSScriptRoot
Write-Host '=== CCTV Monitor P0.14 Motion Detection & Event-Linked Recording Qualification ===' -ForegroundColor Cyan
function Result($ok,[string]$text){ if($ok){Write-Host "[PASS] $text" -ForegroundColor Green}else{Write-Host "[FAIL] $text" -ForegroundColor Red} }
$pkg=Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
Result ($pkg.version -eq '0.2.0-p0.14-pw8') "Package version is P0.14 PW8 ($($pkg.version))"
$baseline=Join-Path $Root 'BASELINE-P0.14.sha256'; $baselineOk=Test-Path $baseline
if($baselineOk){ foreach($line in Get-Content $baseline){ if($line -match '^([0-9a-fA-F]{64})\s+(.+)$'){ $expected=$matches[1].ToLower(); $rel=$matches[2].Trim().TrimStart('*').Replace('/','\'); $target=Join-Path $Root $rel; if(!(Test-Path $target) -or (Get-FileHash $target -Algorithm SHA256).Hash.ToLower() -ne $expected){$baselineOk=$false} } } }
Result $baselineOk 'Protected USB/WebRTC live-media core unchanged'
try { $h=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3; Result ($h.status -eq 'ok' -and $h.version -eq '0.14') 'P0.14 liveness endpoint' } catch { Result $false "Liveness endpoint: $($_.Exception.Message)" }
Write-Host ''
Write-Host 'Manual qualification gates:' -ForegroundColor Yellow
Write-Host '  [ ] Existing USB live WebRTC/HLS still works'
Write-Host '  [ ] P0.13.1 continuous recording, playback, protection, deletion and retention still work'
Write-Host '  [ ] Camera > Motion Detection is OFF by default'
Write-Host '  [ ] Enable motion on one USB camera; analyzer becomes Active after live stream is ready'
Write-Host '  [ ] Set sensitivity around 80-90%; normal static scene does not continuously fire'
Write-Host '  [ ] Walk/move clearly in view: one MOTION_DETECTED event appears'
Write-Host '  [ ] Continue moving during cooldown: duplicate events are suppressed'
Write-Host '  [ ] After cooldown expires, new movement can create a new motion event'
Write-Host '  [ ] With Continuous Recording armed, Find footage shows overlapping finalized MP4 segment(s)'
Write-Host '  [ ] Event-linked Play opens authenticated recording media and supports seek'
Write-Host '  [ ] With recording disabled, motion event still appears but correctly reports no linked footage'
Write-Host '  [ ] Change sensitivity/cooldown/link-window settings; values survive application restart'
Write-Host '  [ ] USB unplug: motion analyzer stops without restart storm; camera outage event remains correct'
Write-Host '  [ ] USB reconnect: live camera recovers, motion analyzer resumes automatically'
Write-Host '  [ ] Ctrl+C leaves no orphan motion FFmpeg analyzer'
Write-Host '  [ ] Diagnostics shows Motion Detection state/PID/settings'
Write-Host ''
Write-Host 'P0.14 scope limits: scene-change motion only; no person/vehicle classification, zones, snapshots, push notifications, RTSP/Tenda motion qualification, audio or PTZ.' -ForegroundColor Yellow
