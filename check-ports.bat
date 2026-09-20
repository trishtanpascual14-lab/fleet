@echo off
REM Diagnose port conflicts for Smart Fleet
echo === Smart Fleet Port Diagnostics ===
echo.
echo [PORT 5000 - Backend]
netstat -ano | findstr :5000
if errorlevel 1 echo   (free - no process listening on 5000)
echo.
echo [PORT 5173 - Frontend]
netstat -ano | findstr :5173
if errorlevel 1 echo   (free - no process listening on 5173)
echo.
echo [All Node processes]
tasklist /FI "IMAGENAME eq node.exe" 2>nul
echo.
echo To identify a process by PID:  tasklist /FI "PID eq <PID>"
echo To kill a process by PID:      taskkill /PID <PID> /F
echo To kill all Node:              taskkill /F /IM node.exe
echo.
pause
