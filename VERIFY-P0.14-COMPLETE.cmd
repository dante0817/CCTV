@echo off
setlocal
cd /d "%~dp0"
title CCTV Monitor P0.14 - Verification
echo === CCTV Monitor P0.14 Complete Verification ===
call npm run check
if errorlevel 1 goto :failed
call npm run test
if errorlevel 1 goto :failed
call npm run build
if errorlevel 1 goto :failed
call CHECK-CCTV-SETUP.cmd
if errorlevel 1 goto :failed
echo [PASS] P0.14 software verification completed.
echo Run QUALIFY-P0.14.cmd for Windows/browser/motion qualification.
pause
exit /b 0
:failed
echo [FAIL] Verification failed. Review the output above.
pause
exit /b 1
