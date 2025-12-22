@echo off
setlocal
set ROOT=%~dp0

REM backend
start "backend" cmd /k "cd /d %ROOT%backend && call .venv\Scripts\activate.bat && uvicorn app.main:app --reload --port 8000"

REM frontend
start "frontend" cmd /k "cd /d %ROOT%frontend && npm run dev"

timeout /t 2 >nul
start http://localhost:8000/docs
start http://localhost:5173
