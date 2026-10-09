@echo off
setlocal
cd /d "%~dp0"
title CCTV Monitor P0.16 - Install AI Model
node scripts\install-ai-model.mjs
if errorlevel 1 (
  echo [WARN] AI model installation failed. CCTV Monitor can still run with AI detection disabled.
  pause
  exit /b 1
)
pause
