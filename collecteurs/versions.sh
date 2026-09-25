#!/bin/bash
# Inventaire des versions de TOUS les conteneurs, trie du plus recemment mis a
# jour au plus ancien. Alimente la liste unique de la fenetre des mises a jour.
#
# ⚠️ LE DEPOT NE CONTIENT PAS DE RELEVE REEL. `www/versions.json` y est une
# FIXTURE aux noms et aux dates fictifs, comme les autres JSON : GitHub Pages
# sert le depot tel quel, sans etape de construction, et la demo doit donc
# embarquer des donnees. Ce script, lui, est le vrai : c est celui qui tourne
# sur le NAS.
#
# ⚠️ CE N EST PAS UN JOURNAL D EVENEMENTS. Un journal dirait « le 14/09, sonarr
# est passe de ls322 a ls324 ». Ce fichier-ci dit « sonarr est en ls324, recree
# le 14/09 ». Trie par date decroissante, il repond aux deux questions a la
# fois, ce qui evite d avoir deux listes a lire dans la meme fenetre.
#
# ⚠️ IL EST RELANCE APRES CHAQUE MISE A JOUR REUSSIE, par le reglage
# `apres_mise_a_jour` de compose-auto-update, en plus de son passage quotidien.
# Sans cela, la carte montrait la date d avant la mise a jour jusqu au releve
# suivant, soit jusqu a un jour de retard.
#
# ⚠️ LA DATE EST CELLE DU CONTENEUR, PAS DE L IMAGE. `.Created` du conteneur est
# l instant de sa derniere RECREATION, donc de sa derniere mise a jour reelle.
# La date de l image dirait quand l editeur l a publiee, ce qui ne dit rien de
# ce qui tourne ici.
set -uo pipefail

OUT=/volume1/docker/homelab/www/versions.json
TMP=$(mktemp); NDJ=$(mktemp)
trap 'rm -f "$TMP" "$NDJ"' EXIT

# Pour les images linuxserver.io, l etiquette OCI `source` pointe vers le depot
# d EMPAQUETAGE, dont les notes parlent de la fabrication de l image et pas du
# logiciel. D ou cette table vers l amont ; tout le reste lit l etiquette.
#
# ⚠️ DEUX ETIQUETTES SONT CARREMENT FAUSSES, mesure du 14/09/2026 :
#   - arr-gluetun tourne sur l image OFFICIELLE `qmcgaw/gluetun:v3.41.3`, mais
#     son etiquette `source` annonce `passteque/gluetun`, un fork. Suivre
#     l etiquette envoyait lire les notes du mauvais depot.
#   - portfolio-caddy est une image construite ici (`caddy-ratelimit:local`) et
#     herite de l etiquette de sa base, qui pointe vers le depot d empaquetage.
# Morale : une etiquette OCI est declarative, pas verifiee. Elle sert de defaut
# raisonnable, pas de source d autorite.
depot() {
  case "$1" in
    arr-sonarr)       echo https://github.com/Sonarr/Sonarr ;;
    arr-radarr)       echo https://github.com/Radarr/Radarr ;;
    arr-prowlarr)     echo https://github.com/Prowlarr/Prowlarr ;;
    arr-bazarr)       echo https://github.com/morpheus65535/bazarr ;;
    arr-qbittorrent)  echo https://github.com/qbittorrent/qBittorrent ;;
    arr-gluetun)      echo https://github.com/qdm12/gluetun ;;
    portfolio-caddy)  echo https://github.com/caddyserver/caddy ;;
    dockge)           echo https://github.com/louislam/dockge ;;
    jellyfin)         echo https://github.com/jellyfin/jellyfin ;;
    # Images tierces sans etiquette `source` exploitable.
    umami)            echo https://github.com/umami-software/umami ;;
    skyrim-server)    echo https://github.com/tiltedphoques/TiltedEvolution ;;
    # ⚠️ PAS UN DEPOT GITHUB. Les notes de PostgreSQL vivent sur postgresql.org,
    # qui n a ni /releases ni /releases/tag. La distinction est faite plus bas.
    umami-db|portfolio-postgres) echo https://www.postgresql.org/docs/release/ ;;
    # Images construites ici : l amont, c est son propre depot.
    # ⚠️ CES DEPOTS NE PUBLIENT AUCUNE RELEASE (verifie le 14/09/2026 : zero sur
    # les deux). Pointer vers /releases ouvrirait une page vide ; les commits
    # sont la seule trace de ce qui a change, d ou une URL complete qui echappe
    # au traitement GitHub plus bas.
    homelab)          echo https://github.com/AWallez/homelab/commits ;;
    portfolio-web|portfolio-api|portfolio-admin) echo https://github.com/AWallez/portfolio/commits ;;
    *) docker inspect "$1" --format '{{ index .Config.Labels "org.opencontainers.image.source" }}' 2>/dev/null ;;
  esac
}

