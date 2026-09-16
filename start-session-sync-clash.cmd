@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-session-sync.ps1" -UseClash
if errorlevel 1 (
  echo Startup failed. Copy the error above.
) else (
  echo Helper running through Clash. Keep Clash running.
  echo System proxy must point to 127.0.0.1:8899 during sync.
)
pause
