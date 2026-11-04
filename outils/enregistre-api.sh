#!/bin/bash
# Enregistre les reponses des API que lit collect.sh, pour rejouer ses filtres
# jq SANS LE NAS (tests/collect.test.js, « reponses enregistrees »).
#
#   sudo bash enregistre-api.sh [collect.sh] [dossier]
#
# ⚠️ A LANCER SUR LE NAS, la ou tourne collect.sh, avec les memes droits. Par
# defaut : /volume1/docker/homelab/collect.sh, et le dossier /tmp/homelab-reponses.
# collect.sh y tourne en `--essai` : la meme collecte, mais rien d ecrit ailleurs
# que /tmp/collect-essai.json (ni historique, ni etats, ni data.json). Un `curl`
# ENREGISTREUR, place en tete du PATH, appelle le vrai et garde ce qu il rend, un
# fichier par requete reussie, nomme par `cle`. Aucune authentification n est
# recopiee ici : celles de collect.sh servent telles quelles.
#
# ⚠️ CE SONT DES DONNEES PERSONNELLES. Jetons, mots de passe et passkeys sont
# masques (`nettoie`), mais il reste des titres, des noms d appareils, des
# adresses du reseau local : le dossier ne doit JAMAIS entrer dans un depot, ni
# etre partage. Lance par sudo, le dossier revient a qui l a lance : c est lui
# qui rejoue, sans sudo. Pour rejouer depuis une copie du depot, sur le NAS meme
# (l archive de main suffit, sans git) :
#   HOMELAB_REPONSES=/tmp/homelab-reponses node --test tests/*.test.js
# ou depuis le poste, apres `scp -r nas:/tmp/homelab-reponses ~/homelab-reponses`.
# Ne sont PAS enregistres : les sorties de `docker exec` (la configuration de
# WireGuard porte sa cle privee), ni les certificats, lus par openssl.
set -uo pipefail

