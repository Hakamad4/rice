#!/bin/bash
# Gera assets/icon/icon.png (1024), assets/icon/Rice.icns (de rice-icon.svg) e as imagens template da barra de menus (de tray-template.svg).
set -euo pipefail
cd "$(dirname "$0")/.."
ELECTRON=node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
SET=$(mktemp -d)/Rice.iconset
mkdir -p "$SET"
"$ELECTRON" scripts/render-svg.cjs assets/icon/rice-icon.svg "$SET" \
  icon_16x16:16 icon_16x16@2x:32 icon_32x32:32 icon_32x32@2x:64 icon_128x128:128 icon_128x128@2x:256 \
  icon_256x256:256 icon_256x256@2x:512 icon_512x512:512 icon_512x512@2x:1024
cp "$SET/icon_512x512@2x.png" assets/icon/icon.png
iconutil -c icns "$SET" -o assets/icon/Rice.icns
# imagem "template" da barra de menus (16 e 32 px)
TRAY=$(mktemp -d)
"$ELECTRON" scripts/render-svg.cjs assets/icon/tray-template.svg "$TRAY" trayTemplate:16 trayTemplate@2x:32
cp "$TRAY/trayTemplate.png" "$TRAY/trayTemplate@2x.png" assets/icon/
echo "ok: assets/icon/icon.png e assets/icon/Rice.icns"
