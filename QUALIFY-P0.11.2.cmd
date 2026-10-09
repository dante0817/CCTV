@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\qualify-p0.11.2.ps1"
endlocal
