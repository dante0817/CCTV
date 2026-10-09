param([int]$Port=3000)
$ErrorActionPreference='Continue'
$Root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
function Result([bool]$ok,[string]$msg){ if($ok){Write-Host "[PASS] $msg" -ForegroundColor Green}else{Write-Host "[FAIL] $msg" -ForegroundColor Red} }
Write-Host '=== CCTV Monitor P0.15 Tablet/Phone Viewer Qualification ===' -ForegroundColor Cyan
$pkg=Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
Result ($pkg.version -eq '0.2.0-p0.15-pw8') "Package version is P0.15 PW8 ($($pkg.version))"
Result (Test-Path (Join-Path $Root 'BASELINE-P0.15.sha256')) 'P0.15 protected baseline manifest exists'
try { $h=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3; Result ($h.status -eq 'ok' -and $h.version -eq '0.15') 'P0.15 liveness endpoint' } catch { Result $false "Liveness endpoint: $($_.Exception.Message)" }
Write-Host ''
Write-Host 'Manual phone/tablet checks:' -ForegroundColor Yellow
Write-Host '  1. Open the LAN or Tailscale/MagicDNS CCTV URL on a phone.'
Write-Host '  2. Confirm the desktop sidebar is replaced by bottom navigation.'
Write-Host '  3. Viewer: confirm Live, Cameras, Clips (when allowed), and Account are reachable.'
Write-Host '  4. Live View: confirm only one focused camera is shown on a phone.'
Write-Host '  5. Swipe left/right and use arrow buttons to switch cameras.'
Write-Host '  6. Use the quick camera chips and verify status dots update.'
Write-Host '  7. Test mute, snapshot, fullscreen, recorded clips, and alert popover using touch.'
Write-Host '  8. Rotate phone portrait/landscape; verify video and controls remain usable.'
Write-Host '  9. Confirm Local/LAN/Tailscale context and network-quality badge are sensible.'
Write-Host ' 10. With Wi-Fi off on the phone, connect by Tailscale/mobile data and verify playback.'
Write-Host ' 11. Force WebRTC failure only if safe to do so and verify HLS fallback remains readable.'
Write-Host ' 12. Tablet: confirm two-column live layout and usable Admin navigation.'
Write-Host ' 13. Confirm no controls are hidden behind iPhone/Android safe areas or browser chrome.'
Write-Host ''
Write-Host 'P0.15 scope limit: no service worker/offline caching is added, intentionally, so live CCTV and authenticated data are not stale-cached on remote devices.' -ForegroundColor Yellow
