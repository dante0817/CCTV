param([int]$Port=3000)
$ErrorActionPreference='Continue'
$Root=Split-Path -Parent $PSScriptRoot
Write-Host '=== CCTV Monitor P0.13.1 Recording Management & Safe Retention Qualification ===' -ForegroundColor Cyan
function Result($ok,[string]$text){ if($ok){Write-Host "[PASS] $text" -ForegroundColor Green}else{Write-Host "[FAIL] $text" -ForegroundColor Red} }
$pkg=Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
Result ($pkg.version -eq '0.2.0-p0.13.1-pw8') "Package version is P0.13.1 PW8 ($($pkg.version))"
$baseline=Join-Path $Root 'BASELINE-P0.13.1.sha256'; $baselineOk=Test-Path $baseline
if($baselineOk){ foreach($line in Get-Content $baseline){ if($line -match '^([0-9a-fA-F]{64})\s+(.+)$'){ $expected=$matches[1].ToLower(); $rel=$matches[2].Trim().TrimStart('*').Replace('/','\'); $target=Join-Path $Root $rel; if(!(Test-Path $target) -or (Get-FileHash $target -Algorithm SHA256).Hash.ToLower() -ne $expected){$baselineOk=$false} } } }
Result $baselineOk 'Protected USB/WebRTC live-media core unchanged'
try { $h=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3; Result ($h.status -eq 'ok' -and $h.version -eq '0.13.1') 'P0.13.1 liveness endpoint' } catch { Result $false "Liveness endpoint: $($_.Exception.Message)" }
Write-Host ''
Write-Host 'Manual qualification gates:' -ForegroundColor Yellow
Write-Host '  [ ] Existing USB live WebRTC/HLS and P0.13 continuous recording still work'
Write-Host '  [ ] Protect a finalized segment: lock icon appears; playback/download still work'
Write-Host '  [ ] Protected segment cannot be deleted individually or by bulk delete'
Write-Host '  [ ] Unlock the segment, delete it, refresh: file and index entry are both gone'
Write-Host '  [ ] Bulk-select unlocked segments: only selected unlocked segments are deleted'
Write-Host '  [ ] Reconcile marks manually removed indexed files as missing'
Write-Host '  [ ] Reconcile reports zero-byte/invalid-MP4 leftovers as corrupt/quarantined'
Write-Host '  [ ] Retention is DISABLED by default after migration'
Write-Host '  [ ] Configure age/storage/free-space thresholds and save with retention disabled: nothing auto-deletes'
Write-Host '  [ ] Enable retention; protect one old segment; Run retention now'
Write-Host '  [ ] Oldest eligible unlocked finalized segments are deleted until thresholds are satisfied'
Write-Host '  [ ] Protected footage survives retention'
Write-Host '  [ ] Active newest segment survives retention and is not indexed until finalized'
Write-Host '  [ ] Quarantined/unknown files survive retention'
Write-Host '  [ ] Camera deletion remains blocked while any recording files still exist'
Write-Host '  [ ] Storage page reports retention availability and protected/quarantined counts'
Write-Host '  [ ] Restart app: retention policy, protection flags and remaining recordings persist'
Write-Host '  [ ] Viewer can play permitted recordings but cannot manage retention/delete/protection'
Write-Host ''
Write-Host 'P0.13.1 scope limits: no motion detection, event-triggered recording, clip export, RTSP/Tenda recording, audio or PTZ.' -ForegroundColor Yellow
