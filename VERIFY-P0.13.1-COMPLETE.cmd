@echo off
setlocal
cd /d "%~dp0"
title CCTV Monitor P0.13.1 - Verification
echo === CCTV Monitor P0.13.1 Complete Verification ===
call npm run check
if errorlevel 1 goto :failed
call npm run test
if errorlevel 1 goto :failed
call npm run build
if errorlevel 1 goto :failed
call CHECK-CCTV-SETUP.cmd
if errorlevel 1 goto :failed
echo [PASS] P0.13.1 software verification completed.
echo Run QUALIFY-P0.13.1.cmd for Windows/browser/recording-retention qualification.
pause
exit /b 0
:failed
echo [FAIL] Verification failed. Review the output above.
pause
exit /b 1
