param(
  [int]$AppPort = 3000,
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$prefix = 'CCTV Monitor - Tailscale'
$rules = @(
  @{ Name = "$prefix App"; Protocol = 'TCP'; Port = $AppPort },
  @{ Name = "$prefix WebRTC"; Protocol = 'TCP'; Port = 8889 },
  @{ Name = "$prefix WebRTC ICE"; Protocol = 'UDP'; Port = 8189 }
)

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run this script from an elevated (Run as Administrator) PowerShell window.' }

foreach ($rule in $rules) {
  Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  if (-not $Remove) {
    New-NetFirewallRule `
      -DisplayName $rule.Name `
      -Direction Inbound `
      -Action Allow `
      -Protocol $rule.Protocol `
      -LocalPort $rule.Port `
      -RemoteAddress '100.64.0.0/10' `
      -Profile Any `
      -Description 'Allows CCTV Monitor private viewing only from Tailscale IPv4 peers (CGNAT range); does not configure router forwarding.' | Out-Null
    Write-Host "[OK] $($rule.Name): $($rule.Protocol)/$($rule.Port) from 100.64.0.0/10" -ForegroundColor Green
  } else {
    Write-Host "[OK] Removed: $($rule.Name)" -ForegroundColor Green
  }
}

if (-not $Remove) {
  Write-Host ''
  Write-Host 'Firewall rules installed for the Tailscale IPv4 range only.' -ForegroundColor Cyan
  Write-Host 'No router port forwarding was created.' -ForegroundColor Yellow
  Write-Host 'LAN access may still rely on existing Windows firewall rules/prompts for Node.js and MediaMTX.' -ForegroundColor DarkGray
}
