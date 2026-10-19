#!/bin/bash
# Lido (source) por build-translate.sh e stage-native.sh: `offline_translation_enabled` diz se a tradução offline entra neste build.
# Fonte: RICE_OFFLINE_TRANSLATION=1|0 se definida; senão a constante OFFLINE_TRANSLATION de src/main/translate/flags.ts.
offline_translation_enabled() {
  case "${RICE_OFFLINE_TRANSLATION:-}" in
    1) return 0 ;;
    0) return 1 ;;
  esac
  grep -Eq '^export const OFFLINE_TRANSLATION = true;' src/main/translate/flags.ts
}
