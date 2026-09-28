@echo off
REM Reconstitue BAB-AL-FKAMAH-PC-Windows.zip a partir des 5 morceaux (placez-les dans le meme dossier que ce fichier)
cd /d "%~dp0"
for %%f in (BAB-AL-FKAMAH-PC.part1 BAB-AL-FKAMAH-PC.part2 BAB-AL-FKAMAH-PC.part3 BAB-AL-FKAMAH-PC.part4 BAB-AL-FKAMAH-PC.part5 ) do if not exist "%%f" (echo Morceau manquant : %%f & pause & exit /b 1)
copy /b BAB-AL-FKAMAH-PC.part1+BAB-AL-FKAMAH-PC.part2+BAB-AL-FKAMAH-PC.part3+BAB-AL-FKAMAH-PC.part4+BAB-AL-FKAMAH-PC.part5 "BAB-AL-FKAMAH-PC-Windows.zip" >nul
echo OK : BAB-AL-FKAMAH-PC-Windows.zip cree. Decompressez-le puis lancez "BAB AL FKAMAH.exe".
pause
