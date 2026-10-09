param([int]$Port=3000)
$ErrorActionPreference='Continue'
$Root=Split-Path -Parent $PSScriptRoot
Write-Host '=== CCTV Monitor P0.12 Security / Sessions / Audit Qualification ===' -ForegroundColor Cyan
function Result($ok,[string]$text){ if($ok){Write-Host "[PASS] $text" -ForegroundColor Green}else{Write-Host "[FAIL] $text" -ForegroundColor Red} }
$pkg = Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
Result ($pkg.version -eq '0.2.0-p0.12') "Package version is P0.12 ($($pkg.version))"
$baseline=Join-Path $Root 'BASELINE-P0.12.sha256'; $baselineOk=Test-Path $baseline
if($baselineOk){ foreach($line in Get-Content $baseline){ if($line -match '^([0-9a-fA-F]{64})\s+(.+)$'){ $expected=$matches[1].ToLower(); $rel=$matches[2].Trim().TrimStart('*').Replace('/','\'); $target=Join-Path $Root $rel; if(!(Test-Path $target) -or (Get-FileHash $target -Algorithm SHA256).Hash.ToLower() -ne $expected){$baselineOk=$false} } } }
Result $baselineOk 'Protected USB/WebRTC media core unchanged'
try { $h=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3; Result ($h.status -eq 'ok' -and $h.version -eq '0.12') 'P0.12 liveness endpoint' } catch { Result $false "Liveness endpoint: $($_.Exception.Message)" }
Write-Host ''
Write-Host 'Run automated gates:' -ForegroundColor Yellow
Write-Host '  npm run check'
Write-Host '  npm run test'
Write-Host '  npm run build'
Write-Host ''
Write-Host 'P0.12 manual gates:' -ForegroundColor Yellow
Write-Host '  [ ] Existing Admin/Viewer login still works'
Write-Host '  [ ] USB live view still works through WebRTC/HLS fallback'
Write-Host '  [ ] Sign in same user in two browsers; Account shows both active sessions'
Write-Host '  [ ] Revoke one non-current session; that browser gets 401 / returns to login'
Write-Host '  [ ] Revoked browser cannot obtain a new camera stream token'
Write-Host '  [ ] Restart server; non-revoked session remains authenticated'
Write-Host '  [ ] Change own password; other sessions are revoked and current browser receives a fresh session'
Write-Host '  [ ] Admin disables a user; that user loses API access and new media authorization'
Write-Host '  [ ] Camera ACL removal blocks new media authorization'
Write-Host '  [ ] New Viewer defaults to AI disabled; explicit AI grant enables AI UI/API'
Write-Host '  [ ] Audit shows login/session/user/access actions with no password/token/cookie values'
Write-Host '  [ ] Operational Events remain separate from Audit'
Write-Host '  [ ] Ctrl+C leaves no orphan owned ffmpeg.exe/mediamtx.exe processes'
Write-Host ''
Write-Host 'Known limitation: an already-established WebRTC connection may persist until disconnected.' -ForegroundColor Yellow
