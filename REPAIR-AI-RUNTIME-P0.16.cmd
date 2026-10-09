@echo off
setlocal
cd /d "%~dp0"
title CCTV Monitor P0.16 - Repair AI Runtime
echo Installing optional ONNX Runtime Node.js binding...
call npm install onnxruntime-node@1.30.0 --save-optional --no-audit --no-fund
if errorlevel 1 (
  echo [WARN] ONNX Runtime installation failed. Core CCTV functions remain usable with AI disabled.
  pause
  exit /b 1
)
echo [OK] ONNX Runtime installation completed.
pause
