$ErrorActionPreference='Stop'
$names=@('CCTV Monitor','CCTV Monitor P0.9')
$removed=$false
foreach($TaskName in $names){ if(Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue){ Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; Write-Host "[OK] Removed $TaskName" -ForegroundColor Green; $removed=$true } }
if(-not $removed){ Write-Host '[INFO] Autostart task is not installed.' }
