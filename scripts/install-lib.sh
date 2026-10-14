# Funções compartilhadas por install.sh e update.sh (quem chama define LANG_UI). Não é para ser executado.
# Functions shared by install.sh and update.sh (the caller sets LANG_UI). Not meant to be run.
#
# Por que existe: o Rice aberto pode ser OUTRA cópia (um .dmg em Downloads, uma cópia antiga, o dist/ do clone). Aí o app novo é instalado em
# /Applications e o que continua na tela é o velho. Estas funções mostram, na tela, qual cópia está aberta, o que foi instalado e se há outras cópias.
# Why: the open Rice may be ANOTHER copy (a .dmg in Downloads, an old copy, the clone's dist/). Then the new app lands in /Applications and the
# old one stays on screen. These functions show, on screen, which copy is open, what was installed and whether there are other copies.
#
# Variáveis só para testes / test-only variables: RICE_UPDATE_RUNNING_CMD (imprime "pid caminho.app" por linha), RICE_UPDATE_MDFIND_CMD
# (imprime caminhos de .app), RICE_UPDATE_APP (o app instalado; padrão /Applications/Rice.app), RICE_UPDATE_LSREGISTER_CMD.

RICE_BUNDLE_ID="com.rice.app"
RICE_APP="${RICE_UPDATE_APP:-/Applications/Rice.app}"

rice_say() { if [ "${LANG_UI:-en}" = pt ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi; }

# Rice em execução, em QUALQUER caminho: uma linha "pid /caminho/Rice.app" por processo principal (os "Rice Helper" não entram).
rice_running() {
  if [ -n "${RICE_UPDATE_RUNNING_CMD:-}" ]; then
    eval "$RICE_UPDATE_RUNNING_CMD" 2>/dev/null || true
    return 0
  fi
  ps -axo pid=,args= 2>/dev/null | sed -nE 's#^ *([0-9]+) (.*/Rice\.app)/Contents/MacOS/Rice( .*)?$#\1 \2#p' || true
}

# Só os caminhos (um por linha, sem repetir).
rice_running_paths() { rice_running | sed -E 's/^[^ ]+ //' | sort -u; }

# O valor de uma chave de texto de um JSON simples ("chave": "valor"), sem depender de node/python.
rice_json_field() { sed -nE "s/.*\"$2\": *\"([^\"]*)\".*/\1/p" "$1" 2>/dev/null | head -n 1; }

rice_installed_commit() { rice_json_field "$RICE_APP/Contents/Resources/app/out/build-info.json" commit; }
rice_installed_version() { rice_json_field "$RICE_APP/Contents/Resources/app/package.json" version; }

# Outras cópias do Rice (Spotlight + as que estão abertas), fora do app instalado e do dist/ do clone. Nunca apaga nada.
rice_other_copies() {
  local clone_dist="${1:-}"
  {
    if [ -n "${RICE_UPDATE_MDFIND_CMD:-}" ]; then eval "$RICE_UPDATE_MDFIND_CMD" 2>/dev/null || true
    else mdfind "kMDItemCFBundleIdentifier == '$RICE_BUNDLE_ID'" 2>/dev/null || true; fi
    rice_running_paths
  } | sed '/^$/d' | sort -u | while IFS= read -r p; do
    [ "$p" = "$RICE_APP" ] && continue
    if [ -n "$clone_dist" ]; then case "$p" in "$clone_dist"/*) continue ;; esac; fi
    printf '%s\n' "$p"
  done
}

rice_warn_other_copies() {
  local others
  others="$(rice_other_copies "${1:-}")"
  [ -n "$others" ] || return 1
  rice_say "AVISO: há outras cópias do Rice em:" "WARNING: there are other copies of Rice in:"
  printf '%s\n' "$others" | sed 's/^/  - /'
  rice_say "  O Dock e o Spotlight podem estar abrindo uma delas. Apague-as ou abra sempre $RICE_APP (nada foi apagado)." "  The Dock and Spotlight may be opening one of them. Delete them or always open $RICE_APP (nothing was deleted)."
  return 0
}

# Registra o app no LaunchServices, para o Dock e o Spotlight apontarem para esta cópia.
rice_register() {
  if [ -n "${RICE_UPDATE_LSREGISTER_CMD:-}" ]; then eval "$RICE_UPDATE_LSREGISTER_CMD" >/dev/null 2>&1 || true; return 0; fi
  local ls=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
  [ -x "$ls" ] && "$ls" -f "$RICE_APP" >/dev/null 2>&1 || true
}

# "Rice atualizado: versão X, commit Y" e confere com o HEAD do clone. Devolve 0 se bate, 1 se não (já imprime o erro).
# $1 = commit esperado (HEAD do clone), $2 = "atualizado"|"instalado"
rice_verify_installed() {
  local want="$1" kind="${2:-atualizado}" commit version
  commit="$(rice_installed_commit)"
  version="$(rice_installed_version)"
  if [ "$kind" = instalado ]; then
    rice_say "Rice instalado: versão ${version:-?}, commit ${commit:-?} ($RICE_APP)" "Rice installed: version ${version:-?}, commit ${commit:-?} ($RICE_APP)"
  else
    rice_say "Rice atualizado: versão ${version:-?}, commit ${commit:-?} ($RICE_APP)" "Rice updated: version ${version:-?}, commit ${commit:-?} ($RICE_APP)"
  fi
  if [ -z "$commit" ]; then
    printf 'ERRO: não consegui ler o commit do app instalado (%s/Contents/Resources/app/out/build-info.json).\nERROR: could not read the installed app commit (%s/Contents/Resources/app/out/build-info.json).\n' "$RICE_APP" "$RICE_APP" >&2
    return 1
  fi
  if [ -n "$want" ] && [ "$commit" != "$want" ]; then
    printf 'ERRO: o app em %s é do commit %s, mas o clone está em %s: a instalação não trocou o app.\nERROR: the app at %s is from commit %s, but the clone is at %s: the install did not replace the app.\n' "$RICE_APP" "$commit" "$want" "$RICE_APP" "$commit" "$want" >&2
    return 1
  fi
  return 0
}
