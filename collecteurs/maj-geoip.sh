#!/bin/bash
# Bases de geolocalisation pour la carte Acces (08/10/2026) : DB-IP Lite,
# villes et operateurs, gratuites, sans compte, licence CC BY 4.0
# (« IP Geolocation by DB-IP », https://db-ip.com). Refaites chaque mois.
#
#   cron root : 40 4 3 * *  /volume1/docker/homelab/maj-geoip.sh >> /var/log/maj-geoip.log 2>&1
#
# Pourquoi des fichiers locaux plutot qu un service en ligne : aucune adresse
# ne quitte le NAS, pas de quota, et la carte marche sans Internet.
# `systeme.py` projette les fichiers en memoire (mmap) : 127 Mo sur le disque,
# presque rien en RAM.
#
# ⚠️ ON N ECRASE JAMAIS UNE BONNE BASE PAR UNE MAUVAISE : le fichier est
# telecharge a cote, decompresse, verifie (signature de fin des fichiers
# mmdb), et seulement alors renomme. En cas d echec, l ancienne reste en place.
# Le 1er du mois la nouvelle base n est pas toujours publiee : on essaie le
# mois en cours, puis le precedent.
set -u
DEST="${1:-/volume1/docker/homelab/geoip}"
mkdir -p "$DEST" || exit 1
ok=0
for nom in city asn; do
  fait=""
  for mois in "$(date +%Y-%m)" "$(date -d '-1 month' +%Y-%m)"; do
    url="https://download.db-ip.com/free/dbip-$nom-lite-$mois.mmdb.gz"
    tmp=$(mktemp "$DEST/.telechargement.XXXXXX") || exit 1
    if curl -fsS --max-time 900 --proto =https --max-filesize 200000000 -o "$tmp" "$url" \
       && gunzip -c "$tmp" > "$tmp.mmdb" \
       && tail -c 131072 "$tmp.mmdb" | grep -qa 'MaxMind.com'; then
      chmod 644 "$tmp.mmdb"
      mv -f "$tmp.mmdb" "$DEST/dbip-$nom-lite.mmdb"
      fait="$mois"
    fi
    rm -f "$tmp" "$tmp.mmdb"
    [ -n "$fait" ] && break
  done
  if [ -n "$fait" ]; then
    echo "$(date '+%F %T') $nom : base $fait installee"
    ok=$((ok + 1))
  else
    echo "$(date '+%F %T') $nom : ECHEC, base precedente gardee" >&2
  fi
done
[ "$ok" -eq 2 ]
