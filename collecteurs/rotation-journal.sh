#!/bin/sh
# Taille les journaux des taches planifiees, qui n ont aucune limite.
# Lance par cron (compte utilisateur) le dimanche a 5 h : `0 5 * * 0 .../rotation-journal.sh`.
#
# `favicons.log` avait atteint 19 600 lignes de la meme trace. Depuis le
# 09/10/2026 la meme regle vaut pour tous les journaux des taches du homelab et
# du VPN : au-dela d un mebioctet, on ne garde que les 200 derniers kilo-octets.
#
# ⚠️ TRONCATURE SUR PLACE (`cat tmp > journal`), JAMAIS DE `mv`. Certains
# ecrivains sont des processus au long cours dont cron redirige la sortie en
# `>>` (le veilleur des raccourcis) : ils gardent le descripteur ouvert des
# semaines. Un `mv` renommerait l inode, ils continueraient d y ecrire et le
# nouveau journal resterait vide. C est la raison d etre du `copytruncate` de
# logrotate, absent d UGOS.
# ⚠️ La premiere ligne gardee, coupee au milieu par `tail -c`, est retiree.

MAX=1048576        # au-dela d un mebioctet, on taille
GARDE=200000       # on conserve les 200 derniers kilo-octets

for J in \
  /volume1/docker/homelab/favicons.log \
  /volume1/docker/homelab/ratios.log \
  /volume1/docker/homelab/systeme.log \
  /volume1/docker/arr/gluetun/watchdog.log \
  /volume1/docker/arr/purge-cross-seed.log
do
  [ -f "$J" ] && [ -w "$J" ] || continue
  [ "$(stat -c %s "$J")" -gt "$MAX" ] || continue
  T=$(mktemp) || exit 1
  tail -c "$GARDE" "$J" | sed 1d > "$T" && cat "$T" > "$J"
  rm -f "$T"
  echo "$(date '+%F %T') journal tronqué, $GARDE octets conservés" >> "$J"
done
