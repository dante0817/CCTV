param([int]$Port=3000)
$ErrorActionPreference='Continue'
$Root=Split-Path -Parent $PSScriptRoot
Write-Host '=== CCTV Monitor P0.13 Continuous USB Recording Qualification ===' -ForegroundColor Cyan
function Result($ok,[string]$text){ if($ok){Write-Host "[PASS] $text" -ForegroundColor Green}else{Write-Host "[FAIL] $text" -ForegroundColor Red} }
$pkg = Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
Result ($pkg.version -eq '0.2.0-p0.13') "Package version is P0.13 ($($pkg.version))"
$baseline=Join-Path $Root 'BASELINE-P0.13.sha256'; $baselineOk=Test-Path $baseline
if($baselineOk){ foreach($line in Get-Content $baseline){ if($line -match '^([0-9a-fA-F]{64})\s+(.+)$'){ $expected=$matches[1].ToLower(); $rel=$matches[2].Trim().TrimStart('*').Replace('/','\'); $target=Join-Path $Root $rel; if(!(Test-Path $target) -or (Get-FileHash $target -Algorithm SHA256).Hash.ToLower() -ne $expected){$baselineOk=$false} } } }
Result $baselineOk 'Protected USB/WebRTC live-media core unchanged'
try { $h=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3; Result ($h.status -eq 'ok' -and $h.version -eq '0.13') 'P0.13 liveness endpoint' } catch { Result $false "Liveness endpoint: $($_.Exception.Message)" }
$recordingsDir = Join-Path $Root 'data\recordings'
if(Test-Path $recordingsDir){ Write-Host "[INFO] Recording root: $recordingsDir" -ForegroundColor DarkGray }
else { Write-Host "[INFO] Recording root will be created after the recording service starts: $recordingsDir" -ForegroundColor DarkGray }
Write-Host ''
Write-Host 'Automated gates:' -ForegroundColor Yellow
Write-Host '  npm run check'
Write-Host '  npm run test'
Write-Host '  npm run build'
Write-Host ''
Write-Host 'P0.13 manual USB recording gates:' -ForegroundColor Yellow
Write-Host '  [ ] Existing Admin/Viewer login, USB live WebRTC and HLS fallback still work'
Write-Host '  [ ] Admin -> Cameras: enable Continuous Recording for the USB camera'
Write-Host '  [ ] Recorder becomes active only after the USB live stream is ONLINE'
Write-Host '  [ ] Wait for at least two segment intervals (default: 60 s each)'
Write-Host '  [ ] data\recordings\<camera-id> contains MP4 segment files'
Write-Host '  [ ] Recordings page lists finalized segments only; newest active file is not advertised'
Write-Host '  [ ] Browser playback opens, seeks, pauses and resumes through authenticated byte ranges'
Write-Host '  [ ] Admin download works and produces the same finalized MP4 file'
Write-Host '  [ ] Stop recording: current segment finalizes and appears in the Recordings page'
Write-Host '  [ ] Restart CCTV Monitor while recording is armed: recording resumes after camera returns ONLINE'
Write-Host '  [ ] Unplug USB while recording: recorder stops safely but recording remains armed'
Write-Host '  [ ] Replug USB: live stream recovers and recorder automatically resumes'
Write-Host '  [ ] Viewer with Recording Access sees only permitted camera recordings'
Write-Host '  [ ] Viewer without Recording Access cannot list/play that camera recordings'
Write-Host '  [ ] Storage shows real recording bytes; no automatic deletion occurs'
Write-Host '  [ ] Camera deletion is blocked while any recording files exist'
Write-Host '  [ ] Ctrl+C stops recorder/live FFmpeg/owned MediaMTX cleanly with no orphan process'
Write-Host ''
Write-Host 'Crash-safety optional gate:' -ForegroundColor Yellow
Write-Host '  [ ] After an abnormal process termination, the newest previously-unindexed MP4 is not automatically advertised as healthy footage'
Write-Host ''
Write-Host 'P0.13 scope limits: USB recording only; no automatic retention/deletion, motion, clip export, RTSP/Tenda recording, audio or PTZ.' -ForegroundColor Yellow
