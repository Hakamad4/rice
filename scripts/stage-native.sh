#!/bin/bash
# Copia os binários nativos compilados para native-bin/ (pasta sem ponto no nome, que o empacotador inclui no app).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf native-bin && mkdir -p native-bin
for name in rice-audio rice-detector; do
  src="native/$name/.build/release/$name"
  [ -x "$src" ] || { echo "falta $src: rode scripts/build-native.sh / missing $src: run scripts/build-native.sh" >&2; exit 1; }
  cp "$src" "native-bin/$name"
done
# tradução offline: só entra com a chave habilitada (src/main/translate/flags.ts); habilitada, com RICE_RELEASE=1 a falta do binário aborta
source scripts/offline-translation.sh
if ! offline_translation_enabled; then
  echo "tradução offline desabilitada: app sem rice-translate / offline translation disabled: app without rice-translate"
elif [ -x native/translate/.build/release/rice-translate ]; then
  cp native/translate/.build/release/rice-translate native-bin/rice-translate
elif [ -n "${RICE_RELEASE:-}" ] && [ "${RICE_RELEASE}" != 0 ]; then
  echo "ERRO: falta native/translate/.build/release/rice-translate (rode scripts/build-native.sh) / missing rice-translate" >&2
  exit 1
else
  echo "aviso: sem rice-translate no app / warning: no rice-translate in the app" >&2
fi
echo "ok: $(ls native-bin | tr '\n' ' ')"
