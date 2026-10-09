param([int]$Port=3000)
$ErrorActionPreference='Continue'
$Root=Split-Path -Parent $PSScriptRoot
Write-Host '=== CCTV Monitor P0.14.3 Queued Email Delivery Qualification ===' -ForegroundColor Cyan
function Result($ok,[string]$text){ if($ok){Write-Host "[PASS] $text" -ForegroundColor Green}else{Write-Host "[FAIL] $text" -ForegroundColor Red} }
$pkg=Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
Result ($pkg.version -eq '0.2.0-p0.14.3-pw8') "Package version is P0.14.3 PW8 ($($pkg.version))"
$baseline=Join-Path $Root 'BASELINE-P0.14.3.sha256'; $baselineOk=Test-Path $baseline
if($baselineOk){ foreach($line in Get-Content $baseline){ if($line -match '^([0-9a-fA-F]{64})\s+(.+)$'){ $expected=$matches[1].ToLower(); $rel=$matches[2].Trim().TrimStart('*').Replace('/','\'); $target=Join-Path $Root $rel; if(!(Test-Path $target) -or (Get-FileHash $target -Algorithm SHA256).Hash.ToLower() -ne $expected){$baselineOk=$false} } } }
Result $baselineOk 'Protected USB/WebRTC live-media core unchanged'
try { $h=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3; Result ($h.status -eq 'ok' -and $h.version -eq '0.14.3') 'P0.14.3 liveness endpoint' } catch { Result $false "Liveness endpoint: $($_.Exception.Message)" }
Write-Host ''
Write-Host 'Manual qualification gates:' -ForegroundColor Yellow
Write-Host '  [ ] Existing USB live view, recording, retention, motion, zones/snapshots/review and local notifications still work'
Write-Host '  [ ] Notifications > Email delivery starts disabled on a fresh database'
Write-Host '  [ ] Configure SMTP host/port/TLS mode/user/password/from/recipient; Save succeeds without returning the password'
Write-Host '  [ ] Send test succeeds and the recipient receives the test message'
Write-Host '  [ ] Enable Email on Camera Offline rule, unplug USB camera, and verify local notification appears immediately'
Write-Host '  [ ] Email delivery row appears independently of camera/runtime processing'
Write-Host '  [ ] Successful delivery becomes SENT with sent time and attempts count'
Write-Host '  [ ] Temporarily break SMTP credentials or network; new email becomes RETRYING without blocking live video'
Write-Host '  [ ] Restore SMTP; queued retry eventually becomes SENT'
Write-Host '  [ ] Stop/restart app while a row is SENDING; startup recovers it as retryable rather than losing it'
Write-Host '  [ ] Five failed attempts become FAILED and manual Retry resets the row'
Write-Host '  [ ] Audit contains SMTP setting/test/rule actions but no SMTP password'
Write-Host '  [ ] If CCTV base URL is configured, received email includes the link'
Write-Host ''
Write-Host 'Use STARTTLS/TLS with a trusted provider for real deployment. Plain SMTP should be limited to a trusted/test network.' -ForegroundColor Yellow
Write-Host 'P0.14.3 scope limits: SMS, mobile/cloud push, generic webhooks, AI person/vehicle recognition, RTSP/Tenda motion qualification, PTZ, audio and two-way intercom remain deferred.' -ForegroundColor Yellow
