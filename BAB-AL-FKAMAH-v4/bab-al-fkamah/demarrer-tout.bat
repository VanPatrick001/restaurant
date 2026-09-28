@echo off
chcp 65001 >nul
title BAB AL FKAMAH
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
if not exist ".env" copy ".env.example" ".env" >nul
if not exist "node_modules" (
  echo Installation des dependances...
  call npm install
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0configurer-domaine.ps1"
start "BAB AL FKAMAH - DNS" cmd /k node server\dns.js
echo Demarrage de l'application...
node server\index.js
pause
