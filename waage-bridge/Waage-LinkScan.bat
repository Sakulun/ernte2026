@echo off
title Waage-LinkScan
REM Sucht das Terminal am Direktkabel (Ethernet 2 / 169.254.x.x).
REM Diese Datei + Waage-LinkScan.ps1 zusammen auf den USB-Stick.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Waage-LinkScan.ps1" %*
echo.
pause
