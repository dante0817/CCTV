param([int]$Port=3000)
$ErrorActionPreference='Continue'
Write-Host '=== CCTV Monitor P0.16.1 AI Tuning Qualification ===' -ForegroundColor Cyan
Write-Host '1. Confirm USB live view, Continuous Recording, Motion Detection, Notifications, and phone Viewer still work.'
Write-Host '2. Enable AI on one USB camera using Balanced profile.'
Write-Host '3. Verify Person and Vehicle confidence can be adjusted independently.'
Write-Host '4. Test Low CPU, Balanced, and High Accuracy presets; watch inference ms, samples/min, CPU estimate, RSS, and system memory.'
Write-Host '5. Set Trigger Mode = Only after motion. Keep the scene still: inference samples/min should drop and status should say waiting for motion.'
Write-Host '6. Walk into frame: motion should arm AI and PERSON_DETECTED should appear if confidence passes.'
Write-Host '7. Select one Motion Zone. Trigger motion outside it: AI should remain gated. Trigger inside it: AI may run; accepted boxes must be inside that zone.'
Write-Host '8. Open an AI event and verify labeled bounding boxes. Mark Confirm Person/Vehicle, add a note, then mark a deliberate false positive as False Detection.'
Write-Host '9. Return to Camera AI settings and verify reviewed count / false-positive rate updates.'
Write-Host '10. Click Pause 15m: AI should stop sampling while live/recording/motion continue. Resume and verify sampling returns.'
Write-Host '11. Stress-test for at least 30 minutes. If inference is slower than cadence or system memory is critical, verify temporary backoff appears instead of affecting live view.'
Write-Host '12. Test a Viewer restricted to another camera; the Viewer must not be able to retrieve this camera AI context or snapshot.'
try{$h=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3; if($h.version -eq '0.16.1'){Write-Host "API: $($h.status) version $($h.version)" -ForegroundColor Green}else{Write-Host "API version is $($h.version), expected 0.16.1" -ForegroundColor Yellow}}catch{Write-Host "API unavailable: $($_.Exception.Message)" -ForegroundColor Red}
Write-Host 'P0.16.1 is qualified only after AI tuning does not destabilize live view, recording, motion, or notification delivery.' -ForegroundColor Yellow
