param(
    [int]$Port = 3000,
    [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'SilentlyContinue'
$health = "http://127.0.0.1:$Port/api/v1/health"
$frontend = "http://127.0.0.1:$Port/"
$url = "http://localhost:$Port"
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)

while ((Get-Date) -lt $deadline) {
    try {
        $response = Invoke-RestMethod -Uri $health -TimeoutSec 2
        if ($response.ok) {
            $page = Invoke-WebRequest -UseBasicParsing -Uri $frontend -TimeoutSec 3
            if ($page.StatusCode -eq 200 -and $page.Content -match 'CCTV Monitor - Local CCTV Monitoring' -and $page.Content -match 'id="root"') {
                Start-Process $url
                exit 0
            }
        }
    } catch {}
    Start-Sleep -Milliseconds 500
}
exit 1
