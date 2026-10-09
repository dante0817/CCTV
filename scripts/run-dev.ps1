param(
    [switch]$CheckOnly,
    [switch]$NoBrowser,
    [switch]$SkipMediaMtxInstall
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Write-Section([string]$Text) {
    Write-Host ""
    Write-Host "=== $Text ===" -ForegroundColor Cyan
}
function Write-Ok([string]$Text) { Write-Host "[OK]   $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "[WARN] $Text" -ForegroundColor Yellow }
function Write-Fail([string]$Text) { Write-Host "[FAIL] $Text" -ForegroundColor Red }

function Read-DotEnvValue([string]$Name) {
    $envFile = Join-Path $Root '.env'
    if (-not (Test-Path $envFile)) { return $null }
    foreach ($line in Get-Content $envFile) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $match = [regex]::Match($trimmed, "^$([regex]::Escape($Name))\s*=\s*(.*)$")
        if ($match.Success) { return $match.Groups[1].Value.Trim().Trim('"').Trim("'") }
    }
    return $null
}

function Resolve-Ffmpeg {
    $configured = $env:FFMPEG_PATH
    if (-not $configured) { $configured = Read-DotEnvValue 'FFMPEG_PATH' }
    $candidates = @()
    if ($configured) { $candidates += $configured }
    $command = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    if ($command) { $candidates += $command.Source }
    $candidates += 'C:\ffmpeg\bin\ffmpeg.exe'
    $candidates += 'C:\Program Files\ffmpeg\bin\ffmpeg.exe'

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not $candidate) { continue }
        if ((Test-Path $candidate) -or ($candidate -eq 'ffmpeg.exe')) {
            try {
                & $candidate -version *> $null
                if ($LASTEXITCODE -eq 0) { return $candidate }
            } catch {}
        }
    }
    return $null
}

function Test-CctvServer([int]$Port) {
    try {
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
        return [bool]$status.ok
    } catch { return $false }
}

function Test-CctvFrontend([int]$Port) {
    try {
        $page = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 3
        return ($page.StatusCode -eq 200 -and $page.Content -match 'CCTV Monitor - Local CCTV Monitoring' -and $page.Content -match 'id="root"')
    } catch { return $false }
}

Write-Host "CCTV Monitor Windows launcher" -ForegroundColor White
Write-Host "Project: $Root" -ForegroundColor DarkGray

Write-Section 'Environment'
if (-not (Test-Path '.env')) {
    if (Test-Path '.env.example') {
        Copy-Item '.env.example' '.env'
        Write-Ok 'Created .env from .env.example.'
    } else {
        Write-Warn '.env and .env.example are both missing.'
    }
} else {
    Write-Ok '.env found.'
}

$portText = Read-DotEnvValue 'PORT'
$Port = 3000
if ($portText -and [int]::TryParse($portText, [ref]$Port)) { }
Write-Ok "HTTP port: $Port"
if ($Port -in @(8554, 8888, 8889, 9997)) {
    Write-Fail "PORT=$Port conflicts with a MediaMTX service port."
    throw 'Use PORT=3000 (recommended) or another free HTTP port that is not 8554, 8888, 8889, or 9997.'
}

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Write-Fail 'Node.js was not found in PATH.'; throw 'Install Node.js 22.5 or newer before starting CCTV Monitor.' }
if (-not $npmCmd) { Write-Fail 'npm was not found in PATH.'; throw 'npm is required to install/start CCTV Monitor.' }

$nodeVersion = (& $nodeCmd.Source -p "process.versions.node").Trim()
$parts = $nodeVersion.Split('.')
$nodeOk = ([int]$parts[0] -gt 22) -or (([int]$parts[0] -eq 22) -and ([int]$parts[1] -ge 5))
if (-not $nodeOk) { Write-Fail "Node $nodeVersion is too old."; throw 'CCTV Monitor uses node:sqlite and requires Node.js 22.5 or newer.' }
Write-Ok "Node.js $nodeVersion"
$npmVersion = (& $npmCmd.Source --version).Trim()
Write-Ok "npm $npmVersion"

Write-Section 'Dependencies'
$cacheDir = Join-Path $Root '.cctv-cache'
$depsStamp = Join-Path $cacheDir 'package.sha256'
$packageHash = (Get-FileHash (Join-Path $Root 'package.json') -Algorithm SHA256).Hash
$installedHash = if (Test-Path $depsStamp) { (Get-Content $depsStamp -Raw).Trim() } else { '' }
$dependenciesNeedInstall = (-not (Test-Path 'node_modules\vite\package.json')) -or ($installedHash -ne $packageHash)

