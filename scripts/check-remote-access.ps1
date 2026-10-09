param([int]$Port = 3000)
$ErrorActionPreference = 'SilentlyContinue'
Write-Host ''
Write-Host '=== CCTV Monitor Remote Access Check ===' -ForegroundColor Cyan

$healthUrl = "http://127.0.0.1:$Port/api/v1/health"
try {
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
  if ($health.ok) { Write-Host "[OK] CCTV Monitor is running on port $Port." -ForegroundColor Green }
  else { throw 'health returned not-ok' }
} catch {
  Write-Host "[FAIL] CCTV Monitor is not responding at $healthUrl" -ForegroundColor Red
  exit 1
}

$tailscaleCmd = Get-Command tailscale.exe -ErrorAction SilentlyContinue
$tailscalePath = if ($tailscaleCmd) { $tailscaleCmd.Source } else { $null }
if (-not $tailscalePath) {
  $candidate = 'C:\Program Files\Tailscale\tailscale.exe'
  if (Test-Path $candidate) { $tailscalePath = $candidate }
}
if (-not $tailscalePath) {
  Write-Host '[WARN] Tailscale is not installed or not in PATH.' -ForegroundColor Yellow
  Write-Host '       Install Tailscale on this CCTV PC and on each authorized viewer device.' -ForegroundColor DarkYellow
  exit 2
}

try {
  $json = & $tailscalePath status --json | ConvertFrom-Json
  $dnsName = if ($json.Self.DNSName) { $json.Self.DNSName.TrimEnd('.') } else { $null }
  $ips = @($json.TailscaleIPs)
  if (-not $ips -or $ips.Count -eq 0) { $ips = @($json.Self.TailscaleIPs) }
  Write-Host '[OK] Tailscale is installed.' -ForegroundColor Green
  if ($dnsName) { Write-Host "[OK] MagicDNS: $dnsName" -ForegroundColor Green }
  if ($ips.Count -gt 0) { Write-Host "[OK] Tailscale IP: $($ips -join ', ')" -ForegroundColor Green }
  Write-Host ''
  Write-Host 'Remote viewing test:' -ForegroundColor White
  Write-Host '  1. Complete first-admin setup locally at:' -ForegroundColor Gray
  Write-Host "     http://localhost:$Port" -ForegroundColor Cyan
  Write-Host '  2. On the phone, turn Wi-Fi OFF, mobile data ON, and Tailscale ON.' -ForegroundColor Gray
  if ($dnsName) { Write-Host "  3. Open: http://$dnsName`:$Port" -ForegroundColor Cyan }
  elseif ($ips.Count -gt 0) { Write-Host "  3. Open: http://$($ips[0])`:$Port" -ForegroundColor Cyan }
  Write-Host '  4. Sign in and open Live View. WebRTC is tried first; HLS is automatic fallback.' -ForegroundColor Gray
  Write-Host ''
  Write-Host 'Do not configure router port forwarding for ports 3000/8888/8889/8189.' -ForegroundColor Yellow
} catch {
  Write-Host "[WARN] Tailscale status could not be read: $($_.Exception.Message)" -ForegroundColor Yellow
  exit 3
}
