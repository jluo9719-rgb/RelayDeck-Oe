@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-ccswitch-to-cloud.ps1"
echo.
pause
