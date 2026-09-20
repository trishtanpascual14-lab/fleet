@echo off
REM Smart Fleet - Stop all Node/Vite processes
setlocal
echo Stopping Smart Fleet services...
echo.

echo [INFO] To stop only this system's ports, you can use:
echo   netstat -ano ^| findstr :5000
echo   netstat -ano ^| findstr :5173
echo   taskkill /PID ^<PID^> /F
echo.

choice /M "Kill ALL Node.js processes (closes all Vite/backend windows)" /C YN /D N /T 10
if errorlevel 2 (
  echo [SKIP] Not killing processes. Manually close the Backend/Frontend windows.
  echo   Or run:  taskkill /F /IM node.exe
  pause
  exit /b 0
)

taskkill /F /IM node.exe 2>nul
if errorlevel 1 (
  echo [INFO] No node.exe processes found - nothing to stop.
) else (
  echo [OK] All Node.js processes terminated.
)
timeout /t 2 >nul
netstat -ano | findstr ":5000 :5173" 2>nul
if errorlevel 1 (
  echo [OK] Ports 5000 and 5173 are now free.
) else (
  echo [WARN] Some process still occupies 5000 or 5173 - check netstat output above.
)
pause
