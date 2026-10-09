$ErrorActionPreference = 'Stop'
$Version = if ($env:MEDIAMTX_VERSION) { $env:MEDIAMTX_VERSION } else { 'v1.21.1' }
$Root = Split-Path -Parent $PSScriptRoot
$Dest = Join-Path $Root 'tools\mediamtx'
$Exe = Join-Path $Dest 'mediamtx.exe'
$Config = Join-Path $Dest 'mediamtx.yml'
$Zip = Join-Path $env:TEMP "mediamtx-$Version.zip"
$Extract = Join-Path $env:TEMP "mediamtx-$Version-$PID"
$Url = "https://github.com/bluenviron/mediamtx/releases/download/$Version/mediamtx_${Version}_windows_amd64.zip"

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
if (-not (Test-Path $Config)) {
    throw "CCTV MediaMTX configuration is missing: $Config"
}

try {
    if (Test-Path $Extract) { Remove-Item -Recurse -Force $Extract }
    New-Item -ItemType Directory -Force -Path $Extract | Out-Null

    Write-Host "Downloading MediaMTX $Version from the official release..."
    Invoke-WebRequest -Uri $Url -OutFile $Zip
    Expand-Archive -Path $Zip -DestinationPath $Extract -Force

    $downloadedExe = Get-ChildItem -Path $Extract -Filter 'mediamtx.exe' -Recurse | Select-Object -First 1
    if (-not $downloadedExe) { throw 'mediamtx.exe was not found in the downloaded archive.' }

    # Copy only the executable. Do not overwrite the CCTV-specific mediamtx.yml.
    Copy-Item $downloadedExe.FullName $Exe -Force
    if (-not (Test-Path $Exe)) { throw 'mediamtx.exe was not found after installation.' }

    Write-Host "MediaMTX installed at $Exe"
    Write-Host "Preserved CCTV configuration at $Config"
}
finally {
    Remove-Item $Zip -Force -ErrorAction SilentlyContinue
    Remove-Item $Extract -Recurse -Force -ErrorAction SilentlyContinue
}
