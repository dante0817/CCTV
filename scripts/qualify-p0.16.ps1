param([int]$Port=3000)
$ErrorActionPreference='Continue'
Write-Host '=== CCTV Monitor P0.16 Local AI Qualification ===' -ForegroundColor Cyan
Write-Host '1. Confirm USB live view and Continuous Recording still work.'
Write-Host '2. Run INSTALL-AI-MODEL-P0.16.cmd if Diagnostics says the model is missing.'
Write-Host '3. Admin > Cameras > select USB camera > enable AI Person / Vehicle Detection.'
Write-Host '4. Start at Confidence 55%, sample every 5 s, cooldown 30 s.'
Write-Host '5. Walk into frame. Verify exactly one PERSON_DETECTED event within cooldown.'
Write-Host '6. Check AI snapshot bounding box and linked recording footage.'
Write-Host '7. Place/move a bicycle, motorcycle, car, bus, or truck in frame where practical and verify VEHICLE_DETECTED.'
Write-Host '8. Verify Notifications can target PERSON_DETECTED and VEHICLE_DETECTED.'
Write-Host '9. Verify no face/name/identity matching exists anywhere in the event details.'
Write-Host '10. Watch CPU/RAM for at least 30 minutes; increase sample interval if CPU is excessive.'
try{$h=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3; Write-Host "API: $($h.status) version $($h.version)" -ForegroundColor Green}catch{Write-Host "API unavailable: $($_.Exception.Message)" -ForegroundColor Red}
Write-Host 'P0.16 is qualified only after live view, recording, motion, and notifications remain stable while AI detection is enabled.' -ForegroundColor Yellow
