#!/bin/bash
# Purge l historique au-dela de 7 jours et genere www/history.json, sous-echantillonne.
# Le CSV brut n est JAMAIS servi a la page : elle ne lit que le resume (~5 Ko).
set -uo pipefail
SRC=/volume1/docker/homelab/history.csv
OUT=/volume1/docker/homelab/www/history.json
NOW=$(date +%s)
[ -s "$SRC" ] || exit 0

# Rotation : awk sur du CSV traite 20 000 lignes en quelques millisecondes.
awk -F, -v c=$((NOW - 604800)) '$1+0 >= c' "$SRC" > "$SRC.tmp" && mv "$SRC.tmp" "$SRC"

# Deux resolutions : 24 h au pas de 10 min, 7 jours au pas d une heure.
# ⚠️ NC et la liste `champs` sont a tenir a jour quand collect.sh ajoute une
# colonne. Le commentaire d origine promettait le contraire, a tort.
# NC est passe de 13 a 16, puis a 18 le 24/08/2026 (nvme0, nvme1, eth0 PHY,
# puis nvme2 et nvme3 pour les deux emplacements M.2 encore libres), puis a
# 20 le meme jour (`site` et `siteup`, la sonde du site public), puis a 22
# (`qbdl` et `qbul`, les debits de qBittorrent), puis a 23 (`vpnup`, la
# joignabilite du port entrant du VPN, meme convention 1/2 que `siteup`).
#
# ⚠️ Contrairement a `site`, ZERO EST UNE VALEUR LEGITIME pour un debit :
# elle veut dire que rien ne transitait. Impossible donc de distinguer un
# creneau sans mesure d un creneau au repos, et la courbe affichera une
# ligne plate pendant les 24 heures qui precedent sa mise en service. Le
# probleme se resorbe seul et ne se represente jamais ; il ne justifiait pas
# la convention detournee retenue pour `siteup`.
#
# ⚠️ `siteup` vaut 1 (joignable) ou 2 (injoignable), jamais 0. La moyenne
# d un creneau se lit donc a l envers de l intuition : 1,00 signifie que
# tout allait bien, 2,00 que rien ne repondait, et 0 que la colonne n avait
# AUCUNE mesure sur ce creneau. C est cette troisieme valeur qui justifie de
# ne pas avoir choisi 0 pour la panne : la page ne pourrait pas les separer,
# et peindrait en rouge les 24 heures precedant la mise en service.
awk -F, -v now="$NOW" '
BEGIN { J=600; S=3600; NC=24 }
{
  t=$1+0
  # Comptage PAR COLONNE et non global. Les lignes anterieures a l ajout d une
  # mesure n ont pas le champ : les compter au denominateur diluerait la
  # moyenne vers zero pendant 24 h. Meme protection le jour ou un capteur
  # disparait — un disque retire ne doit pas fausser les autres series.
  if (t >= now-86400) { b=int(t/J); for (i=2; i<=NC; i++) if ($i != "") { Jv[b,i]+=$i; Jn[b,i]++ } }
  b=int(t/S); for (i=2; i<=NC; i++) if ($i != "") { Sv[b,i]+=$i; Sn[b,i]++ }
}
function bloc(nb, val, pas, deb, fin,   b, i, first) {
  first=1
  for (b=deb; b<=fin; b++) {
    if (nb[b,2] < 1) continue          # la colonne 2 (cpu) atteste du bloc
    if (!first) printf ","
    printf "[%d", b*pas
    for (i=2; i<=NC; i++) printf ",%.2f", (nb[b,i] > 0 ? val[b,i]/nb[b,i] : 0)
    printf "]"
    first=0
  }
}
END {
  printf "{\"j\":"; printf "["; bloc(Jn, Jv, J, int((now-86400)/J), int(now/J)); printf "]"
  printf ",\"s\":"; printf "["; bloc(Sn, Sv, S, int((now-604800)/S), int(now/S)); printf "]"
  printf ",\"champs\":[\"t\",\"cpu\",\"ram\",\"disque\",\"reseau\",\"charge\",\"temp\",\"lecture\",\"ecriture\",\"charge5\",\"charge15\",\"swap\",\"nvme\",\"nvme0\",\"nvme1\",\"eth0\",\"nvme2\",\"nvme3\",\"site\",\"siteup\",\"qbdl\",\"qbul\",\"vpnup\",\"kumaup\"]}\n"
}' "$SRC" > "$OUT.tmp" && mv "$OUT.tmp" "$OUT" && chmod 644 "$OUT"