# Le nom du fichier de reponse d une requete, depuis son URL : le port (« web »
# sans port explicite), puis le chemin et la requete, SANS L HOTE, propre a
# l installation. Les identifiants (UUID, slug de la page de statut Kuma) et les
# instants (`startAt=1793...`) sont remplaces : sans quoi le rejeu, qui tourne a
# une autre heure et sous une autre configuration, ne retrouverait jamais l URL.
# ⚠️ Le rejeu reprend cette fonction telle quelle : la changer rend caduques les
# reponses deja enregistrees.
cle() {
  local u=${1#*://} hote chemin port s=${HOMEPAGE_VAR_KUMA_SLUG:-} motif
  hote=${u%%/*}; chemin=${u:${#hote}}
  case "$hote" in *:*) port=${hote##*:} ;; *) port=web ;; esac
  if [ -n "$s" ]; then
    case "$chemin" in */"$s") chemin="${chemin%/"$s"}/SLUG" ;; esac
    motif="/$s/"; chemin=${chemin//"$motif"/\/SLUG\/}
  fi
  printf '%s%s' "$port" "$chemin" | sed -E \
    -e 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ID/g' \
    -e 's/=[0-9]{10,}/=N/g' -e 's/[^A-Za-z0-9._-]+/_/g'
}

# Masque ce qui ouvrirait une porte : jetons, mots de passe, cles, et les
# passkeys. Une passkey se cache dans le CHEMIN d une URL d annonce
# (`/<passkey>/announce`) comme dans sa requete (`?passkey=`) : toute URL d un
# champ de tracker, ou d un texte qui en porte une, est coupee apres son hote,
# ou qu elle soit dans la chaine (collect.sh ne lit que l hote, pour nommer le
# tracker). Les URL servent aussi de CLES (`trackers` de qBittorrent) : coupees
# de meme. Ce qui n est pas UN objet ou UN tableau JSON passe tel quel : « Ok. »,
# et le « 200 0.123 » du site, que jq lirait comme deux nombres.
nettoie() {
  local brut; brut=$(cat)
  if printf '%s' "$brut" | jq -se 'length == 1 and (.[0] | type == "object" or type == "array")' >/dev/null 2>&1; then
    printf '%s' "$brut" | jq -c '
      def coupe: if type == "string" then gsub("(?<u>[a-z]+://[^/?#\\s\"]+)[^\\s\"]*"; "\(.u)/") else . end;
      walk(if type == "object" then with_entries(
        (.key |= coupe)
        | if (.key | test("^(token|access_token|refresh_token|jwt|password|passwd|passkey|api_?key|secret|cookie)$"; "i"))
          then .value = "masque"
          elif .key == "magnet_uri" then empty
          elif (.key | test("tracker|announce"; "i")) then .value |= coupe
          elif (.value | type) == "string" and (.value | test("[?&](passkey|api_?key|token|key)="; "i"))
          then .value |= coupe
          else . end)
      else . end)'
  else
    printf '%s' "$brut"
  fi
}

# Le curl enregistreur, ecrit dans un dossier temporaire : le vrai curl, puis la
# reponse nettoyee si la requete a reussi (un echec n est pas enregistre, le
# rejeu le retrouve muet). collect.sh recoit exactement ce que le vrai a rendu.
# shellcheck disable=SC2016  # du code, ecrit tel quel dans le curl enregistreur
CORPS_CURL='url=""
for a in "$@"; do case "$a" in http://*|https://*) url=$a ;; esac; done
sortie=$(mktemp)
"$VRAI_CURL" "$@" > "$sortie"; rc=$?
if [ "$rc" -eq 0 ] && [ -n "$url" ]; then nettoie < "$sortie" > "$REPONSES/$(cle "$url")"; fi
cat "$sortie"; rm -f "$sortie"
exit "$rc"'

# Lance seul, et non sourcé (les essais ne prennent que les deux fonctions).
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  COLLECT=${1:-/volume1/docker/homelab/collect.sh}
  REPONSES=${2:-/tmp/homelab-reponses}
  [ -f "$COLLECT" ] || { echo "collect.sh introuvable : $COLLECT" >&2; exit 1; }
  command -v jq >/dev/null || { echo "jq introuvable" >&2; exit 1; }
  VRAI_CURL=$(command -v curl) || { echo "curl introuvable" >&2; exit 1; }
  # ⚠️ JAMAIS DANS UN DEPOT : un `git add .` suffirait a publier ces reponses.
  # Verifie AVANT de creer le dossier, sur son plus proche parent existant.
  # ⚠️ `safe.directory` (04/11/2026) : lance par sudo, git refuse de lire un
  # depot qui n est pas a root (« dubious ownership »), et la verification
  # echouait en silence, c est-a-dire laissait passer.
  p=$REPONSES; while [ ! -d "$p" ]; do p=$(dirname "$p"); done
  if git -c safe.directory='*' -C "$p" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "refus : $REPONSES est dans un depot git, choisir un dossier hors depot" >&2
    exit 1
  fi
  mkdir -p "$REPONSES" && chmod 700 "$REPONSES" || exit 1
  BIN=$(mktemp -d); trap 'rm -rf "$BIN"' EXIT
  { echo '#!/bin/bash'
    printf 'VRAI_CURL=%q\nREPONSES=%q\n' "$VRAI_CURL" "$REPONSES"
    declare -f cle nettoie
    printf '%s\n' "$CORPS_CURL"; } > "$BIN/curl"
  chmod 700 "$BIN/curl"
  PATH="$BIN:$PATH" bash "$COLLECT" --essai >/dev/null; rc=$?
  # Lance par sudo, le dossier revient a qui l a lance (04/11/2026) : en 700 a
  # root, `node --test` lance sans sudo ne pouvait pas le lire.
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then chown -R "$SUDO_USER:" "$REPONSES"; fi
  n=$(find "$REPONSES" -maxdepth 1 -type f | wc -l)
  echo "$n reponse(s) enregistree(s) dans $REPONSES (collect.sh --essai : code $rc)"
  echo "pour les rejouer, depuis une copie du depot : HOMELAB_REPONSES=$REPONSES node --test tests/*.test.js"
  echo "⚠️ donnees personnelles : ce dossier ne doit entrer dans aucun depot ; a effacer apres usage"
  exit "$rc"
fi
