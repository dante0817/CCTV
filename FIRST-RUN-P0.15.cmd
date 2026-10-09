@echo off
setlocal
cd /d "%~dp0"
title CCTV Monitor P0.15 - First Run
echo ============================================================
echo CCTV Monitor P0.15 - Complete First Run
echo ============================================================
echo.
where node.exe >nul 2>nul
if errorlevel 1 ( echo [FAIL] Node.js was not found in PATH.& pause& exit /b 1 )
where npm.cmd >nul 2>nul
if errorlevel 1 ( echo [FAIL] npm was not found in PATH.& pause& exit /b 1 )
if not exist ".env" if exist ".env.example" copy /y ".env.example" ".env" >nul
if not exist "data" mkdir "data"
echo === Dependencies ===
if exist "package-lock.json" ( call npm ci --no-audit --no-fund ) else ( call npm install --no-audit --no-fund )
if errorlevel 1 goto :failed
echo === TypeScript ===
call npm run check
if errorlevel 1 goto :failed
echo === Regression tests ===
call npm run test
if errorlevel 1 goto :failed
echo === Production build ===
call npm run build
if errorlevel 1 goto :failed
echo === Setup preflight ===
call CHECK-CCTV-SETUP.cmd
if errorlevel 1 goto :failed
echo [PASS] Validation completed. Starting CCTV Monitor P0.15...
call START-CCTV-MONITOR.cmd
exit /b %errorlevel%
:failed
echo [FAIL] First-run validation stopped. Review the error above.
pause
exit /b 1
