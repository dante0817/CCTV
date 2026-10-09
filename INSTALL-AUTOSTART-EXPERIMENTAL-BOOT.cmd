@echo off
cd /d "%~dp0"
net session >nul 2>&1
if not "%errorlevel%"=="0" (
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo WARNING: This runs CCTV Monitor as SYSTEM at Windows startup.
echo Some USB DirectShow webcams do not work in a noninteractive SYSTEM session.
echo Use only for qualification on the actual CCTV PC.
echo.
set /p CONFIRM=Type YES to continue: 
if /I not "%CONFIRM%"=="YES" exit /b 0
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-autostart.ps1" -ExperimentalAtStartup
pause
