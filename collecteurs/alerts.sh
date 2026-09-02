#!/bin/bash
# Alertes sur seuil, toutes les 5 min, lues dans history.csv.
# Une alerte n est levee que si TOUS les echantillons de la fenetre depassent le seuil :
# c est ce qui distingue une tendance d un pic, et evite le bruit.
set -uo pipefail
SRC=/volume1/docker/homelab/history.csv
ST=/var/lib/nas-alerts.state
NOW=$(date +%s)
RELANCE=21600            # 6 h avant de re-notifier une alerte toujours active
[ -s "$SRC" ] || exit 0
# Compte de service dedie : ecriture seule sur nas-alerts, jamais de lecture.
set -a; . /volume1/docker/tools/homepage.env; set +a
NTFY_LOCAL="${NAS_NTFY_URL:-http://${NAS_IP:-nas.local}:8081}"   # en direct, sans passer par Caddy
NTFY_TOKEN="$NAS_NTFY_TOKEN"
TOPIC="${NAS_NTFY_TOPIC:-nas-alerts}"

# nom;colonne;seuil;minutes;unite
REGLES="
processeur;2;85;10;%
memoire;3;90;10;%
disque;4;85;10;%
temperature CPU;7;80;10; C
swap;12;60;15;%
temperature NVMe;13;70;10; C
"

pousse(){
  jq -nc --arg t "$TOPIC" --arg ti "$1" --arg m "$2" --argjson p "$3" \
     '{topic:$t,title:$ti,message:$m,priority:$p}' \
  | curl -s -m 10 -H "Authorization: Bearer ${NTFY_TOKEN}" \
         -H 'Content-Type: application/json' -d @- "$NTFY_LOCAL" >/dev/null
}

touch "$ST"; NOUV=""
while IFS=';' read -r nom col seuil mins unite; do
  [ -n "$nom" ] || continue
  lu=$(awk -F, -v c=$((NOW - mins*60)) -v k="$col" -v s="$seuil" \
       '$1+0 >= c { n++; if ($k+0 <= s) sous=1 } END { print n+0, sous+0 }' "$SRC")
  n=${lu%% *}; sous=${lu##* }
  actif=0; [ "$n" -ge 3 ] && [ "$sous" -eq 0 ] && actif=1
  prec=$(awk -v k="$nom" -F'\t' '$1==k{print $2}' "$ST"); prec=${prec:-0}
  val=$(awk -F, -v k="$col" 'END{printf "%.0f", $k}' "$SRC")
  if [ "$actif" -eq 1 ]; then
    if [ "$prec" -eq 0 ] || [ $((NOW - prec)) -ge "$RELANCE" ]; then
      pousse "NAS — $nom au-dessus du seuil" \
             "$nom à $val$unite, seuil de $seuil$unite dépassé depuis $mins minutes." 4
      NOUV="$NOUV$nom\t$NOW\n"
    else
      NOUV="$NOUV$nom\t$prec\n"
    fi
  elif [ "$prec" -ne 0 ]; then
    pousse "NAS — $nom revenu à la normale" "$nom est redescendu à $val$unite." 2
  fi
done <<< "$REGLES"
printf "%b" "$NOUV" > "$ST"
