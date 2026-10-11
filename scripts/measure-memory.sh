#!/bin/bash
# Uso: scripts/measure-memory.sh <pid-do-electron-main> [rótulo]
# Soma RSS e footprint (footprint(1)) por processo da árvore do Rice, mais órfãos
# (whisper-server / rice-audio / rice-detector com ppid=1). Saída: tabela em MB + linha TOTAL.
# RICE_MEASURE_IGNORE="pid pid" ignora órfãos que já existiam antes da medição.
# Não mede nada fora da árvore do pid informado (o app do usuário fica intocado).
set -u
ROOT="${1:?uso: measure-memory.sh <pid> [rótulo]}"
LABEL="${2:-}"

tree() {
  local pid=$1
  echo "$pid"
  for c in $(pgrep -P "$pid" 2>/dev/null); do tree "$c"; done
}

kind() {
  case "$1" in
    *"--type=gpu-process"*) echo gpu ;;
    *"--type=renderer"*) echo renderer ;;
    *"--type=utility"*) echo utility ;;
    *whisper-server*|*fake-whisper*) echo whisper-server ;;
    *rice-audio*) echo rice-audio ;;
    *rice-detector*) echo rice-detector ;;
    *Electron*|*electron*) echo main ;;
    *) echo other ;;
  esac
}

# footprint em MB (phys_footprint); vazio se o processo sumiu
fp_mb() {
  footprint -p "$1" 2>/dev/null | awk '/phys_footprint:/ {v=$2; u=$3; if (u=="KB") v/=1024; else if (u=="GB") v*=1024; else if (u=="B") v/=1048576; printf "%.1f", v; exit}'
}

orphans() {
  ps -axo pid=,ppid=,command= | awk -v ign=" ${RICE_MEASURE_IGNORE:-} " 'index(ign, " " $1 " ")==0 && $2==1 && ($3 ~ /whisper-server|rice-audio|rice-detector/ || $0 ~ /fake-rice-audio|fake-whisper/) {print $1}'
}

printf '%s\n' "# ${LABEL:-snapshot} $(date '+%H:%M:%S')"
printf '%-8s %-15s %9s %12s\n' PID TIPO RSS_MB FOOTPRINT_MB
tr=0; tf=0
for pid in $(tree "$ROOT") $(orphans | sed 's/^/orf:/'); do
  tag=""; case "$pid" in orf:*) pid=${pid#orf:}; tag="(órfão) " ;; esac
  cmd=$(ps -o command= -p "$pid" 2>/dev/null) || continue
  [ -z "$cmd" ] && continue
  rss=$(ps -o rss= -p "$pid" | awk '{printf "%.1f", $1/1024}')
  fp=$(fp_mb "$pid"); fp=${fp:-0}
  printf '%-8s %-15s %9s %12s\n' "$pid" "$tag$(kind "$cmd")" "$rss" "$fp"
  tr=$(awk -v a="$tr" -v b="$rss" 'BEGIN{print a+b}'); tf=$(awk -v a="$tf" -v b="$fp" 'BEGIN{print a+b}')
done
printf '%-8s %-15s %9.1f %12.1f\n' - TOTAL "$tr" "$tf"
