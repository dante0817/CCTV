param([int]$Port=3000)
$ErrorActionPreference='Continue'
$Root=Split-Path -Parent $PSScriptRoot
Write-Host '=== CCTV Monitor P0.11 Qualification ===' -ForegroundColor Cyan
function Result($ok,[string]$text){ if($ok){Write-Host "[PASS] $text" -ForegroundColor Green}else{Write-Host "[FAIL] $text" -ForegroundColor Red} }
function Info([string]$text){ Write-Host "[INFO] $text" -ForegroundColor DarkGray }

$node = Get-Command node.exe -ErrorAction SilentlyContinue
Result ([bool]$node) 'Node.js available'
if($node){ Info "Node $(& node --version)" }
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
Result ([bool]$npm) 'npm available'
if($npm){ Info "npm $(& npm --version)" }
$baselineFile=Join-Path $Root 'BASELINE-P0.11.sha256'
if(Test-Path $baselineFile){
  $baselineOk=$true
  foreach($line in Get-Content $baselineFile){
    if($line -match '^([0-9a-fA-F]{64})\s+(.+)$'){
      $expected=$matches[1].ToLower(); $rel=$matches[2].Trim().TrimStart('*').Replace('/','\'); $target=Join-Path $Root $rel
      if(!(Test-Path $target) -or (Get-FileHash $target -Algorithm SHA256).Hash.ToLower() -ne $expected){ $baselineOk=$false; Write-Host "[FAIL] Protected baseline: $rel" -ForegroundColor Red }
    }
  }
  if($baselineOk){ Result $true 'Protected P0.10 media core unchanged' }
}else{ Result $false 'P0.11 baseline hash manifest present' }

$lock = Test-Path (Join-Path $Root 'package-lock.json')
if($lock){ Result $true 'package-lock.json present (use npm ci)' } else { Write-Host '[WARN] package-lock.json is not present. Dependencies are pinned in package.json; run npm install once on an internet-connected PC and keep the generated lockfile.' -ForegroundColor Yellow }

try {
  $h=Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 3
  Result ([bool]$h.ok) 'Local application health endpoint'
  if($h.version){ Info "App version $($h.version)" }
} catch { Result $false "Local application health endpoint: $($_.Exception.Message)" }

try {
  $info=Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/system/info" -TimeoutSec 3
  Result ([bool]$info.version) 'System information endpoint'
  if($info.database.schemaVersion){ Info "Database schema $($info.database.schemaVersion)" }
} catch { Write-Host "[INFO] System info requires an authenticated Admin session in normal use: $($_.Exception.Message)" -ForegroundColor DarkGray }

$listener=Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
Result ([bool]$listener) "TCP $Port listener"
$mtx=Get-NetTCPConnection -LocalPort 9997 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
Result ([bool]$mtx) 'MediaMTX loopback Control API listener'
$ff=Get-Process ffmpeg -ErrorAction SilentlyContinue
Info "FFmpeg process count: $(@($ff).Count)"

$ts=Get-Command tailscale.exe -ErrorAction SilentlyContinue
if($ts){
  try { $status=& $ts.Source status --json | ConvertFrom-Json; Result ($status.BackendState -eq 'Running') 'Tailscale connected'; Info "Tailscale IPs: $($status.TailscaleIPs -join ', ')" } catch { Result $false 'Tailscale status' }
  try { $serve=& $ts.Source serve status; $serveOk=($serve -match 'https://' -or $serve -match 'proxy'); Result $serveOk 'Tailscale Serve configured'; if($serve){$serve | ForEach-Object {Write-Host "       $_"}} } catch { Result $false 'Tailscale Serve status' }
} else { Write-Host '[INFO] Tailscale CLI not found; skip if this PC is intentionally LAN-only.' -ForegroundColor DarkGray }

Write-Host ''
Write-Host 'Automated source checks (run from this folder):' -ForegroundColor Yellow
Write-Host '  npm run check'
Write-Host '  npm run test'
Write-Host '  npm run build'
Write-Host ''
Write-Host 'P0.11 hardware/release gates:' -ForegroundColor Yellow
Write-Host '  [ ] Existing USB camera still starts and displays through WebRTC'
Write-Host '  [ ] HLS fallback still displays on the tablet/Tailscale path'
Write-Host '  [ ] Add Network Camera > Tenda CP3 Pro > Test Connection succeeds'
Write-Host '  [ ] Tenda CP3 Pro Add & Start persists after server restart'
Write-Host '  [ ] USB + Tenda stream simultaneously without duplicate FFmpeg workers'
Write-Host '  [ ] Tenda power cycle reconnects without restarting the whole server'
Write-Host '  [ ] Router/Wi-Fi interruption recovers automatically'
Write-Host '  [ ] MediaMTX restart recovers camera workers'
Write-Host '  [ ] Viewer sees only assigned cameras and never receives RTSP credentials'
Write-Host '  [ ] Removing Viewer camera access blocks subsequent media authorization'
Write-Host '  [ ] Disabling Viewer blocks subsequent media authorization'
Write-Host '  [ ] 8-24 hour USB + RTSP unattended soak test is stable'
Write-Host ''
Write-Host 'Deferred by design:' -ForegroundColor Yellow
Write-Host '  ONVIF discovery, PTZ controls, audio/intercom, recording/NVR, retention, motion and notifications.'
