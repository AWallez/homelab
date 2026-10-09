#!/bin/bash
# Alertes sur seuil, toutes les 5 min, lues dans history.csv.
# Une alerte n est levee que si TOUS les echantillons de la fenetre depassent le seuil :
# c est ce qui distingue une tendance d un pic, et evite le bruit.
set -uo pipefail
SRC=/volume1/docker/homelab/history.csv
WWW=/volume1/docker/homelab/www
ST=/var/lib/nas-alerts.state
NOW=$(date +%s)
RELANCE=21600            # 6 h avant de re-notifier une alerte toujours active
[ -s "$SRC" ] || exit 0
# Compte de service dedie : ecriture seule sur nas-alerts, jamais de lecture.
set -a; . /volume1/docker/tools/homepage.env; set +a
: "${NAS_IP:=nas.local}"; PORT_NTFY=8081
[ -f /volume1/docker/homelab/collect.conf ] && . /volume1/docker/homelab/collect.conf
NTFY_LOCAL="${NAS_NTFY_URL:-http://$NAS_IP:$PORT_NTFY}"   # en direct, sans passer par Caddy
TOPIC="${NAS_NTFY_TOPIC:-nas-alerts}"
# Adresse de la page : toucher la notification ouvre la carte concernee
# (`#carte=<nom>`, lu par la page). Vide, la notification n ouvre rien.
PAGE="${PAGE_URL:-}"; PAGE=${PAGE%/}
# ⚠️ Le jeton passe par un fichier prive lu par `curl -K`, jamais sur la ligne
# de commande, lisible par tout compte du NAS (08/10/2026).
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
v=${NAS_NTFY_TOKEN:-}; v=${v//\\/\\\\}; v=${v//\"/\\\"}
printf 'header = "Authorization: Bearer %s"\n' "$v" > "$TMP/ntfy"

# nom;colonne;seuil;minutes;unite
REGLES="
processeur;2;85;10;%
memoire;3;90;10;%
disque;4;85;10;%
temperature CPU;7;80;10; C
swap;12;60;15;%
temperature NVMe;13;70;10; C
"

# Carte de la page qui montre chaque alerte, sur son NOM AFFICHE : renommer
# une carte dans cartes.js impose de la renommer ici. Sans carte (collecteurs
# arretes), la notification ouvre la page en haut.
carte(){
  case "$1" in
    processeur)   echo "Système" ;;
    memoire|swap) echo "Mémoire" ;;
    disque)       echo "Stockage" ;;
    temperature*) echo "Températures" ;;
    *)            echo "" ;;
  esac
}

# Rend 0 seulement si ntfy a ACCEPTE la notification (08/10/2026). Le resultat
# etait jete : un envoi rate passait pour fait, et l alerte n etait plus
# jamais renvoyee avant la relance de 6 h.
# $4 : la carte a ouvrir au toucher (`click` de ntfy), facultative.
pousse(){
  local code
  code=$(jq -nc --arg t "$TOPIC" --arg ti "$1" --arg m "$2" --argjson p "$3" \
        --arg u "$PAGE" --arg c "${4:-}" \
     '{topic:$t,title:$ti,message:$m,priority:$p}
      + (if $u == "" then {} elif $c == "" then {click:$u}
         else {click:($u + "/#carte=" + ($c|@uri))} end)' \
  | curl -s -m 10 -o /dev/null -w '%{http_code}' -K "$TMP/ntfy" \
         -H 'Content-Type: application/json' -d @- "$NTFY_LOCAL")
  [ "$code" = "200" ] && return 0
  echo "$(date '+%F %T') ntfy a refuse ou n a pas repondu ($code) : $1" >&2
  return 1
}

# Une alerte active ou levee : `etat` 1 ou 0, `prec` l heure de la derniere
# notification (0 = aucune alerte en cours). Garde l etat precedent si l envoi
# echoue, pour reessayer au passage suivant.
juge(){
  local nom="$1" actif="$2" prec="$3" titre_on="$4" msg_on="$5" titre_off="$6" msg_off="$7"
  local c; c=$(carte "$nom")
  if [ "$actif" -eq 1 ]; then
    if [ "$prec" -eq 0 ] || [ $((NOW - prec)) -ge "$RELANCE" ]; then
      if pousse "$titre_on" "$msg_on" 4 "$c"; then NOUV="$NOUV$nom\t$NOW\n"; else NOUV="$NOUV$nom\t$prec\n"; fi
    else
      NOUV="$NOUV$nom\t$prec\n"
    fi
  elif [ "$prec" -ne 0 ]; then
    pousse "$titre_off" "$msg_off" 2 "$c" || NOUV="$NOUV$nom\t$prec\n"
  fi
}

touch "$ST"; NOUV=""
while IFS=';' read -r nom col seuil mins unite; do
  [ -n "$nom" ] || continue
  lu=$(awk -F, -v c=$((NOW - mins*60)) -v k="$col" -v s="$seuil" \
       '$1+0 >= c { n++; if ($k+0 <= s) sous=1 } END { print n+0, sous+0 }' "$SRC")
  n=${lu%% *}; sous=${lu##* }
  prec=$(awk -v k="$nom" -F'\t' '$1==k{print $2}' "$ST"); prec=${prec:-0}
  # ⚠️ MOINS DE TROIS MESURES, ON NE SAIT PAS (08/10/2026). Ce cas valait « sous
  # le seuil » : une collecte arretee envoyait un faux « revenu a la normale »
  # pour toute alerte en cours. L etat est garde tel quel ; c est la regle
  # « collecte arretee » ci-dessous qui signale l absence de mesures.
  if [ "$n" -lt 3 ]; then
    [ "$prec" -ne 0 ] && NOUV="$NOUV$nom\t$prec\n"
    continue
  fi
  actif=0; [ "$sous" -eq 0 ] && actif=1
  val=$(awk -F, -v k="$col" 'END{printf "%.0f", $k}' "$SRC")
  juge "$nom" "$actif" "$prec" \
       "NAS — $nom au-dessus du seuil" "$nom à $val$unite, seuil de $seuil$unite dépassé depuis $mins minutes." \
       "NAS — $nom revenu à la normale" "$nom est redescendu à $val$unite."
done <<< "$REGLES"

# --- Les collecteurs eux-memes (08/10/2026) ---
# Un collecteur arrete ne declenchait rien : la page restait figee, et les
# alertes sur seuil se taisaient faute de mesures. Chacun ecrit son fichier a
# intervalle fixe ; au-dela de 10 min sans ecriture, il est tenu pour arrete.
# ⚠️ `data.json` et non `history.csv` pour la collecte principale :
# `history-build.sh` reecrit `history.csv` chaque minute, meme collecte morte.
# nom;fichier
SOURCES="
collecte principale;$WWW/data.json
mesures rapides;$WWW/live.json
collecteur systeme;$WWW/systeme.json
"
while IFS=';' read -r nom f; do
  [ -n "$nom" ] || continue
  cle="arret $nom"
  prec=$(awk -v k="$cle" -F'\t' '$1==k{print $2}' "$ST"); prec=${prec:-0}
  m=$(stat -c %Y "$f" 2>/dev/null || echo 0)
  age=$(( (NOW - m) / 60 ))
  actif=0; [ "$age" -ge 10 ] && actif=1
  juge "$cle" "$actif" "$prec" \
       "NAS — $nom arrêtée" "Aucune mise à jour de $(basename "$f") depuis $age min : la page affiche des données figées." \
       "NAS — $nom repartie" "$(basename "$f") est de nouveau mis à jour."
done <<< "$SOURCES"

printf "%b" "$NOUV" > "$ST"
