@echo off
cd /d "%~dp0"
title Waage-Bildschirm-Bridge (OCR)

if not exist node_modules (
  echo Erste Einrichtung: installiere Abhaengigkeiten...
  call npm install
  echo.
)

echo === Waage-Bildschirm-Bridge (OCR) ===
echo Liest das Gewicht vom Bitzer-Fenster und schreibt es live nach Supabase.
echo Fenster offen lassen. Beenden mit Strg+C.
echo.
node screen-ocr.js
pause
