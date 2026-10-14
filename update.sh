#!/bin/bash
# Atualiza o Rice instalado com ./install.sh: baixa o código novo (git pull --ff-only), fecha o app, refaz o build e abre de novo.
# Updates a Rice installed with ./install.sh: pulls the new code (git pull --ff-only), quits the app, rebuilds and opens it again.
# Nunca descarta alterações suas. / Never discards your changes.   Uso/Usage: ./update.sh [--force]   (--force reconstrói mesmo sem versão nova / rebuilds even if up to date)
#
# Fecha QUALQUER Rice aberto (em qualquer caminho), reinstala, registra o app, abre /Applications/Rice.app e confere na tela qual cópia está rodando.
# Quits ANY open Rice (at any path), reinstalls, registers the app, opens /Applications/Rice.app and checks on screen which copy is running.
#
# Variáveis só para testes / test-only variables: RICE_UPDATE_INSTALL_CMD, RICE_UPDATE_QUIT_CMD, RICE_UPDATE_OPEN_CMD,
# RICE_UPDATE_RUNNING_CMD (imprime "pid caminho.app" por linha / prints "pid path.app" per line), RICE_UPDATE_RECORDING_CMD (sai 0 se está gravando / exits 0 if recording),
# RICE_UPDATE_WAIT, RICE_UPDATE_APP, RICE_UPDATE_MDFIND_CMD, RICE_UPDATE_LSREGISTER_CMD (ver scripts/install-lib.sh / see scripts/install-lib.sh).

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

  # 1) precisa ser um clone git com remote e ramo acompanhado
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "esta pasta não é um clone git; o update.sh só atualiza quem instalou com git clone + ./install.sh." "this folder is not a git clone; update.sh only updates installs made with git clone + ./install.sh."
  [ -n "$(git remote)" ] || die "este clone não tem remote (git remote -v está vazio)." "this clone has no remote (git remote -v is empty)."
  git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1 || die "o ramo atual não acompanha nenhum ramo remoto (use: git branch --set-upstream-to=origin/main)." "the current branch does not track a remote branch (use: git branch --set-upstream-to=origin/main)."

  # 2) alterações locais: nunca descarta nada sozinho
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    git status --short --untracked-files=no >&2
    die "há alterações locais não salvas (acima). Guarde-as com: git stash   (e depois recupere com: git stash pop). Nada foi alterado." "there are local changes (above). Save them with: git stash   (and restore later with: git stash pop). Nothing was changed."
  fi

  # shellcheck source=scripts/install-lib.sh
  . ./scripts/install-lib.sh
  local ROOT; ROOT="$(pwd)"
  local WAIT="${RICE_UPDATE_WAIT:-15}" # segundos de espera por etapa (só os testes mudam)
  local INSTALL_CMD="${RICE_UPDATE_INSTALL_CMD:-./install.sh}"
  local QUIT_CMD="${RICE_UPDATE_QUIT_CMD:-osascript -e 'quit app id \"$RICE_BUNDLE_ID\"'}"
  local OPEN_CMD="${RICE_UPDATE_OPEN_CMD:-open \"$RICE_APP\"}"
  # o rice-audio é filho do app e só existe enquanto há gravação ou captura de áudio em andamento (em qualquer caminho do app)
  local RECORDING_CMD="${RICE_UPDATE_RECORDING_CMD:-pgrep -f 'Rice\\.app/.*rice-audio'}"

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

  # 6) fecha o Rice (qualquer cópia, em qualquer caminho), refaz o build (o install.sh só troca o app depois de o build dar certo) e abre de novo
  local WAS_RUNNING=0 running
  running="$(rice_running)"
  if [ -n "$running" ]; then
    WAS_RUNNING=1
    rice_say "Rice aberto agora em:" "Rice is open right now at:"
    printf '%s\n' "$running" | sed -E 's/^[^ ]+ /  - /'
    say "fechando o Rice…" "quitting Rice…"
    eval "$QUIT_CMD" >/dev/null 2>&1 || true
    local i
    for i in $(seq 1 "$WAIT"); do
      [ -z "$(rice_running)" ] && break
      sleep 1
    done
    # o que sobrou (outra cópia que não respondeu ao pedido de fechar): pede para encerrar pelo processo
    local pid
    for pid in $(rice_running | awk '$1 ~ /^[0-9]+$/ { print $1 }'); do kill -TERM "$pid" 2>/dev/null || true; done
    for i in $(seq 1 "$WAIT"); do
      [ -z "$(rice_running)" ] && break
      sleep 1
    done
    if [ -n "$(rice_running)" ]; then
      rice_running | sed -E 's/^[^ ]+ /  - /' >&2
      die "o Rice (acima) não fechou. Feche o app e rode ./update.sh de novo." "Rice (above) did not quit. Quit the app and run ./update.sh again."
    fi
  fi

  say "refazendo o app ($INSTALL_CMD)…" "rebuilding the app ($INSTALL_CMD)…"
  if ! RICE_FROM_UPDATE=1 bash -c "$INSTALL_CMD"; then
    [ "$WAS_RUNNING" = 0 ] || eval "$OPEN_CMD" >/dev/null 2>&1 || true
    die "o build falhou; o Rice antigo continua em /Applications e foi reaberto. Veja as mensagens acima." "the build failed; the old Rice is still in /Applications and was reopened. See the messages above."
  fi

  # 7) o que foi instalado, de verdade: registra o app, confere o commit e avisa de outras cópias
  rice_register
  local HEAD_SHA STATUS=0
  HEAD_SHA="$(git rev-parse --short=7 HEAD)"
  rice_verify_installed "$HEAD_SHA" atualizado || STATUS=1
  rice_warn_other_copies "$ROOT/dist" || true

  # 8) abre /Applications/Rice.app (caminho explícito, nunca "open -a Rice") e confere que o processo aberto é o de /Applications
  if [ "$WAS_RUNNING" = 1 ]; then
    say "abrindo ${RICE_APP}…" "opening ${RICE_APP}…"
    eval "$OPEN_CMD" >/dev/null 2>&1 || true
    local paths=""
    for i in $(seq 1 "$WAIT"); do
      paths="$(rice_running_paths)"
      [ -n "$paths" ] && break
      sleep 1
    done
    if [ -z "$paths" ]; then
      rice_say "AVISO: o Rice não apareceu aberto. Abra $RICE_APP à mão." "WARNING: Rice did not show up as open. Open $RICE_APP by hand."
    elif [ "$paths" != "$RICE_APP" ]; then
      rice_say "ERRO: o Rice aberto NÃO é o de $RICE_APP. Está aberto de:" "ERROR: the open Rice is NOT the one at $RICE_APP. It is open from:" >&2
      printf '%s\n' "$paths" | sed 's/^/  - /' >&2
      STATUS=1
    else
      rice_say "Rice aberto: $RICE_APP" "Rice is open: $RICE_APP"
    fi
  fi
  [ "$STATUS" = 0 ] || die "a atualização terminou, mas há algo a corrigir (veja acima)." "the update finished, but something needs fixing (see above)."
  say "pronto: o Rice está atualizado ($HEAD_SHA)." "done: Rice is up to date ($HEAD_SHA)."
}

main "$@"
exit $?
