@echo off
setlocal
set ROOT=%~dp0

REM backend
start "backend" cmd /k "cd /d %ROOT%backend && set PYTHON_BIN=python && npm run dev"

REM frontend
start "frontend" cmd /k "cd /d %ROOT%frontend && npm run dev"

timeout /t 2 >nul
start http://localhost:8000/healthz
start http://localhost:5173
