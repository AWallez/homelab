#!/bin/bash
# Releve par conteneur, toutes les 5 min. `docker stats` prend 1 a 2 s :
# beaucoup trop lent pour le collecteur rapide, largement assez fin pour reperer une derive.
set -uo pipefail
SRC=/volume1/docker/homelab/containers.csv
OUT=/volume1/docker/homelab/www/containers.json
NOW=$(date +%s)

# Memoire EVACUEE par conteneur, lue dans son cgroup : `docker stats` ne la voit
# pas, alors qu elle represente parfois l essentiel (umami : 73 Mo vus, 303 reels).
SW=$(mktemp); trap 'rm -f "$SW"' EXIT
docker ps --no-trunc --format '{{.ID}};{{.Names}}' 2>/dev/null | while IFS=';' read -r id nom; do
  f="/sys/fs/cgroup/system.slice/docker-$id.scope/memory.swap.current"
  v=0; [ -r "$f" ] && v=$(cat "$f" 2>/dev/null || echo 0)
  printf '%s;%s\n' "$nom" "$((v / 1048576))"
done > "$SW"
# Redemarrages AUTOMATIQUES et anciennete du dernier demarrage. `docker stats`
# ne les connait pas, et c est une panne reellement invisible : un conteneur qui
# tombe et se releve toutes les deux minutes reste vert pour Uptime Kuma, qui
# l observe entre deux redemarrages.
# ⚠️ `RestartCount` est CUMULATIF depuis la creation : il dit « a deja plante »,
# pas « en panne maintenant ». Croise avec l anciennete du demarrage, il devient
# un signal d incident EN COURS. C est le couple qui informe, pas le compteur.
# ⚠️ `docker restart` lance a la main N INCREMENTE PAS ce compteur, ni la
# recreation par compose-auto-update : seule la politique de redemarrage le
# fait. Le signal ne se declenchera donc pas sur tes propres interventions.
# ⚠️ UN SEUL `docker inspect` pour tout le monde : un par conteneur coutait deux
# secondes sur vingt-sept.
RS=$(mktemp); trap 'rm -f "$SW" "$RS"' EXIT
docker inspect $(docker ps -q) \
  --format '{{.Name}};{{.RestartCount}};{{.State.StartedAt}}' 2>/dev/null \
  | sed 's#^/##' | while IFS=';' read -r nom rs st; do
      d=$(date -d "$st" +%s 2>/dev/null || echo 0)
      printf '%s;%s;%s\n' "$nom" "${rs:-0}" "$((NOW - d))"
    done > "$RS"


docker stats --no-stream --format '{{.Name}};{{.CPUPerc}};{{.MemPerc}}' 2>/dev/null \
  | awk -F';' -v t="$NOW" -v swf="$SW" '
      BEGIN { while ((getline l < swf) > 0) { split(l, a, ";"); sw[a[1]] = a[2] } }
      { gsub("%","",$2); gsub("%","",$3); print t";"$1";"$2";"$3";"(sw[$1]+0) }' >> "$SRC"
[ -s "$SRC" ] || exit 0
# ⚠️ 25 H ET UNE PURGE PAR HEURE (08/10/2026). La page ne lit plus que les
# dernieres 24 h (la moyenne `mem24`) ; garder 7 jours et tout reecrire toutes
# les 5 min faisait 0,55 Go d ecritures par jour pour une fenetre que plus rien
# ne lisait. La purge se fait au premier passage de chaque heure.
if [ "$(date +%-M)" -lt 5 ]; then
  awk -F';' -v c=$((NOW - 90000)) '$1+0 >= c' "$SRC" > "$SRC.tmp" && mv "$SRC.tmp" "$SRC"
fi

# --- Journal des redemarrages automatiques, sur 24 h ---
# ⚠️ POURQUOI UN JOURNAL ET PAS UN SIMPLE `age < 24 h`. `age` mesure le dernier
# demarrage QUELLE QU EN SOIT LA CAUSE. Un conteneur ayant plante il y a trois
# semaines garde `rs = 1` pour toujours ; redemarre a la main aujourd hui, il
# serait annonce comme s etant releve tout seul. On n enregistre donc que les
# AUGMENTATIONS du compteur, horodatees : c est le seul fait qui prouve que la
# politique de redemarrage a agi, et il porte sa propre date.
# ⚠️ Une alerte d une heure sur une page qu on ne regarde pas toutes les heures
# n alerte personne — c est le reproche fait au watchdog du port VPN le meme
# jour. La fenetre est donc de 24 h.
EVF=/volume1/docker/homelab/restarts.csv
PREV=/volume1/docker/homelab/restarts.state
if [ -f "$PREV" ]; then
  awk -F';' -v now="$NOW" '
    NR==FNR { p[$1] = $2; next }
    ($1 in p) && $2+0 > p[$1]+0 { printf "%d;%s;%d\n", now, $1, $2 }' "$PREV" "$RS" >> "$EVF"
fi
cut -d';' -f1,2 "$RS" > "$PREV"
[ -f "$EVF" ] && { awk -F';' -v c=$((NOW - 86400)) '$1+0 >= c' "$EVF" > "$EVF.tmp"; mv "$EVF.tmp" "$EVF"; }
EVJ=$(awk -F';' 'BEGIN{printf "["}
  {printf "%s{\"n\":\"%s\",\"t\":%s}", (NR>1?",":""), $2, $1}
  END{printf "]"}' "$EVF" 2>/dev/null)
echo "$EVJ" | jq -e . >/dev/null 2>&1 || EVJ='[]'


LAST=$(tail -120 "$SRC" | awk -F';' '{if($1+0>m) m=$1+0} END{print m+0}')
awk -F';' -v last="$LAST" -v c=$((NOW - 86400)) -v rsf="$RS" '
  BEGIN { while ((getline l < rsf) > 0) { split(l, b, ";"); rs[b[1]] = b[2]; ag[b[1]] = b[3] } }
  $1+0 == last { cc[$2]=$3; cm[$2]=$4; cw[$2]=$5+0; vu[$2]=1 }
  $1+0 >= c    { n[$2]++; sc[$2]+=$3; sm[$2]+=$4 }
  END {
    printf "{\"t\":%d,\"c\":[", last
    first=1
    for (k in vu) {
      if (!first) printf ","
      printf "{\"n\":\"%s\",\"cpu\":%.2f,\"mem\":%.2f,\"swap\":%d,\"cpu24\":%.2f,\"mem24\":%.2f,\"rs\":%d,\"age\":%d}",
             k, cc[k], cm[k], cw[k], (n[k] ? sc[k]/n[k] : 0), (n[k] ? sm[k]/n[k] : 0),
             (rs[k]+0), (ag[k]+0)
      first=0
    }
    printf "]}\n"
  }' "$SRC" > "$OUT.raw" \
  && jq -c --argjson ev "$EVJ" '. + {ev: $ev}' "$OUT.raw" > "$OUT.tmp" \
  && rm -f "$OUT.raw" && mv "$OUT.tmp" "$OUT" && chmod 644 "$OUT"

# --- Historique par conteneur : RETIRE le 08/10/2026 ---
# `containers-hist.json` (7 jours au pas de 30 min) n etait plus lu par la page
# depuis le 05/10 : la fenetre des conteneurs s appuie sur `containers.json`.
