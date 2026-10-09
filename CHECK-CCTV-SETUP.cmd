@echo off
setlocal
cd /d "%~dp0"
title CCTV Monitor - Setup Check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-dev.ps1" -CheckOnly
if errorlevel 1 (
  echo.
  echo Setup check found a blocking problem.
)
echo.
pause
endlocal
