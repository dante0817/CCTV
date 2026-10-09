$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $PSScriptRoot
Set-Location $Root
$logDir=Join-Path $Root 'logs'; New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdout=Join-Path $logDir 'autostart.log'
$nodeFile=Join-Path $Root '.cctv-cache\node-path.txt'
$node=if(Test-Path $nodeFile){(Get-Content $nodeFile -Raw).Trim()}else{(Get-Command node.exe -ErrorAction Stop).Source}
if(-not (Test-Path $node)){ throw "Configured Node.js executable is unavailable: $node" }
$entry=Join-Path $Root 'scripts\start-production.mjs'
$env:NODE_ENV='production'; $env:CCTV_ROOT_DIR=$Root
"$(Get-Date -Format o) starting CCTV production task" | Add-Content $stdout
& $node $entry *>> $stdout
$code=$LASTEXITCODE
"$(Get-Date -Format o) CCTV production task exited with code $code" | Add-Content $stdout
exit $code
