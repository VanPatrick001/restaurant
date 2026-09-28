@echo off
chcp 65001 >nul
title BAB AL FKAMAH - installation de la base de donnees
cd /d "%~dp0"
if not exist ".env" copy ".env.example" ".env" >nul
if not exist "node_modules" (
  echo Installation des dependances...
  call npm install
)
echo.
echo ATTENTION : la base "bab_al_fkamah" va etre (re)creee avec les donnees de demonstration.
echo Les identifiants MySQL utilises sont ceux du fichier .env (DB_ADMIN_USER / DB_ADMIN_PASSWORD).
echo.
choice /M "Continuer"
if errorlevel 2 exit /b
call npm run init-db
echo.
pause