# ⚠️ ON NE VERIFIE L ETIQUETTE EN HTTP QUE SI LA VERSION A CHANGE. Verifier les
# 27 a chaque passage couterait plus de deux minutes de requetes pour un
# resultat identique 99 fois sur 100. L URL precedente est reprise telle quelle
# quand la version n a pas bouge.
# ⚠️ CHAQUE PROJET NOMME SES ETIQUETTES A SA FACON. Mesure du 14/09/2026 sur
# trois conteneurs qui tombaient tous sur la liste faute de mieux :
#   vaultwarden  -> « 1.37.2 »        aucun prefixe
#   cross-seed   -> « v6.13.7 »       alors que son etiquette OCI dit « version-6.13.7 »
#   qbittorrent  -> « release-5.2.3 » alors que la sienne dit « 5.2.3_v2.0.14-ls475 »
# Forcer un « v » devant le numero, comme le faisait la premiere version, ratait
# donc deux cas sur trois. On essaie les formes connues dans l ordre et on garde
# la premiere qui repond. Au pire cinq requetes, et seulement quand la version a
# change : le cache absorbe tout le reste.
etiquette() {
  repo=$1; ver=$2
  base=${ver%-ls*}        # retire le numero de build linuxserver
  core=${base%%_*}        # 5.2.3_v2.0.14  -> 5.2.3
  core=${core#version-}   # version-6.13.7 -> 6.13.7
  core=${core#v}          # on normalise, le prefixe est rajoute ci-dessous
  for c in "v$core" "$core" "release-$core" "$base" "v$base"; do
    [ -n "$c" ] || continue
    if [ "$(curl -sL -o /dev/null -w '%{http_code}' -m 8 -I "$repo/releases/tag/$c" 2>/dev/null)" = "200" ]; then
      echo "$c"; return 0
    fi
  done
  return 1
}

ANCIEN='{}'
if [ -s "$OUT" ]; then
  ANCIEN=$(jq -c '[.items[] | {key:.n, value:{v:.v, u:.u}}] | from_entries' "$OUT" 2>/dev/null || echo '{}')
fi

# Un seul `docker inspect` pour tout le monde : un par conteneur coutait deux
# secondes sur vingt-sept, meme lecon que dans containers.sh.
docker inspect $(docker ps -q) \
  --format '{{.Name}}|{{.Created}}|{{ index .Config.Labels "org.opencontainers.image.version" }}|{{.Config.Image}}|{{.Image}}' \
  2>/dev/null | sed 's#^/##' > "$TMP"

while IFS='|' read -r nom cree ver image sha; do
  [ -n "${nom:-}" ] || continue

  # Sans etiquette de version, on retombe sur l empreinte courte de l image :
  # elle ne dit pas grand-chose a l oeil mais elle CHANGE a chaque mise a jour,
  # ce qui suffit a montrer que quelque chose a bouge.
  if [ -z "$ver" ] || [ "$ver" = "<no value>" ]; then
    ver=$(echo "$sha" | cut -c8-19)
    marque=1
  else
    marque=0
  fi

  ts=$(date -d "$cree" +%s 2>/dev/null || echo 0)
  jour=$(date -d "$cree" '+%d/%m' 2>/dev/null || echo '?')

  # Reprise de l URL connue si la version est inchangee.
  url=$(echo "$ANCIEN" | jq -r --arg n "$nom" --arg v "$ver" \
        'if (.[$n].v // "") == $v then (.[$n].u // "") else "" end' 2>/dev/null)

  if [ -z "$url" ]; then
    repo=$(depot "$nom")
    if [ -n "$repo" ] && [ "$repo" != "<no value>" ]; then
      # ⚠️ TOUTES LES CIBLES NE SONT PAS DES DEPOTS GITHUB. postgresql.org n a ni
      # /releases ni /releases/tag : y coller ces suffixes produirait une URL
      # cassee. Une entree qui n a pas la forme github.com/proprietaire/depot est
      # donc prise telle quelle, sans rien y ajouter.
      if echo "$repo" | grep -qE '^https://github\.com/[^/]+/[^/]+/?$'; then
        repo=${repo%/}
        url="$repo/releases"
        # L etiquette exacte n existe pas toujours : on la teste avant de la
        # proposer. Un lien mort vaut moins qu un lien qui demande un defilement.
        # ⚠️ `-L` EST INDISPENSABLE dans `etiquette()`. GitHub repond 301 sur
        # bien des etiquettes valides (depot renomme, casse differente) : sans
        # suivre la redirection on rejetait des liens parfaitement bons. Mesure
        # du 14/09 : qdm12/gluetun/releases/tag/v3.41.3 renvoie 301.
        if [ "$marque" = "0" ]; then
          if t=$(etiquette "$repo" "$ver"); then url="$repo/releases/tag/$t"; fi
        fi
      else
        url="$repo"
      fi
    fi
  fi

  jq -nc --arg n "$nom" --arg v "$ver" --arg d "$jour" --argjson ts "${ts:-0}" \
         --arg u "${url:-}" --argjson h "$marque" \
         '{n:$n,v:$v,d:$d,ts:$ts,u:$u,h:($h==1)}' >> "$NDJ"
done < "$TMP"

if [ ! -s "$NDJ" ]; then
  echo "aucun conteneur releve, fichier inchange" >&2
  exit 1
fi

# Tri decroissant sur l horodatage : le dernier mis a jour en tete.
jq -s --arg maj "$(date '+%d/%m %H:%M')" \
   '{maj:$maj, total:length, items:(sort_by(-.ts))}' "$NDJ" > "$OUT.tmp" \
  && mv "$OUT.tmp" "$OUT" && chmod 644 "$OUT"

echo "$(jq '.total' "$OUT") conteneurs releves"
jq -r '.items[] | "  " + .d + "  " + (.n | .[0:18]) + "\t" + .v' "$OUT" | head -30
