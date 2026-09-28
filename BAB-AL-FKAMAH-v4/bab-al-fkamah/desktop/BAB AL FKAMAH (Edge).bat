@echo off
REM Lanceur leger : ouvre BAB AL FKAMAH comme une application (fenetre sans barre d'adresse) avec Microsoft Edge.
REM Utile si vous ne voulez pas installer l'application PC complete.
set URL=http://rest.babfkamah.com
if not "%~1"=="" set URL=%~1
start "" msedge --app=%URL% --start-maximized
