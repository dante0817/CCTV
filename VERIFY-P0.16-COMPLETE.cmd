@echo off
setlocal
cd /d "%~dp0"
title CCTV Monitor P0.16 - Verification
echo === CCTV Monitor P0.16 Complete Verification ===
call npm run check
if errorlevel 1 goto :failed
call npm run test
if errorlevel 1 goto :failed
call npm run build
if errorlevel 1 goto :failed
node scripts\install-ai-model.mjs
if errorlevel 1 echo [WARN] Local AI model is not available. Core CCTV verification continues.
call CHECK-CCTV-SETUP.cmd
if errorlevel 1 goto :failed
echo [PASS] P0.16 software verification completed.
echo Run QUALIFY-P0.16.cmd for real USB person/vehicle detection qualification.
pause
exit /b 0
:failed
echo [FAIL] Verification failed. Review the output above.
pause
exit /b 1
