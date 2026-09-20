@echo off
REM Smart Fleet - Reliable Startup Workflow for Windows
REM Starts backend (5000) + frontend (5173) and opens browser only when ready.
REM Usage: double-click this file or run "start-system.bat" from C:\xamppppp\htdocs\fleet

setlocal EnableDelayedExpansion
title Smart Fleet - Starting...

REM --- Resolve project root (directory of this .bat) ---
set "ROOT=%~dp0"
REM Trim trailing backslash for npm --prefix compatibility
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo ========================================================
echo   Smart Fleet Distribution Management System
echo   Starting backend + frontend ...
echo   Project root: %ROOT%
echo ========================================================
echo.

REM --- Preflight: Node.js ---
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH. Install Node.js 18+ and restart.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODEV=%%v
echo [OK] Node %NODEV%
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found.
  pause
  exit /b 1
)
echo.

REM --- Preflight: Check dependencies ---
if not exist "%ROOT%\frontend\node_modules" (
  echo [WARN] frontend\node_modules missing - running npm install ...
  call npm --prefix "%ROOT%\frontend" install
  if errorlevel 1 (
    echo [ERROR] frontend npm install failed.
    pause
    exit /b 1
  )
)
if not exist "%ROOT%\backend\node_modules" (
  echo [WARN] backend\node_modules missing - running npm install ...
  call npm --prefix "%ROOT%\backend" install
  if errorlevel 1 (
    echo [ERROR] backend npm install failed.
    pause
    exit /b 1
  )
)
if not exist "%ROOT%\node_modules" (
  echo [WARN] root node_modules missing - running npm install ...
  call npm --prefix "%ROOT%" install
  if errorlevel 1 (
    echo [ERROR] root npm install failed.
    pause
    exit /b 1
  )
)

REM --- Port conflict check (informational) ---
echo [CHECK] Ports 5000 (backend) and 5173 (frontend)
echo   To manually identify which process uses a port on Windows:
echo     netstat -ano ^| findstr :5000
echo     netstat -ano ^| findstr :5173
echo     tasklist /FI "PID eq <PID>"
echo.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5000 ^| findstr LISTENING') do (
  echo [WARN] Port 5000 already in use by PID %%a
  tasklist /FI "PID eq %%a" 2>nul | findstr /I "%%a"
  echo   If this is a previous backend instance, close it or run stop-system.bat first.
  echo.
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do (
  echo [WARN] Port 5173 already in use by PID %%a
  tasklist /FI "PID eq %%a" 2>nul | findstr /I "%%a"
  echo   If this is a previous Vite instance, close it or run stop-system.bat first.
  echo   Vite is configured with strictPort=true so it will FAIL instead of silently switching ports.
  echo.
)

REM --- Start backend and frontend in separate windows (keeps terminals running) ---
echo [START] Launching backend  (http://127.0.0.1:5000) ...
start "Smart Fleet - Backend (5000)" cmd /k "cd /d "%ROOT%\backend" && node server.js"

echo [START] Launching frontend (http://127.0.0.1:5173) ...
start "Smart Fleet - Frontend (5173)" cmd /k "cd /d "%ROOT%\frontend" && npm run dev"

echo.
echo [WAIT] Waiting for servers to become ready (polling every 2s, up to 90s)...
echo   Backend  : http://127.0.0.1:5000/
echo   Frontend : http://127.0.0.1:5173/
echo.

REM --- Poll with PowerShell until both are ready, then open browser ---
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$backend='http://127.0.0.1:5000/'; $frontend='http://127.0.0.1:5173/'; $max=45; $okB=$false; $okF=$false; " ^
  "for ($i=1; $i -le $max; $i++) { " ^
  "  if (-not $okB) { try { $r=Invoke-WebRequest -Uri $backend -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { $okB=$true; Write-Host '[OK] Backend ready' -ForegroundColor Green } } catch {} } " ^
  "  if (-not $okF) { try { $r=Invoke-WebRequest -Uri $frontend -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { $okF=$true; Write-Host '[OK] Frontend ready' -ForegroundColor Green } } catch {} } " ^
  "  if ($okB -and $okF) { break } " ^
  "  Write-Host \"  ... waiting ($i/$max)  backend=$okB  frontend=$okF\"; Start-Sleep -Seconds 2 " ^
  "} " ^
  "if ($okB -and $okF) { Write-Host '' ; Write-Host 'Both services ready - opening browser...' -ForegroundColor Cyan; Start-Process 'http://localhost:5173' ; exit 0 } " ^
  "else { Write-Host '' ; Write-Host '[TIMEOUT] One or both services did not become ready in 90s.' -ForegroundColor Red; Write-Host 'Check the Backend and Frontend terminal windows for errors.'; Write-Host 'Common fixes: 1) MySQL not running (XAMPP) 2) Port conflict 3) npm install needed'; exit 1 }"

if errorlevel 1 (
  echo.
  echo [ACTION] Servers may still be starting. Check the two new terminal windows.
  echo   Frontend: http://localhost:5173  (or http://127.0.0.1:5173)
  echo   Backend : http://127.0.0.1:5000
  echo   Login   : http://localhost:5173/login
  pause
  exit /b 1
)

echo.
echo ========================================================
echo   All services ready!
echo   Frontend : http://localhost:5173  (also http://127.0.0.1:5173)
echo   Backend  : http://127.0.0.1:5000
echo   Login    : http://localhost:5173/login
echo ========================================================
echo   Both terminal windows will stay open. Close them or run
echo   stop-system.bat to stop the system.
echo ========================================================
REM Keep this window open so user sees status
pause
