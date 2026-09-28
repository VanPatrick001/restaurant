#!/bin/sh
# Reconstruit l'APK à partir du dossier android/app (Java 11+, apktool 2.9.x, uber-apk-signer 1.3)
#   apktool      : https://github.com/iBotPeaches/Apktool/releases
#   uber-signer  : https://github.com/patrickfav/uber-apk-signer/releases
# Pensez à augmenter versionCode dans app/apktool.yml pour une mise à jour.
set -e
cd "$(dirname "$0")"
PW="$(sed -n 's/.*cle) : //p' signature-LISEZMOI.txt | tr -d '\r')"
java -jar apktool.jar b app -o build/unsigned.apk
java -jar uber-apk-signer.jar --apks build/unsigned.apk --ks bab-al-fkamah.jks --ksAlias resto --ksPass "$PW" --ksKeyPass "$PW" --out build
mkdir -p ../dist && cp build/unsigned-aligned-signed.apk ../dist/BAB-AL-FKAMAH.apk
echo "APK : dist/BAB-AL-FKAMAH.apk"
