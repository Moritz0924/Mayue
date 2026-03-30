@echo off
setlocal
set ROOT=%~dp0

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%run_demo.ps1" %*
if errorlevel 1 (
  echo.
  echo [Mayue Demo] Failed to start demo services.
  pause
  exit /b 1
)