if ($dependenciesNeedInstall) {
    if ($CheckOnly) {
        Write-Warn 'Node dependencies are missing or need refresh. The launcher will use npm ci when package-lock.json exists, otherwise npm install.'
    } else {
        $hasLock = Test-Path (Join-Path $Root 'package-lock.json')
        if ($hasLock) {
            Write-Host 'Installing exact locked Node dependencies with npm ci...'
            & $npmCmd.Source ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'npm ci failed. Review the npm error above.' }
        } else {
            Write-Warn 'package-lock.json is missing; using exact package.json pins with npm install. Keep the generated lockfile for future npm ci installs.'
            & $npmCmd.Source install --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'npm install failed. Review the npm error above.' }
        }
        New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
        Set-Content -Path $depsStamp -Value $packageHash -NoNewline
        Write-Ok 'Node dependencies are synchronized with package.json.'
    }
} else {
    Write-Ok 'Node dependencies match package.json.'
}

Write-Section 'FFmpeg'
$ffmpeg = Resolve-Ffmpeg
if ($ffmpeg) {
    Write-Ok "FFmpeg detected: $ffmpeg"
} else {
    Write-Warn 'FFmpeg was not found. The GUI can run, but USB camera discovery/streaming will not work.'
    Write-Host '       Install FFmpeg, then set FFMPEG_PATH in .env if it is not in PATH.' -ForegroundColor DarkYellow
}

Write-Section 'MediaMTX'
$mediaMtxExe = Join-Path $Root 'tools\mediamtx\mediamtx.exe'
if (-not (Test-Path $mediaMtxExe)) {
    if ($CheckOnly) {
        Write-Warn 'MediaMTX is not installed in tools\mediamtx.'
    } elseif ($SkipMediaMtxInstall) {
        Write-Warn 'MediaMTX is missing and automatic setup was skipped.'
    } else {
        Write-Host 'MediaMTX is missing. Running the included setup script...'
        try {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\setup-mediamtx.ps1')
            if ($LASTEXITCODE -ne 0) { throw "MediaMTX setup exited with code $LASTEXITCODE." }
            if (-not (Test-Path $mediaMtxExe)) { throw 'MediaMTX setup completed but mediamtx.exe is still missing.' }
            Write-Ok 'MediaMTX installed.'
        } catch {
            Write-Warn "MediaMTX automatic setup failed: $($_.Exception.Message)"
            Write-Host '       You can rerun scripts\setup-mediamtx.ps1 when Internet access is available.' -ForegroundColor DarkYellow
        }
    }
} else {
    Write-Ok "MediaMTX binary found: $mediaMtxExe"
}

if ($CheckOnly) {
    Write-Section 'Port check'
    if (Test-CctvServer $Port) {
        Write-Ok "CCTV Monitor API is responding at http://localhost:$Port"
        if (Test-CctvFrontend $Port) {
            Write-Ok 'CCTV frontend root is serving the application HTML.'
        } else {
            Write-Warn 'CCTV API is healthy, but the frontend root is not serving the application HTML.'
        }
    } else {
        $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listener) {
            $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
            $procSuffix = if ($proc) { " ($($proc.ProcessName))" } else { '' }
            Write-Warn "Port $Port is already used by PID $($listener.OwningProcess)$procSuffix."
        } else {
            Write-Ok "Port $Port is free."
        }
    }
    Write-Host ""
    Write-Host 'Preflight check complete.' -ForegroundColor Cyan
    exit 0
}

Write-Section 'Server'
if (Test-CctvServer $Port) {
    if (-not (Test-CctvFrontend $Port)) {
        Write-Fail "CCTV Monitor API is responding on port $Port, but the frontend root returns an invalid page/404."
        throw 'Stop the stale CCTV Monitor process and start this updated build again.'
    }
    Write-Ok "CCTV Monitor is already running at http://localhost:$Port"
    if (-not $NoBrowser) { Start-Process "http://localhost:$Port" }
    exit 0
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    $name = if ($proc) { $proc.ProcessName } else { 'unknown process' }
    Write-Fail "Port $Port is already occupied by PID $($listener.OwningProcess) ($name)."
    throw "Close that process or change PORT in .env before starting CCTV Monitor."
}

if (-not $NoBrowser) {
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        (Join-Path $Root 'scripts\open-browser-when-ready.ps1'),
        '-Port', "$Port"
    ) | Out-Null
}

# Force development mode for this launcher so a machine-level NODE_ENV=production
# cannot make the dev server look for a missing dist/index.html and return 404.
$env:NODE_ENV = 'development'
Write-Host "Starting CCTV Monitor in development mode..." -ForegroundColor White
Write-Host "The browser will use http://localhost:$Port (never http://0.0.0.0:$Port)." -ForegroundColor DarkGray
Write-Host 'Keep this window open. Press Ctrl+C to stop the server cleanly.' -ForegroundColor DarkGray
Write-Host ""

& $npmCmd.Source run dev
$code = $LASTEXITCODE
if ($code -ne 0) { throw "CCTV Monitor exited with code $code." }
