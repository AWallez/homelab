#!/bin/bash
# Serie FINE de l historique : 24 h au pas d UNE MINUTE, pour les trois cartes
# qui se lisent au survol (Systeme, Temperatures, qBittorrent).
#
# POURQUOI UN FICHIER A PART. `history.json` est retelecharge toutes les 2 s
# avec le reste de la page. Y verser 1440 points le ferait passer de 50 a
# ~150 Ko trente fois par minute, pour un contenu qui ne change qu une fois par
# minute. Celui-ci est mis en cache par la page et renouvele toutes les 30 s.
#
# POURQUOI ONZE COLONNES ET PAS VINGT-QUATRE. Seulement celles que ces trois
# cartes tracent. Les autres n ont aucun besoin d etre fines et tripleraient le
# fichier pour rien.
#
# ⚠️ AUCUNE ROTATION ICI, contrairement a `history-build.sh`. Tourner chaque
# minute en reecrivant les 1,8 Mo du CSV userait le SSD pour rien : 2,6 Go
# d ecritures par jour. Ce script se contente de lire la QUEUE du fichier.
set -uo pipefail
SRC=/volume1/docker/homelab/history.csv
OUT=/volume1/docker/homelab/www/history-min.json
NOW=$(date +%s)
[ -s "$SRC" ] || exit 0

# 24 h a 30 s = 2880 lignes ; on prend large pour absorber les trous de collecte.
tail -n 4000 "$SRC" | awk -F, -v now="$NOW" '
BEGIN { M=60; NB=split("2 3 7 12 14 15 16 17 18 21 22 25", C, " "); mn=-1; mx=0 }
{
  # ⚠️ UNE HEURE ILLISIBLE OU FUTURE EST IGNOREE (03/11/2026). `mx` borne la boucle
  # des minutes plus bas : une ligne a `inf`, ou a un nombre demesure, la faisait
  # tourner sans fin, et cron en relancait une autre chaque minute. Le motif passe
  # d abord, car mawk repond vrai a `nan >= x` comme a `nan <= x`.
  if ($1 !~ /^[0-9]+$/) next
  t=$1+0
  if (t < now-86400 || t > now) next
  b=int(t/M)
  if (mn < 0 || b < mn) mn=b
  if (b > mx) mx=b
  # Comptage PAR COLONNE : une mesure ajoutee recemment manque aux lignes
  # anciennes, la compter au denominateur diluerait sa moyenne vers zero.
  for (k=1; k<=NB; k++) { i=C[k]; if (mesure($i)) { V[b,i]+=$i; N[b,i]++ } }
}
# Un nombre fini, ou la cellule vaut une cellule vide : voir `history-build.sh`.
function mesure(v) { return v ~ /^-?[0-9]+(\.[0-9]*)?([eE][-+]?[0-9]+)?$/ && v+0 < 1e300 && v+0 > -1e300 }
END {
  printf "{\"m\":["
  first=1
  for (b=mn; b<=mx; b++) {
    if (N[b,2] < 1) continue          # la colonne cpu atteste du creneau
    if (!first) printf ","
    printf "[%d", b*M
    # ⚠️ BOUCLE INDEXEE et non `for (k in C)` : l ordre de parcours d un
    # tableau associatif awk n est pas defini. Les colonnes sortiraient
    # melangees et la page lirait une temperature la ou elle attend un debit.
    for (k=1; k<=NB; k++) { i=C[k]; printf ",%.5g", (N[b,i] > 0 ? V[b,i]/N[b,i] : 0) }
    printf "]"
    first=0
  }
  printf "],\"champs\":[\"t\",\"cpu\",\"ram\",\"temp\",\"swap\",\"nvme0\",\"nvme1\",\"eth0\",\"nvme2\",\"nvme3\",\"qbdl\",\"qbul\",\"nvme4\"]}\n"
}' > "$OUT.tmp"

# Ecriture atomique et validee : la page ne doit jamais recevoir un JSON tronque.
# ⚠️ `jq -e .` NE SUFFIT PAS : jq accepte `[inf]` et `[nan]`, le navigateur non.
if [ -s "$OUT.tmp" ] && jq -e '[.. | numbers | select(isinfinite or isnan)] | length == 0' "$OUT.tmp" >/dev/null 2>&1; then
  mv "$OUT.tmp" "$OUT"; chmod 644 "$OUT"
else
  rm -f "$OUT.tmp"; echo "history-min.json non remplace : awk en echec" >&2
fi
