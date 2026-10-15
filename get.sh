#!/bin/bash
# Instalação em uma linha: baixa o código do Rice e roda o ./install.sh (ou atualiza, se já foi baixado antes).
# One-line install: fetches Rice's source and runs ./install.sh (or updates it if it is already there).
#   curl -fsSL https://ricenotes.app/install | bash
#   (ou / or: curl -fsSL https://raw.githubusercontent.com/WalissonCF/rice/main/get.sh | bash)
# Pasta / folder: ~/rice-src (mude com / override with RICE_DIR=/caminho). Um clone antigo em ~/rice continua sendo usado. / An older clone in ~/rice keeps being used.
set -euo pipefail

# --filter=blob:none: baixa só a versão atual de cada arquivo (as versões antigas das imagens vêm sob demanda, se alguém pedir)
REPO="https://github.com/WalissonCF/rice.git"
# ~/rice-src, e não ~/rice: no APFS (que não distingue maiúsculas) ~/rice É ~/Rice, a pasta de notas do app, que tranca o que há nela
# (0700/0600) e passa a gravar as reuniões no meio do código. Um clone antigo em ~/rice continua sendo usado (a checagem abaixo avisa se colidir).
# ~/rice-src, not ~/rice: on APFS (case-insensitive) ~/rice IS ~/Rice, the app's notes folder, which locks what is in it (0700/0600)
# and starts saving meetings in the middle of the source. An older clone in ~/rice keeps being used (the check below warns on a collision).
DIR="${RICE_DIR:-}"
if [ -z "$DIR" ]; then
  if [ -d "$HOME/rice/.git" ]; then DIR="$HOME/rice"; else DIR="$HOME/rice-src"; fi
fi

case "${LC_ALL:-${LANG:-}}" in pt*) LANG_UI=pt ;; *) LANG_UI=en ;; esac
say() { if [ "$LANG_UI" = pt ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi; }
die() { printf 'ERRO: %s\nERROR: %s\n' "$1" "$2" >&2; exit 1; }

# Onde ficam as notas do Rice: a pasta escolhida nas configurações, ou ~/Rice. Mesma regra de rice_notes_root/rice_same_dir em
# scripts/install-lib.sh, repetida aqui porque este script roda antes de o código existir no Mac.
# Where Rice keeps the notes: the folder chosen in the settings, or ~/Rice. Same rule as rice_notes_root/rice_same_dir in
# scripts/install-lib.sh, repeated here because this script runs before the source exists on the Mac.
notes_root() {
  local f="$HOME/Library/Application Support/Rice/settings.json" r=""
  [ -f "$f" ] && r="$(sed -nE 's/.*"root": *"([^"]*)".*/\1/p' "$f" | head -n 1)"
  printf '%s' "${r:-$HOME/Rice}"
}
same_dir() { [ -d "$1" ] && [ -d "$2" ] && [ "$(stat -f %i "$1")" = "$(stat -f %i "$2")" ]; }

[ "$(uname -s)" = "Darwin" ] || die "este instalador é para macOS. No Windows, baixe o instalador na página de releases." "this installer is for macOS. On Windows, download the installer from the releases page."

# o git vem com as Ferramentas de Linha de Comando do Xcode (o install.sh precisa delas de qualquer jeito)
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install >/dev/null 2>&1 || true
  die "instale as Ferramentas de Linha de Comando do Xcode (uma janela do macOS foi aberta) e rode este comando de novo." "install the Xcode Command Line Tools (a macOS window was opened) and run this command again."
fi

NOTES="$(notes_root)"
if same_dir "$DIR" "$NOTES"; then
  die "$DIR é a pasta das suas notas do Rice ($NOTES): o código não pode ficar nela (o app tranca os arquivos dela e as reuniões se misturariam com o código). Baixe o código em outra pasta: RICE_DIR=\$HOME/rice-src curl -fsSL https://ricenotes.app/install | bash" \
      "$DIR is your Rice notes folder ($NOTES): the source cannot live in it (the app locks its files and meetings would mix with the code). Download the source into another folder: RICE_DIR=\$HOME/rice-src curl -fsSL https://ricenotes.app/install | bash"
fi

if [ -d "$DIR/.git" ]; then
  say "o Rice já está em $DIR: atualizando…" "Rice is already in $DIR: updating…"
  cd "$DIR"
  # o update.sh confere alterações locais, não descarta nada e não atualiza durante uma gravação
  exec ./update.sh
fi

[ -e "$DIR" ] && die "$DIR já existe e não é um clone do Rice. Escolha outra pasta: RICE_DIR=/outra/pasta" "$DIR exists and is not a Rice clone. Pick another folder: RICE_DIR=/another/folder"

say "baixando o Rice em ${DIR}…" "downloading Rice into ${DIR}…"
git clone --filter=blob:none "$REPO" "$DIR" || die "não consegui baixar o código (confira a internet)." "could not download the source (check your connection)."
cd "$DIR"
# </dev/tty: o install.sh pode pedir algo ao usuário mesmo com este script vindo de um pipe
exec ./install.sh </dev/tty
