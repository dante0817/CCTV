param(
    [switch]$NoBrowser,
    [switch]$Rebuild
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Section([string]$t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Ok([string]$t) { Write-Host "[OK]   $t" -ForegroundColor Green }
function Warn([string]$t) { Write-Host "[WARN] $t" -ForegroundColor Yellow }
function Read-DotEnvValue([string]$Name) {
    $f = Join-Path $Root '.env'; if (-not (Test-Path $f)) { return $null }
    foreach ($line in Get-Content $f) { $x=$line.Trim(); if (-not $x -or $x.StartsWith('#')) { continue }; $m=[regex]::Match($x,"^$([regex]::Escape($Name))\s*=\s*(.*)$"); if($m.Success){ return $m.Groups[1].Value.Trim().Trim('"').Trim("'") } }
    return $null
}
function Test-Cctv([int]$Port) { try { return [bool](Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2).ok } catch { return $false } }

Write-Host 'CCTV Monitor P0.16 production launcher' -ForegroundColor White
Write-Host "Project: $Root" -ForegroundColor DarkGray
if (-not (Test-Path '.env') -and (Test-Path '.env.example')) { Copy-Item '.env.example' '.env'; Ok 'Created .env from .env.example.' }
$Port=3000; $pt=Read-DotEnvValue 'PORT'; if($pt){ [void][int]::TryParse($pt,[ref]$Port) }

Section 'Prerequisites'
$node = Get-Command node.exe -ErrorAction SilentlyContinue; $npm=Get-Command npm.cmd -ErrorAction SilentlyContinue
if(-not $node -or -not $npm){ throw 'Node.js/npm were not found in PATH.' }
$version=(& $node.Source -p "process.versions.node").Trim(); $vp=$version.Split('.'); if(([int]$vp[0] -lt 22) -or (([int]$vp[0] -eq 22) -and ([int]$vp[1] -lt 5))){ throw "Node.js $version is too old; Node.js 22.5 or newer is required." }; Ok "Node.js $version"
$cacheDir=Join-Path $Root '.cctv-cache'; $stamp=Join-Path $cacheDir 'package.sha256'; $hash=(Get-FileHash (Join-Path $Root 'package.json') -Algorithm SHA256).Hash; $oldHash=if(Test-Path $stamp){(Get-Content $stamp -Raw).Trim()}else{''}
if((-not (Test-Path 'node_modules\vite\package.json')) -or ($hash -ne $oldHash)) {
    if(Test-Path 'package-lock.json'){
        Write-Host 'Installing exact locked Node dependencies with npm ci...'; & $npm.Source ci --no-audit --no-fund; if($LASTEXITCODE -ne 0){throw 'npm ci failed.'}
    } else {
        Warn 'package-lock.json is missing; using exact package.json pins with npm install. Keep the generated lockfile for future npm ci installs.'; & $npm.Source install --no-audit --no-fund; if($LASTEXITCODE -ne 0){throw 'npm install failed.'}
    }
    New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null; Set-Content -Path $stamp -Value $hash -NoNewline; Ok 'Node dependencies synchronized.'
} else { Ok 'Node dependencies match package.json.' }

$media = Join-Path $Root 'tools\mediamtx\mediamtx.exe'
if(-not (Test-Path $media)) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\setup-mediamtx.ps1'); if($LASTEXITCODE -ne 0){ throw 'MediaMTX setup failed.' } }
Ok 'MediaMTX is present.'

Section 'Production build'
$needBuild = $Rebuild -or -not (Test-Path 'dist\index.html') -or -not (Test-Path 'dist-server\server.js')
if($needBuild){
    Write-Host 'Building frontend and production server...'
    & $npm.Source run build
    if($LASTEXITCODE -ne 0){ throw 'Production build failed.' }
    Ok 'Production build completed.'
} else { Ok 'Existing production build found.' }

Section 'Port check'
if(Test-Cctv $Port){
    $existing=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
    if($existing.mode -ne 'production'){ throw "A CCTV Monitor $($existing.mode) instance is already using port $Port. Stop it before starting P0.16 production mode." }
    Ok "CCTV Monitor production runtime is already responding at http://localhost:$Port"; if(-not $NoBrowser){Start-Process "http://localhost:$Port"}; exit 0
}
$listener=Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if($listener){ throw "Port $Port is already occupied by PID $($listener.OwningProcess)." }

if(-not $NoBrowser){ Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $Root 'scripts\open-browser-when-ready.ps1'),'-Port',"$Port") | Out-Null }
$env:NODE_ENV='production'; $env:CCTV_ROOT_DIR=$Root
Section 'Server'
Write-Host "Starting production runtime on http://localhost:$Port" -ForegroundColor White
& $npm.Source run start:prod
if($LASTEXITCODE -ne 0){ throw "CCTV Monitor production runtime exited with code $LASTEXITCODE." }
