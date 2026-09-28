@echo off
chcp 65001 >nul
title BAB AL FKAMAH - Serveur DNS (rest.babfkamah.com)
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
if not exist ".env" copy ".env.example" ".env" >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0configurer-domaine.ps1"
node server\dns.js
pause
