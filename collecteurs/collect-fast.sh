#!/bin/bash
# Valeurs vivantes du homelab, rafraichies toutes les 5 s dans www/live.json.
# Ecrit un fichier DIFFERENT de collect.sh : aucune ecriture concurrente.
set -uo pipefail
set -a; . /volume1/docker/tools/homepage.env; set +a
IP=${NAS_IP:-nas.local}
OUT=/volume1/docker/homelab/www/live.json
ST=/var/lib/nas-fast.state
CK=/var/lib/nas-qbit.cookie
NIC=/sys/class/net/eth0/statistics

qlogin(){ curl -s --max-time 5 -c "$CK" \
  -d "username=$HOMEPAGE_VAR_QBIT_USER&password=$HOMEPAGE_VAR_QBIT_PASS" \
  "http://$IP:8080/api/v2/auth/login" >/dev/null 2>&1; }

tick(){
  NOWS=$(date +%s)
  NET=$(( $(cat $NIC/rx_bytes 2>/dev/null || echo 0) + $(cat $NIC/tx_bytes 2>/dev/null || echo 0) ))
  read -r _ a b c d e f h _ < /proc/stat; IDLE=$d; TOT=$((a+b+c+d+e+f+h))
  MT=$(awk '/MemTotal/{print $2}' /proc/meminfo); MA=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
  RAM=$(( 100 - (100*MA/MT) ))
  if [ -r "$ST" ]; then read -r PI PT PN PE < "$ST"; else PI=0; PT=0; PN=0; PE=0; fi
  printf '%s %s %s %s\n' "$IDLE" "$TOT" "$NET" "$NOWS" > "$ST"
  CPU=0; DEB=0
  [ "${PT:-0}" -gt 0 ] && [ "$TOT" -gt "${PT:-0}" ] && CPU=$(( 100 - (100*(IDLE-PI)/(TOT-PT)) ))
  DT=$(( NOWS - ${PE:-0} ))
  [ "${PN:-0}" -gt 0 ] && [ "$DT" -gt 0 ] && [ "$NET" -ge "${PN:-0}" ] && DEB=$(( (NET-PN)/DT ))

  # Les appels HTTP ne se font qu un tour sur trois : ces valeurs bougent peu,
  # et interroger qBittorrent 30 fois par minute n apporterait rien.
  if [ $(( ${I:-1} % 3 )) -eq 1 ]; then
    # Le cookie qBittorrent est REUTILISE : on ne se reconnecte qu en cas d echec.
    QB=$(curl -s --max-time 5 -b "$CK" "http://$IP:8080/api/v2/sync/maindata")
    if ! echo "$QB" | jq -e .server_state >/dev/null 2>&1; then
      qlogin; QB=$(curl -s --max-time 5 -b "$CK" "http://$IP:8080/api/v2/sync/maindata")
    fi
    QQ=$(echo "$QB" | jq -r '"\(.server_state.dl_info_speed//0) \(.server_state.up_info_speed//0)"' 2>/dev/null)
    QDL=${QQ%% *}; QUL=${QQ##* }
    case "$QDL" in ''|*[!0-9]*) QDL=0;; esac
    case "$QUL" in ''|*[!0-9]*) QUL=0;; esac

    JNOW=$(curl -s --max-time 5 "http://$IP:8096/Sessions?api_key=$HOMEPAGE_VAR_JELLYFIN_KEY" \
      | jq -r '[.[]? | select(.NowPlayingItem) | "\(.UserName) — \(.NowPlayingItem.Name)"] | join(" · ")' 2>/dev/null)
  fi

  jq -n --argjson cpu "${CPU:-0}" --argjson ram "${RAM:-0}" --argjson net "${DEB:-0}" \
        --argjson dl "$QDL" --argjson ul "$QUL" --arg jnow "${JNOW:-}" \
    '{cpu:$cpu,ram:$ram,net:$net,qbit:{dl:$dl,ul:$ul},jnow:$jnow}' > "$OUT.tmp" \
    && mv "$OUT.tmp" "$OUT" && chmod 644 "$OUT"
}

# Le cron ne descend pas sous la minute : on boucle pendant la sienne.
# Processeur, memoire et reseau sont de simples lectures de fichiers : on peut
# les rafraichir toutes les 2 s pour quelques microsecondes de travail.
QDL=0; QUL=0; JNOW=""; I=0
# Boucle bornee dans le TEMPS, pas en nombre de tours : un compte fixe finit par
# deborder la minute, le flock refuse alors le passage suivant et on perd une
# minute entiere de mesures.
FIN=$(( $(date +%s) + 57 ))
while [ "$(date +%s)" -lt "$FIN" ]; do I=$((I + 1)); tick; sleep 2; done
