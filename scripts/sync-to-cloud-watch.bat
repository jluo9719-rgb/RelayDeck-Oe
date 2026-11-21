@echo off
chcp 65001 >nul
title RelayDeck CC Switch 自动同步监听
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-ccswitch-to-cloud.ps1" -Watch
echo.
pause
