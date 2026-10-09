#!/bin/sh
# Veilleur sur les raccourcis de la page d'accueil (22/08/2026).
#
# Dès que shortcuts.json est réécrit (ajout, modification d'URL, suppression),
# on relance la récolte des favicons. Remplace l'attente d'une minute du cron
# par une réaction quasi immédiate.
#
# ⚠️ On surveille le DOSSIER, pas le fichier : nginx écrit un fichier temporaire
# puis le renomme lors d'un PUT WebDAV, ce qui change l'inode et rendrait sourde
# une surveillance posée sur le fichier lui-même.
#
# Lancé par cron (@reboot, et toutes les 5 min en filet), sous flock pour qu'il
# n'y ait jamais deux veilleurs en même temps.

DOSSIER=/volume1/docker/homelab/www/data
CIBLE=shortcuts.json
SCRIPT=/volume1/docker/homelab/favicons.py

while true; do
  f=$(inotifywait -q -e close_write,moved_to --format '%f' "$DOSSIER" 2>/dev/null) || {
    sleep 30      # dossier absent ou inotify indisponible : on retente plus tard
    continue
  }
  [ "$f" = "$CIBLE" ] || continue
  sleep 1         # laisse l'écriture se terminer avant de lire le fichier
  echo "$(date '+%F %T') $CIBLE modifié — récolte des icônes"
  /usr/bin/python3 "$SCRIPT"
done
