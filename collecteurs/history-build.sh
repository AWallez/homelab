#!/bin/bash
# Purge l historique au-dela de 7 jours et genere www/history.json, sous-echantillonne.
# Le CSV brut n est JAMAIS servi a la page : elle ne lit que le resume.
set -uo pipefail
SRC=/volume1/docker/homelab/history.csv
OUT=/volume1/docker/homelab/www/history.json
VERROU=/var/lock/homelab-history.lock
NOW=$(date +%s)
[ -s "$SRC" ] || exit 0

# ⚠️ PURGE UNE FOIS PAR JOUR, PLUS A CHAQUE MINUTE (08/10/2026). Reecrire les
# 2 Mo du CSV chaque minute faisait 2,8 Go d ecritures par jour, pour retirer
# deux lignes a chaque fois. On ne purge plus que lorsque la plus vieille ligne
# depasse 8 jours : environ une fois par jour. La page, elle, ne lit que 7 jours.
# ⚠️ SOUS VERROU, partage avec `collect.sh` qui AJOUTE a ce fichier : une ligne
# ecrite entre la lecture d awk et le `mv` etait perdue sans bruit.
PREM=$(head -c 32 "$SRC" | cut -d, -f1)
case "$PREM" in ''|*[!0-9]*) PREM=0;; esac
if [ "$PREM" -lt $((NOW - 691200)) ]; then
  (
    flock -w 10 9 || exit 0
    awk -F, -v c=$((NOW - 604800)) '$1+0 >= c' "$SRC" > "$SRC.tmp" && mv "$SRC.tmp" "$SRC"
  ) 9>"$VERROU"
fi

# Deux resolutions : 24 h au pas de 10 min, 7 jours au pas d une heure.
#
# ⚠️ SEULES LES COLONNES QUE LA PAGE TRACE SONT PUBLIEES (08/10/2026). Le fichier
# portait les 24 colonnes du CSV ; six n etaient lues par personne (disque,
# charge et ses moyennes, lectures, ecritures), et la serie de 7 jours, 54 % du
# fichier, ne sert qu a `siteup` et aux disques. Les nombres passent aussi a
# quatre chiffres significatifs : un debit en octets n a pas besoin de ses
# centimes.
# ⚠️ LA SERIE DE 7 JOURS PORTE AUSSI LES COURBES DES CARTES (09/10/2026) :
# processeur, memoire, swap, temperatures, reseau et qBittorrent, pour le
# bouton « 7 j » de chaque graphe. Environ 8 Ko de plus.
# ⚠️ ET LES RUBANS DE VPN ET D UPTIME KUMA (18/10/2026) : `vpnup` et `kumaup`,
# meme convention 1/2 que `siteup` ; leur moyenne horaire fait la case de
# l heure (ambre si une partie manquait, rouge si rien n a repondu).
# ⚠️ `J` et `S` sont les NUMEROS DE COLONNE du CSV (1 = l heure), dans l ordre
# d ecriture de collect.sh ; `NJ` et `NS` leurs noms, dans le meme ordre. La page
# lit chaque serie PAR NOM (`champs`, `champs_s`) : ajouter une colonne ici ne
# deplace rien. Toute colonne ajoutee a collect.sh doit etre ajoutee ICI pour
# atteindre la page.
#
# ⚠️ Contrairement a `site`, ZERO EST UNE VALEUR LEGITIME pour un debit :
# elle veut dire que rien ne transitait. Impossible donc de distinguer un
# creneau sans mesure d un creneau au repos.
# ⚠️ `siteup` vaut 1 (joignable) ou 2 (injoignable), jamais 0 : la moyenne d un
# creneau se lit 1,00 tout va bien, 2,00 rien ne repondait, et 0 AUCUNE mesure.
awk -F, -v now="$NOW" '
BEGIN {
  P=600; Q=3600
  nj = split("2 3 5 7 12 13 14 15 16 17 18 19 20 21 22 23 24 25", J, " ")
  split("cpu ram reseau temp swap nvme nvme0 nvme1 eth0 nvme2 nvme3 site siteup qbdl qbul vpnup kumaup nvme4", NJ, " ")
  ns = split("14 15 17 18 20 25 2 3 5 7 12 16 21 22 23 24", S, " ")
  split("nvme0 nvme1 nvme2 nvme3 siteup nvme4 cpu ram reseau temp swap eth0 qbdl qbul vpnup kumaup", NS, " ")
}
{
  t=$1+0
  # Comptage PAR COLONNE et non global : les lignes anterieures a l ajout d une
  # mesure n ont pas le champ, et diluer la moyenne vers zero fausserait 24 h.
  # Un creneau existe s il a au moins une ligne avec la colonne 2 (cpu) : `Je`
  # et `Se` les comptent A PART. ⚠️ Compter l existence dans `Sn[b,2]`, comme
  # avant, doublait le compte du processeur des qu il est entre dans `S`, et
  # sa moyenne sur 7 jours tombait de moitie.
  if (t >= now-86400) { b=int(t/P); if ($2 != "") Je[b]++; for (k=1; k<=nj; k++) { i=J[k]; if ($i != "") { Jv[b,i]+=$i; Jn[b,i]++ } } }
  b=int(t/Q); if ($2 != "") Se[b]++
  for (k=1; k<=ns; k++) { i=S[k]; if ($i != "") { Sv[b,i]+=$i; Sn[b,i]++ } }
}
function bloc(ex, nb, val, cols, n, pas, deb, fin,   b, k, i, first) {
  first=1
  for (b=deb; b<=fin; b++) {
    if (ex[b] < 1) continue
    if (!first) printf ","
    printf "[%d", b*pas
    for (k=1; k<=n; k++) { i=cols[k]; printf ",%.4g", (nb[b,i] > 0 ? val[b,i]/nb[b,i] : 0) }
    printf "]"
    first=0
  }
}
function noms(l, n,   k) { printf "[\"t\""; for (k=1; k<=n; k++) printf ",\"%s\"", l[k]; printf "]" }
END {
  printf "{\"j\":["; bloc(Je, Jn, Jv, J, nj, P, int((now-86400)/P), int(now/P)); printf "]"
  printf ",\"s\":["; bloc(Se, Sn, Sv, S, ns, Q, int((now-604800)/Q), int(now/Q)); printf "]"
  printf ",\"champs\":"; noms(NJ, nj)
  printf ",\"champs_s\":"; noms(NS, ns)
  printf "}\n"
}' "$SRC" > "$OUT.tmp" && mv "$OUT.tmp" "$OUT" && chmod 644 "$OUT"
