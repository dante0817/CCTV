param([int]$Port=3000)
$ErrorActionPreference='Continue'
$Root=Split-Path -Parent $PSScriptRoot
Write-Host '=== CCTV Monitor P0.14.1 Motion Snapshots, Zones & Event Review Qualification ===' -ForegroundColor Cyan
function Result($ok,[string]$text){ if($ok){Write-Host "[PASS] $text" -ForegroundColor Green}else{Write-Host "[FAIL] $text" -ForegroundColor Red} }
$pkg=Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
Result ($pkg.version -eq '0.2.0-p0.14.1-pw8') "Package version is P0.14.1 PW8 ($($pkg.version))"
$baseline=Join-Path $Root 'BASELINE-P0.14.1.sha256'; $baselineOk=Test-Path $baseline
if($baselineOk){ foreach($line in Get-Content $baseline){ if($line -match '^([0-9a-fA-F]{64})\s+(.+)$'){ $expected=$matches[1].ToLower(); $rel=$matches[2].Trim().TrimStart('*').Replace('/','\'); $target=Join-Path $Root $rel; if(!(Test-Path $target) -or (Get-FileHash $target -Algorithm SHA256).Hash.ToLower() -ne $expected){$baselineOk=$false} } } }
Result $baselineOk 'Protected USB/WebRTC live-media core unchanged'
try { $h=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3; Result ($h.status -eq 'ok' -and $h.version -eq '0.14.1') 'P0.14.1 liveness endpoint' } catch { Result $false "Liveness endpoint: $($_.Exception.Message)" }
Write-Host ''
Write-Host 'Manual qualification gates:' -ForegroundColor Yellow
Write-Host '  [ ] Existing USB live WebRTC/HLS still works'
Write-Host '  [ ] P0.13.1 continuous recording, playback, protection, deletion and retention still work'
Write-Host '  [ ] P0.14 motion detection still works with no zones configured (whole-frame mode)'
Write-Host '  [ ] Create one rectangular zone; analyzer restarts and only enabled zone(s) are analyzed'
Write-Host '  [ ] Create up to four zones; fifth zone creation is rejected'
Write-Host '  [ ] Disable all configured zones; no zone analyzer remains active until a zone is enabled or zones are deleted'
Write-Host '  [ ] Motion in a configured zone creates MOTION_DETECTED with the saved zone name'
Write-Host '  [ ] Motion event Review panel shows scene score, sensitivity and zone name'
Write-Host '  [ ] A JPEG snapshot appears for a newly detected motion event'
Write-Host '  [ ] Zone snapshot has a visible rectangular highlight around the configured region'
Write-Host '  [ ] Snapshot URL is inaccessible when signed out'
Write-Host '  [ ] Confirm motion, add reviewer note, refresh page: review persists'
Write-Host '  [ ] Mark event Dismissed / false alarm: status and note persist independently of Acknowledge'
Write-Host '  [ ] Continuous Recording armed: linked footage still resolves and plays'
Write-Host '  [ ] Delete a zone after an event: historical event retains its zone name'
Write-Host '  [ ] USB unplug: zone analyzers stop without restart storm; reconnect resumes them'
Write-Host '  [ ] Ctrl+C leaves no orphan motion or snapshot FFmpeg processes'
Write-Host '  [ ] Restart application: zone configuration, reviews, snapshots and events remain usable'
Write-Host ''
Write-Host 'P0.14.1 scope limits: rectangular zones only; no polygon editor, person/vehicle AI, push notifications, RTSP/Tenda motion qualification, PTZ, audio or two-way intercom.' -ForegroundColor Yellow
