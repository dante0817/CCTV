param([int]$Port=3000)
$ErrorActionPreference='Continue'
$Root=Split-Path -Parent $PSScriptRoot
Write-Host '=== CCTV Monitor P0.11.1 Runtime Observability & Stability Qualification ===' -ForegroundColor Cyan
function Result($ok,[string]$text){ if($ok){Write-Host "[PASS] $text" -ForegroundColor Green}else{Write-Host "[FAIL] $text" -ForegroundColor Red} }
function Info([string]$text){ Write-Host "[INFO] $text" -ForegroundColor DarkGray }
function Warn([string]$text){ Write-Host "[WARN] $text" -ForegroundColor Yellow }

$node = Get-Command node.exe -ErrorAction SilentlyContinue
Result ([bool]$node) 'Node.js available'
if($node){ Info "Node $(& node --version)" }
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
Result ([bool]$npm) 'npm available'
if($npm){ Info "npm $(& npm --version)" }

$pkg = Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
Result ($pkg.version -eq '0.2.0-p0.11.1') "Package version is P0.11.1 ($($pkg.version))"

$baselineFile=Join-Path $Root 'BASELINE-P0.11.1.sha256'
if(Test-Path $baselineFile){
  $baselineOk=$true
  foreach($line in Get-Content $baselineFile){
    if($line -match '^([0-9a-fA-F]{64})\s+(.+)$'){
      $expected=$matches[1].ToLower(); $rel=$matches[2].Trim().TrimStart('*').Replace('/','\'); $target=Join-Path $Root $rel
      if(!(Test-Path $target) -or (Get-FileHash $target -Algorithm SHA256).Hash.ToLower() -ne $expected){ $baselineOk=$false; Write-Host "[FAIL] Protected baseline: $rel" -ForegroundColor Red }
    }
  }
  if($baselineOk){ Result $true 'Protected USB/WebRTC media core unchanged' }
}else{ Result $false 'P0.11.1 baseline hash manifest present' }

$lock = Test-Path (Join-Path $Root 'package-lock.json')
if($lock){ Result $true 'package-lock.json present; npm ci is reproducible' }
else { Warn 'package-lock.json is not present in this archive. On the internet-connected CCTV PC, run npm install once; keep the generated package-lock.json from then on.' }

try {
  $h=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
  Result ($h.status -eq 'ok') 'Minimal public liveness endpoint'
  if($h.version){ Info "App version $($h.version)" }
} catch { Result $false "Minimal liveness endpoint: $($_.Exception.Message)" }

$listener=Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
Result ([bool]$listener) "TCP $Port listener"
$mtx=Get-NetTCPConnection -LocalPort 9997 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
Result ([bool]$mtx) 'MediaMTX loopback Control API listener'
$webrtc=Get-NetTCPConnection -LocalPort 8889 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
Result ([bool]$webrtc) 'MediaMTX WebRTC listener'
$ff=Get-Process ffmpeg -ErrorAction SilentlyContinue
Info "FFmpeg process count: $(@($ff).Count)"

Write-Host ''
Write-Host 'Automated source/release checks (run from this folder):' -ForegroundColor Yellow
Write-Host '  npm run check'
Write-Host '  npm run test'
Write-Host '  npm run build'
Write-Host ''
Write-Host 'P0.11.1 real-hardware gates:' -ForegroundColor Yellow
Write-Host '  [ ] Startup no longer prints repeated MediaMTX "ERR [API] path not found" while the USB camera is starting'
Write-Host '  [ ] Camera progresses CONFIGURED/STARTING -> ONLINE only after MediaMTX reports the stream ready'
Write-Host '  [ ] Dashboard camera/runtime values match actual USB state'
Write-Host '  [ ] Dashboard shows real server uptime and real storage/free-space values'
Write-Host '  [ ] Diagnostics reports FFmpeg, MediaMTX, WebRTC, HLS, SQLite and storage truthfully'
Write-Host '  [ ] Unplug USB: camera becomes DEGRADED/OFFLINE and recovery begins without duplicate FFmpeg workers'
Write-Host '  [ ] Replug USB: camera automatically returns ONLINE'
Write-Host '  [ ] Repeated failures do not create a restart storm; circuit breaker eventually pauses aggressive recovery'
Write-Host '  [ ] FFmpeg alive + MediaMTX path missing is not reported ONLINE'
Write-Host '  [ ] MediaMTX restart recovers the enabled USB camera'
Write-Host '  [ ] Ctrl+C exits cleanly and leaves no orphan ffmpeg.exe/owned mediamtx.exe processes'
Write-Host '  [ ] Restarting CCTV Monitor reconciles stale persisted camera status and starts enabled cameras'
Write-Host '  [ ] Existing Viewer camera ACL and WebRTC/HLS playback remain unchanged'
Write-Host '  [ ] 8-24 hour USB unattended soak test is stable'
Write-Host ''
Write-Host 'Deferred by design:' -ForegroundColor Yellow
Write-Host '  Persistent operational events (P0.11.2), auth/session hardening (P0.12), recording/NVR (P0.13), ONVIF/PTZ/audio.'
