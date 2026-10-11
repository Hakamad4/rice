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
echo "ok: $(ls native-bin | tr '\n' ' ')"
