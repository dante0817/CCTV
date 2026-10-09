@echo off
setlocal
cd /d "%~dp0"
echo CCTV Monitor - Tailscale Firewall Setup
echo.
echo This will request Administrator permission and create inbound rules ONLY for:
echo   TCP 3000  - CCTV web app
echo   TCP 8889  - WebRTC/WHEP signaling
echo   UDP 8189  - WebRTC media
echo Remote addresses are limited to the Tailscale IPv4 range 100.64.0.0/10.
echo It does NOT configure router port forwarding.
echo.
pause
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0scripts\configure-tailscale-firewall.ps1\"'"
echo.
pause
