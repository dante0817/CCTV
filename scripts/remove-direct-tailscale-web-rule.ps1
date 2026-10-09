$ErrorActionPreference='Stop'
$name='CCTV Monitor - Tailscale Web'
$rule=Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
if($rule){ Remove-NetFirewallRule -DisplayName $name; Write-Host "[OK] Removed direct tailnet TCP 3000 rule: $name" -ForegroundColor Green } else { Write-Host '[INFO] Direct tailnet TCP 3000 rule was not present.' }
Write-Host 'Tailscale Serve remains the recommended remote path. Only remove this rule after Serve has passed reboot/recovery tests.' -ForegroundColor Yellow
