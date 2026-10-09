param([int]$Port=3000)
$ErrorActionPreference='Continue'
$Root=Split-Path -Parent $PSScriptRoot
Write-Host '=== CCTV Monitor P0.11.2 Operational Events Qualification ===' -ForegroundColor Cyan
function Result($ok,[string]$text){ if($ok){Write-Host "[PASS] $text" -ForegroundColor Green}else{Write-Host "[FAIL] $text" -ForegroundColor Red} }
function Info([string]$text){ Write-Host "[INFO] $text" -ForegroundColor DarkGray }
function Warn([string]$text){ Write-Host "[WARN] $text" -ForegroundColor Yellow }

$pkg = Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
Result ($pkg.version -eq '0.2.0-p0.11.2') "Package version is P0.11.2 ($($pkg.version))"
$baselineFile=Join-Path $Root 'BASELINE-P0.11.2.sha256'
if(Test-Path $baselineFile){
  $baselineOk=$true
  foreach($line in Get-Content $baselineFile){
    if($line -match '^([0-9a-fA-F]{64})\s+(.+)$'){
      $expected=$matches[1].ToLower(); $rel=$matches[2].Trim().TrimStart('*').Replace('/','\'); $target=Join-Path $Root $rel
      if(!(Test-Path $target) -or (Get-FileHash $target -Algorithm SHA256).Hash.ToLower() -ne $expected){ $baselineOk=$false; Write-Host "[FAIL] Protected baseline: $rel" -ForegroundColor Red }
    }
  }
  if($baselineOk){ Result $true 'Protected USB/WebRTC media core unchanged' }
}else{ Result $false 'P0.11.2 baseline hash manifest present' }

try {
  $h=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
  Result ($h.status -eq 'ok' -and $h.version -eq '0.11.2') 'P0.11.2 liveness endpoint'
} catch { Result $false "Liveness endpoint: $($_.Exception.Message)" }

$listener=Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
Result ([bool]$listener) "TCP $Port listener"
$mtx=Get-NetTCPConnection -LocalPort 9997 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
Result ([bool]$mtx) 'MediaMTX Control API listener'

Write-Host ''
Write-Host 'Run these automated gates first:' -ForegroundColor Yellow
Write-Host '  npm run check'
Write-Host '  npm run test'
Write-Host '  npm run build'
Write-Host ''
Write-Host 'P0.11.2 real-hardware/event gates:' -ForegroundColor Yellow
Write-Host '  [ ] USB live view remains working through WebRTC/HLS fallback'
Write-Host '  [ ] Events contains one SYSTEM_STARTED for this server start'
Write-Host '  [ ] First successful camera start creates CAMERA_ONLINE'
Write-Host '  [ ] Unplug USB: exactly one CAMERA_OFFLINE is created (not one per supervisor poll)'
Write-Host '  [ ] Keep USB unplugged for at least 45 seconds: no duplicate CAMERA_OFFLINE flood'
Write-Host '  [ ] Replug USB: camera recovers and exactly one CAMERA_RECOVERED is created'
Write-Host '  [ ] Acknowledging an event persists after browser refresh'
Write-Host '  [ ] Restart CCTV Monitor: prior operational events remain in the Events screen'
Write-Host '  [ ] Audit still contains user/security actions separately from Operational Events'
Write-Host '  [ ] Dashboard Recent Operational Events matches the Events screen'
Write-Host '  [ ] Header alert dot appears only for unacknowledged warning/critical events'
Write-Host '  [ ] MediaMTX outage/recovery creates one outage and one recovery event'
Write-Host '  [ ] Ctrl+C still leaves no orphan owned ffmpeg.exe/mediamtx.exe processes'
Write-Host ''
Write-Host 'Recording/NVR remains intentionally deferred.' -ForegroundColor Yellow
