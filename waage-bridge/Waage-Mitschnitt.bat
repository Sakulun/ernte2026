@echo off
title Waage-Mitschnitt
REM Startet den Mitschnitt mit Administrator-Rechten (pktmon braucht das).
REM Diese Datei + Waage-Mitschnitt.ps1 zusammen auf den USB-Stick.
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Administrator-Rechte werden angefordert ...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Waage-Mitschnitt.ps1"
echo.
pause
