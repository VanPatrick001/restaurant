#!/bin/sh
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env
[ -d node_modules ] || npm install
npm start
