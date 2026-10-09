@echo off
setlocal
cd /d "%~dp0"
title CCTV Monitor
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-dev.ps1"
if errorlevel 1 (
  echo.
  echo CCTV Monitor could not start. Review the message above.
  echo.
  pause
  exit /b 1
)
endlocal
