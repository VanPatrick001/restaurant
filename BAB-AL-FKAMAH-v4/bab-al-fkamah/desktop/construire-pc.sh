#!/usr/bin/env bash
# Reconstruit l'application PC Windows (sans installation d'Electron sur Windows).
# Prérequis : bash, curl, unzip, zip, node/npm, python3 + Pillow.
set -e
cd "$(dirname "$0")"
V=$(node -p "require('./package.json').devDependencies.electron.replace(/[^0-9.]/g,'')")
W=$(mktemp -d); echo "Electron $V → $W"
curl -sSL -o "$W/e.zip" "https://github.com/electron/electron/releases/download/v$V/electron-v$V-win32-x64.zip"
mkdir "$W/app" && unzip -q "$W/e.zip" -d "$W/app"
find "$W/app/locales" -type f ! -name en-US.pak ! -name fr.pak ! -name ar.pak -delete
rm -f "$W/app/LICENSES.chromium.html" "$W/app/resources/default_app.asar"
mv "$W/app/electron.exe" "$W/app/BAB AL FKAMAH.exe"
mkdir -p "$W/app/resources/app" && cp package.json main.js preload.js launcher.html logo.png "$W/app/resources/app/"
python3 -c "from PIL import Image; Image.open('../public/icons/icon-512.png').convert('RGBA').save('$W/icon.ico', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])"
(cd "$W" && npm init -y >/dev/null && npm i resedit@2 >/dev/null && node -e "
const R=require('resedit'),fs=require('fs'),f='app/BAB AL FKAMAH.exe';
const e=R.NtExecutable.from(fs.readFileSync(f),{ignoreCert:true}),r=R.NtExecutableResource.from(e);
const g=R.Resource.IconGroupEntry.fromEntries(r.entries)[0];
R.Resource.IconGroupEntry.replaceIconsForResource(r.entries,g.id,g.lang,R.Data.IconFile.from(fs.readFileSync('icon.ico')).icons.map(i=>i.data));
r.outputResource(e);fs.writeFileSync(f,Buffer.from(e.generate()));")
mkdir -p ../dist && (cd "$W" && mv app "BAB AL FKAMAH" && zip -qr9 pc.zip "BAB AL FKAMAH")
mv "$W/pc.zip" ../dist/BAB-AL-FKAMAH-PC-Windows.zip && rm -rf "$W"
echo "OK → dist/BAB-AL-FKAMAH-PC-Windows.zip"
