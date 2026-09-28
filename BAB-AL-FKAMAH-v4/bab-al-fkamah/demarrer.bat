@echo off
chcp 65001 >nul
title BAB AL FKAMAH
cd /d "%~dp0"
if not exist ".env" copy ".env.example" ".env" >nul
if not exist "node_modules" (
  echo Installation des dependances...
  call npm install
)
echo.
call npm start
pause
