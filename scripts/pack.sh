#!/usr/bin/env bash
# Gera dist/<uuid>.shell-extension.zip com os mesmos arquivos do `gnome-extensions pack`,
# sem depender do GNOME (roda também no CI). Schemas vão só em XML: o GNOME 44+ compila sozinho.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/gnome-extension"
UUID="$(node -p "require('$SRC/metadata.json').uuid")"
OUT="$ROOT/dist/$UUID.shell-extension.zip"
mkdir -p "$ROOT/dist"
rm -f "$OUT"
cd "$SRC"
zip -qr -X "$OUT" metadata.json extension.js prefs.js lib.js i18n.js translations.js stylesheet.css \
    icons schemas -x 'schemas/gschemas.compiled'
echo ">> $OUT ($(node -p "require('$SRC/metadata.json')['version-name']"))"
