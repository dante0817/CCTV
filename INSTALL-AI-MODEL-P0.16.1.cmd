@echo off
setlocal
cd /d "%~dp0"
title CCTV Monitor P0.16.1 - Install AI Model
node scripts\install-ai-model.mjs
if errorlevel 1 (
  echo [WARN] AI model installation failed. Core CCTV functions remain usable with AI disabled.
  pause
  exit /b 1
)
echo [OK] AI model verified and installed.
pause
