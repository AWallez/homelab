#!/bin/bash
# Mesure fiable de la memoire d un conteneur.
#   cgroup  = ce qui occupe reellement la RAM (chaque page comptee une fois)
#   PSS     = idem, vu depuis les processus, le partage reparti equitablement
#   evacue  = ce qui est parti en zram ou en swap et ne se voit pas dans le cgroup
# Sans la colonne "evacue", on croit gagner ce qu on a seulement deplace.
for c in "$@"; do
  cg=$(docker stats --no-stream --format '{{.MemUsage}}' "$c" 2>/dev/null | cut -d/ -f1 | tr -d ' ')
  p=0; s=0
  for x in $(docker top "$c" -eo pid 2>/dev/null | tail -n +2); do
    a=$(awk '/^Pss:/{print $2; exit}' "/proc/$x/smaps_rollup" 2>/dev/null)
    b=$(awk '/^VmSwap:/{print $2; exit}' "/proc/$x/status" 2>/dev/null)
    p=$((p + ${a:-0})); s=$((s + ${b:-0}))
  done
  printf '%-18s cgroup %-10s PSS %4d Mo + %3d evacues = %4d Mo reels\n' \
    "$c" "$cg" $((p/1024)) $((s/1024)) $(((p+s)/1024))
done
