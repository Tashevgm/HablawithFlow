@echo off
setlocal

cd /d "%~dp0"

echo Starting Hablawithflow server...
echo.

if not exist "node_modules" (
  echo Dependencies not found. Installing with npm...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Server URL: http://127.0.0.1:8787
echo Press Ctrl+C to stop the server.
echo.

call npm start
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Server stopped with exit code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
