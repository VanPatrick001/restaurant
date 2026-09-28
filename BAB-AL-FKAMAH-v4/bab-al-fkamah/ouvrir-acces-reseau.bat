@echo off
chcp 65001 >nul
title BAB AL FKAMAH - acces reseau
:: Relance automatique en administrateur
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ouvrir-acces-reseau.ps1"
echo.
pause
