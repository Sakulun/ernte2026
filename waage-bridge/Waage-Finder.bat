@echo off
REM ===================================================================
REM  Waage-Finder starten (unabhaengig von der PowerShell-Policy).
REM  Diese Datei zusammen mit waage-finder.ps1 auf den USB-Stick ziehen
REM  und auf dem Bitzer-PC per Doppelklick starten.
REM ===================================================================
title Waage-Finder
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0waage-finder.ps1" %*
echo.
pause
