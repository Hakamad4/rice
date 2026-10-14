#!/bin/bash
# Instalação em uma linha: baixa o código do Rice e roda o ./install.sh (ou atualiza, se já foi baixado antes).
# One-line install: fetches Rice's source and runs ./install.sh (or updates it if it is already there).
#   curl -fsSL https://ricenotes.app/install | bash
#   (ou / or: curl -fsSL https://raw.githubusercontent.com/WalissonCF/rice/main/get.sh | bash)
# Pasta / folder: ~/rice (mude com / override with RICE_DIR=/caminho).
set -euo pipefail

# --filter=blob:none: baixa só a versão atual de cada arquivo (as versões antigas das imagens vêm sob demanda, se alguém pedir)
REPO="https://github.com/WalissonCF/rice.git"
DIR="${RICE_DIR:-$HOME/rice}"

case "${LC_ALL:-${LANG:-}}" in pt*) LANG_UI=pt ;; *) LANG_UI=en ;; esac
say() { if [ "$LANG_UI" = pt ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi; }
die() { printf 'ERRO: %s\nERROR: %s\n' "$1" "$2" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "este instalador é para macOS. No Windows, baixe o instalador na página de releases." "this installer is for macOS. On Windows, download the installer from the releases page."

# o git vem com as Ferramentas de Linha de Comando do Xcode (o install.sh precisa delas de qualquer jeito)
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install >/dev/null 2>&1 || true
  die "instale as Ferramentas de Linha de Comando do Xcode (uma janela do macOS foi aberta) e rode este comando de novo." "install the Xcode Command Line Tools (a macOS window was opened) and run this command again."
fi

if [ -d "$DIR/.git" ]; then
  say "o Rice já está em $DIR: atualizando…" "Rice is already in $DIR: updating…"
  cd "$DIR"
  # o update.sh confere alterações locais, não descarta nada e não atualiza durante uma gravação
  exec ./update.sh
fi

[ -e "$DIR" ] && die "$DIR já existe e não é um clone do Rice. Escolha outra pasta: RICE_DIR=/outra/pasta" "$DIR exists and is not a Rice clone. Pick another folder: RICE_DIR=/another/folder"

say "baixando o Rice em $DIR…" "downloading Rice into $DIR…"
git clone --filter=blob:none "$REPO" "$DIR" || die "não consegui baixar o código (confira a internet)." "could not download the source (check your connection)."
cd "$DIR"
# </dev/tty: o install.sh pode pedir algo ao usuário mesmo com este script vindo de um pipe
exec ./install.sh </dev/tty
