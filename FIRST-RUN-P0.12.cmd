@echo off
setlocal
cd /d "%~dp0"
title CCTV Monitor P0.12 - First Run

echo ============================================================
echo CCTV Monitor P0.12 - Complete First Run
echo ============================================================
echo.

where node.exe >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Node.js was not found in PATH.
  echo Install Node.js 22.5 or newer. Node 24.x is supported.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [FAIL] npm was not found in PATH.
  pause
  exit /b 1
)

if not exist ".env" (
  if exist ".env.example" (
    copy /y ".env.example" ".env" >nul
    echo [OK] Created .env from .env.example.
  ) else (
    echo [WARN] .env.example is missing.
  )
)

if not exist "data" mkdir "data"

echo.
echo === Dependencies ===
if exist "package-lock.json" (
  echo Installing exact locked dependencies with npm ci...
  call npm ci --no-audit --no-fund
) else (
  echo package-lock.json is not present yet.
  echo Installing exact package.json versions with npm install...
  call npm install --no-audit --no-fund
)
if errorlevel 1 goto :failed

echo.
echo === TypeScript ===
call npm run check
if errorlevel 1 goto :failed

echo.
echo === Regression tests ===
call npm run test
if errorlevel 1 goto :failed

echo.
echo === Production build ===
call npm run build
if errorlevel 1 goto :failed

echo.
echo === Setup preflight ===
call CHECK-CCTV-SETUP.cmd
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo Validation completed. Starting CCTV Monitor P0.12...
echo ============================================================
echo.
call START-CCTV-MONITOR.cmd
exit /b %errorlevel%

:failed
echo.
echo [FAIL] First-run validation stopped because a command failed.
echo Review the error above. CCTV Monitor was not started.
echo.
pause
exit /b 1
