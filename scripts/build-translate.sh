#!/bin/bash
# Compila o rice-translate (sidecar da tradução offline: C++, CTranslate2 + sentencepiece, versões fixas no CMake).
# Só compila com a tradução offline habilitada (src/main/translate/flags.ts ou RICE_OFFLINE_TRANSLATION=1); desabilitada, não
# compila, não exige cmake e o app de release sai sem o binário.
# Fora do modo release, qualquer falha só AVISA e o app sai sem o motor offline.
# Com RICE_RELEASE=1 (build de release do app), qualquer falha ABORTA: nunca se publica um app sem o motor em silêncio.
# RICE_TRANSLATE_ARCH=x86_64 (ou arm64) compila para outra arquitetura do Mac. RICE_CMAKE troca o executável do cmake.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=offline-translation.sh
source scripts/offline-translation.sh
if ! offline_translation_enabled; then
  echo "tradução offline desabilitada (OFFLINE_TRANSLATION): rice-translate não compilado / offline translation disabled: rice-translate not built"
  exit 0
fi
CMAKE="${RICE_CMAKE:-cmake}"
OUT=native/translate/.build/release

release() { [ -n "${RICE_RELEASE:-}" ] && [ "${RICE_RELEASE}" != 0 ]; }
giveup() { # $1 = motivo
  if release; then
    echo "ERRO: $1 — com RICE_RELEASE=1 o app não sai sem o motor de tradução offline / ERROR: $1 — with RICE_RELEASE=1 the app must not ship without the offline translation engine" >&2
    exit 1
  fi
  echo "aviso: $1; o app sai SEM a tradução offline / warning: $1; the app ships WITHOUT offline translation" >&2
  exit 0
}

command -v "$CMAKE" >/dev/null 2>&1 || giveup "cmake não encontrado (brew install cmake)"
"$CMAKE" -S native/translate -B "$OUT" -DCMAKE_BUILD_TYPE=Release ${RICE_TRANSLATE_ARCH:+-DCMAKE_OSX_ARCHITECTURES=$RICE_TRANSLATE_ARCH} || giveup "falha ao configurar o rice-translate"
"$CMAKE" --build "$OUT" --target rice-translate -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 4)" || giveup "falha ao compilar o rice-translate"
[ -x "$OUT/rice-translate" ] || giveup "o rice-translate não foi gerado"
echo "ok: $OUT/rice-translate ($(du -k "$OUT/rice-translate" | cut -f1) KB)"
