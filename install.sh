#!/bin/bash
# Instala o Rice a partir do código: confere o ambiente, instala o que falta com o Homebrew, gera o app e o copia para /Applications.
# Installs Rice from source: checks the environment, installs what is missing with Homebrew, builds the app and copies it to /Applications.
# Idempotente: pode rodar de novo. / Idempotent: safe to run again.   Uso/Usage: ./install.sh [--check]   (--check só confere o ambiente / only checks the environment)
set -euo pipefail
cd "$(dirname "$0")"

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

case "${LC_ALL:-${LANG:-}}" in pt*) LANG_UI=pt ;; *) LANG_UI=en ;; esac
say() { if [ "$LANG_UI" = pt ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi; }          # progresso: no idioma do sistema
die() { printf 'ERRO: %s\nERROR: %s\n' "$1" "$2" >&2; exit 1; }                                    # erros: sempre em pt e en

# 1) macOS em Apple Silicon
[ "$(uname -s)" = "Darwin" ] || die "o Rice só roda no macOS." "Rice only runs on macOS."
[ "$(uname -m)" = "arm64" ] || die "este instalador é para Macs com Apple Silicon (arm64)." "this installer is for Apple Silicon (arm64) Macs."
MAJOR="$(sw_vers -productVersion | cut -d. -f1)"
[ "$MAJOR" -ge 14 ] || die "é preciso o macOS 14 ou mais novo (você tem $(sw_vers -productVersion))." "macOS 14 or newer is required (you have $(sw_vers -productVersion))."
say "macOS $(sw_vers -productVersion), arm64: ok" "macOS $(sw_vers -productVersion), arm64: ok"

# 2) Xcode Command Line Tools (compilam os binários nativos em Swift)
if ! xcode-select -p >/dev/null 2>&1; then
  [ "$CHECK_ONLY" = 1 ] || xcode-select --install >/dev/null 2>&1 || true
  die "instale as Ferramentas de Linha de Comando do Xcode (uma janela do macOS foi aberta) e rode ./install.sh de novo." "install the Xcode Command Line Tools (a macOS window was opened) and run ./install.sh again."
fi
say "Xcode Command Line Tools: ok" "Xcode Command Line Tools: ok"

# 3) Homebrew
command -v brew >/dev/null 2>&1 || die "Homebrew não encontrado. Instale em https://brew.sh e rode ./install.sh de novo." "Homebrew not found. Install it from https://brew.sh and run ./install.sh again."
say "Homebrew: ok" "Homebrew: ok"

# 4) Node 22 ou mais
command -v node >/dev/null 2>&1 || die "Node não encontrado. Instale o Node 22 ou mais novo (brew install node) e rode ./install.sh de novo." "Node not found. Install Node 22 or newer (brew install node) and run ./install.sh again."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "é preciso o Node 22 ou mais novo (você tem $(node -v)). Atualize com: brew upgrade node" "Node 22 or newer is required (you have $(node -v)). Upgrade with: brew upgrade node"
say "Node $(node -v): ok" "Node $(node -v): ok"

# 5) o que falta do Homebrew (o whisper.cpp faz a transcrição; meson, ninja e pkg-config compilam o processamento de áudio)
MISSING=()
for formula in whisper.cpp meson ninja pkg-config; do
  brew list --formula "$formula" >/dev/null 2>&1 || MISSING+=("$formula")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
  say "falta instalar com o Homebrew: ${MISSING[*]}" "missing from Homebrew: ${MISSING[*]}"
  [ "$CHECK_ONLY" = 1 ] || brew install "${MISSING[@]}" || die "o brew não conseguiu instalar: ${MISSING[*]}." "brew could not install: ${MISSING[*]}."
else
  say "Homebrew (whisper.cpp meson ninja pkg-config): ok" "Homebrew (whisper.cpp meson ninja pkg-config): ok"
fi

if [ "$CHECK_ONLY" = 1 ]; then
  say "ambiente conferido (--check): nada foi instalado nem gerado." "environment checked (--check): nothing was installed or built."
  exit 0
fi

# 6) dependências, binários nativos e o app
say "instalando dependências (npm ci)…" "installing dependencies (npm ci)…"
npm ci || die "npm ci falhou." "npm ci failed."
say "gerando o app (npm run dist; compila os binários nativos, leva alguns minutos)…" "building the app (npm run dist; compiles the native binaries, takes a few minutes)…"
npm run dist || die "npm run dist falhou. Veja as mensagens acima." "npm run dist failed. See the messages above."

APP="dist/mac-arm64/Rice.app"
[ -d "$APP" ] || die "não encontrei $APP depois do build." "could not find $APP after the build."

# 7) copiar para /Applications (substitui a versão anterior) e tirar a quarentena
DEST="/Applications/Rice.app"
if [ -d "$DEST" ]; then
  say "substituindo $DEST…" "replacing $DEST…"
  rm -rf "$DEST" || die "não consegui apagar $DEST (feche o Rice e tente de novo)." "could not remove $DEST (quit Rice and try again)."
fi
ditto "$APP" "$DEST" || die "não consegui copiar para /Applications." "could not copy to /Applications."
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

say "pronto: abra o Rice em /Applications (ou: open -a Rice)." "done: open Rice from /Applications (or: open -a Rice)."
say "o app não é assinado pela Apple: o macOS pode pedir de novo as permissões (microfone, áudio do sistema, Calendário) após atualizar." "the app is not signed by Apple: macOS may ask for the permissions again (microphone, system audio, Calendar) after an update."
