@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-app.ps1"
if errorlevel 1 (
  echo Startup failed. Please copy the error above.
) else (
  echo Website ready: http://127.0.0.1:3827/
  echo The service runs in the background. You may close this window.
)
pause
