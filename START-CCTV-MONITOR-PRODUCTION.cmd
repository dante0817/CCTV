@echo off
setlocal
cd /d "%~dp0"
title CCTV Monitor P0.10 Production
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-production.ps1"
if errorlevel 1 (
  echo.
  echo CCTV Monitor production runtime could not start. Review the message above.
  pause
  exit /b 1
)
endlocal
