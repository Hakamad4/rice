#!/bin/bash
# Atualiza o Rice instalado com ./install.sh: baixa o código novo (git pull --ff-only), fecha o app, refaz o build e abre de novo.
# Updates a Rice installed with ./install.sh: pulls the new code (git pull --ff-only), quits the app, rebuilds and opens it again.
# Nunca descarta alterações suas. / Never discards your changes.   Uso/Usage: ./update.sh [--force]   (--force reconstrói mesmo sem versão nova / rebuilds even if up to date)
#
# Variáveis só para testes / test-only variables: RICE_UPDATE_INSTALL_CMD, RICE_UPDATE_QUIT_CMD, RICE_UPDATE_OPEN_CMD,
# RICE_UPDATE_RUNNING_CMD (sai 0 se o Rice está aberto / exits 0 if Rice is open), RICE_UPDATE_RECORDING_CMD (sai 0 se está gravando / exits 0 if recording).

# Tudo dentro de uma função: o `git pull` pode reescrever este arquivo enquanto o bash o lê.
# Everything inside a function: `git pull` may rewrite this file while bash is reading it.
main() {
  set -euo pipefail
  cd "$(dirname "$0")"

  local FORCE=0
  case "${1:-}" in
    "") ;;
    --force) FORCE=1 ;;
    *) printf 'Uso/Usage: ./update.sh [--force]\n' >&2; return 2 ;;
  esac

  case "${LC_ALL:-${LANG:-}}" in pt*) LANG_UI=pt ;; *) LANG_UI=en ;; esac
  say() { if [ "$LANG_UI" = pt ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi; }
  die() { printf 'ERRO: %s\nERROR: %s\n' "$1" "$2" >&2; exit 1; }

  local APP_NAME="Rice" APP="/Applications/Rice.app"
  local INSTALL_CMD="${RICE_UPDATE_INSTALL_CMD:-./install.sh}"
  local QUIT_CMD="${RICE_UPDATE_QUIT_CMD:-osascript -e 'quit app \"Rice\"'}"
  local OPEN_CMD="${RICE_UPDATE_OPEN_CMD:-open -a Rice}"
  local RUNNING_CMD="${RICE_UPDATE_RUNNING_CMD:-pgrep -f /Applications/Rice.app/Contents/MacOS/Rice}"
  # o rice-audio é filho do app e só existe enquanto há gravação ou captura de áudio em andamento
  local RECORDING_CMD="${RICE_UPDATE_RECORDING_CMD:-pgrep -f /Applications/Rice.app/.*/rice-audio}"

  # 1) precisa ser um clone git com remote e ramo acompanhado
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "esta pasta não é um clone git; o update.sh só atualiza quem instalou com git clone + ./install.sh." "this folder is not a git clone; update.sh only updates installs made with git clone + ./install.sh."
  [ -n "$(git remote)" ] || die "este clone não tem remote (git remote -v está vazio)." "this clone has no remote (git remote -v is empty)."
  git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1 || die "o ramo atual não acompanha nenhum ramo remoto (use: git branch --set-upstream-to=origin/main)." "the current branch does not track a remote branch (use: git branch --set-upstream-to=origin/main)."

  # 2) alterações locais: nunca descarta nada sozinho
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    git status --short --untracked-files=no >&2
    die "há alterações locais não salvas (acima). Guarde-as com: git stash   (e depois recupere com: git stash pop). Nada foi alterado." "there are local changes (above). Save them with: git stash   (and restore later with: git stash pop). Nothing was changed."
  fi

  # 3) versão nova?
  say "procurando versão nova…" "checking for a new version…"
  git fetch --quiet || die "git fetch falhou (sem internet ou sem acesso ao remote?)." "git fetch failed (no internet or no access to the remote?)."
  local BEHIND
  BEHIND="$(git rev-list --count 'HEAD..@{u}')"
  if [ "$BEHIND" = 0 ] && [ "$FORCE" = 0 ]; then
    say "o Rice já está atualizado ($(git rev-parse --short HEAD)). Use ./update.sh --force para reconstruir mesmo assim." "Rice is already up to date ($(git rev-parse --short HEAD)). Use ./update.sh --force to rebuild anyway."
    return 0
  fi

  # 4) não atualiza com gravação em andamento
  if eval "$RECORDING_CMD" >/dev/null 2>&1; then
    die "o Rice está gravando. Pare a gravação (e deixe as notas terminarem) e rode ./update.sh de novo. Nada foi alterado." "Rice is recording. Stop the recording (and let the notes finish) and run ./update.sh again. Nothing was changed."
  fi

  # 5) o que mudou e pull só em fast-forward
  if [ "$BEHIND" != 0 ]; then
    say "o que mudou ($BEHIND commit(s)):" "what changed ($BEHIND commit(s)):"
    git log --oneline -n 20 'HEAD..@{u}' # -n em vez de | head: com pipefail o SIGPIPE do head derrubaria o script
    [ "$BEHIND" -le 20 ] || say "… e mais $((BEHIND - 20))." "… and $((BEHIND - 20)) more."
    git pull --ff-only --quiet || die "não foi possível atualizar só avançando (git pull --ff-only): seu clone tem commits que o remote não tem. Resolva à mão (git status, git log) e rode ./update.sh de novo. Nada foi descartado." "could not fast-forward (git pull --ff-only): your clone has commits the remote does not have. Resolve it by hand (git status, git log) and run ./update.sh again. Nothing was discarded."
  fi

  # 6) fecha o Rice, refaz o build (o install.sh só troca o app depois de o build dar certo) e abre de novo
  local WAS_RUNNING=0
  if eval "$RUNNING_CMD" >/dev/null 2>&1; then
    WAS_RUNNING=1
    say "fechando o Rice…" "quitting Rice…"
    eval "$QUIT_CMD" >/dev/null 2>&1 || true
    local i
    for i in $(seq 1 30); do
      eval "$RUNNING_CMD" >/dev/null 2>&1 || break
      sleep 1
    done
    ! eval "$RUNNING_CMD" >/dev/null 2>&1 || die "o Rice não fechou em 30 s. Feche o app e rode ./update.sh de novo." "Rice did not quit within 30 s. Quit the app and run ./update.sh again."
  fi

  say "refazendo o app ($INSTALL_CMD)…" "rebuilding the app ($INSTALL_CMD)…"
  if ! bash -c "$INSTALL_CMD"; then
    [ "$WAS_RUNNING" = 0 ] || eval "$OPEN_CMD" >/dev/null 2>&1 || true
    die "o build falhou; o Rice antigo continua em /Applications e foi reaberto. Veja as mensagens acima." "the build failed; the old Rice is still in /Applications and was reopened. See the messages above."
  fi
  if [ "$WAS_RUNNING" = 1 ]; then
    say "abrindo o Rice…" "opening Rice…"
    eval "$OPEN_CMD" >/dev/null 2>&1 || true
  fi
  say "pronto: o Rice está atualizado ($(git rev-parse --short HEAD))." "done: Rice is up to date ($(git rev-parse --short HEAD))."
}

main "$@"
exit $?
