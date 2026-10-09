param([int]$Port=3000)
$ErrorActionPreference='Continue'
$Root=Split-Path -Parent $PSScriptRoot
Write-Host '=== CCTV Monitor P0.14.2 Notifications & Motion Alert Rules Qualification ===' -ForegroundColor Cyan
function Result($ok,[string]$text){ if($ok){Write-Host "[PASS] $text" -ForegroundColor Green}else{Write-Host "[FAIL] $text" -ForegroundColor Red} }
$pkg=Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
Result ($pkg.version -eq '0.2.0-p0.14.2-pw8') "Package version is P0.14.2 PW8 ($($pkg.version))"
$baseline=Join-Path $Root 'BASELINE-P0.14.2.sha256'; $baselineOk=Test-Path $baseline
if($baselineOk){ foreach($line in Get-Content $baseline){ if($line -match '^([0-9a-fA-F]{64})\s+(.+)$'){ $expected=$matches[1].ToLower(); $rel=$matches[2].Trim().TrimStart('*').Replace('/','\'); $target=Join-Path $Root $rel; if(!(Test-Path $target) -or (Get-FileHash $target -Algorithm SHA256).Hash.ToLower() -ne $expected){$baselineOk=$false} } } }
Result $baselineOk 'Protected USB/WebRTC live-media core unchanged'
try { $h=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3; Result ($h.status -eq 'ok' -and $h.version -eq '0.14.2') 'P0.14.2 liveness endpoint' } catch { Result $false "Liveness endpoint: $($_.Exception.Message)" }
Write-Host ''
Write-Host 'Manual qualification gates:' -ForegroundColor Yellow
Write-Host '  [ ] Existing USB live view, recording, retention, motion zones, snapshots and review still work'
Write-Host '  [ ] Notifications page shows seeded Critical system alerts + Camera offline alerts enabled'
Write-Host '  [ ] Seeded Motion alerts rule is disabled by default'
Write-Host '  [ ] Unplug USB camera: one CAMERA_OFFLINE Operational Event and one notification appear'
Write-Host '  [ ] Repeated supervisor cycles do not create duplicate notification for same event/rule'
Write-Host '  [ ] Mark notification read; refresh/restart: read state persists'
Write-Host '  [ ] Mark all notifications read works'
Write-Host '  [ ] Enable browser desktop permission from localhost or HTTPS/Tailscale Serve'
Write-Host '  [ ] Trigger new Camera Offline alert: desktop popup appears when rule allows it'
Write-Host '  [ ] Create Motion rule for one camera and one zone, enable it, walk through that zone'
Write-Host '  [ ] Motion alert inbox row records camera and zone name'
Write-Host '  [ ] Cooldown suppresses repeated alerts while Operational Events may continue according to detector cooldown'
Write-Host '  [ ] Disable a rule: later matching events no longer create notifications'
Write-Host '  [ ] Delete a motion zone: zone-specific rule remains valid with zone filter cleared'
Write-Host '  [ ] Restart app: rules, unread inbox and read state persist'
Write-Host ''
Write-Host 'P0.14.2 scope limits: local in-app inbox + browser desktop popups only. SMTP/email, SMS, mobile push, generic webhooks, AI person/vehicle recognition, RTSP/Tenda motion qualification, PTZ, audio and two-way intercom remain deferred.' -ForegroundColor Yellow
