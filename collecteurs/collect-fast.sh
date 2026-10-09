#!/bin/bash
# Valeurs vivantes du homelab, rafraichies toutes les 2 s dans www/live.json.
# Ecrit un fichier DIFFERENT de collect.sh : aucune ecriture concurrente.
#
# ⚠️ ALLEGE LE 08/10/2026 (audit, etape 3). Trente tours par minute, et chaque
# tour lancait `date`, deux `cat`, deux `awk`, un `jq` pour ecrire cinq nombres,
# `mv` et `chmod` : 29 % du processeur de toute la supervision. Les lectures de
# /proc et /sys et l ecriture du JSON passent par les builtins de bash ; il ne
# reste qu un `mv` par tour, plus les requetes HTTP un tour sur trois.
# ⚠️ Aucun secret sur la ligne de commande : voir l en-tete de collect.sh.
set -uo pipefail
set -a; . /volume1/docker/tools/homepage.env; set +a
: "${NAS_IP:=nas.local}"; PORT_QBIT=8080; PORT_JELLYFIN=8096
[ -f /volume1/docker/homelab/collect.conf ] && . /volume1/docker/homelab/collect.conf
IP=$NAS_IP
OUT=/volume1/docker/homelab/www/live.json
ST=/var/lib/nas-fast.state
# Cookie PARTAGE avec collect.sh : on ne se reconnecte qu en cas d echec.
CK=/var/lib/nas-qbit.cookie
NIC=/sys/class/net/eth0/statistics
umask 022                          # live.json en 644 sans `chmod` a chaque tour

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
printf 'username=%s&password=%s' "${HOMEPAGE_VAR_QBIT_USER:-}" "${HOMEPAGE_VAR_QBIT_PASS:-}" > "$TMP/qb.login"
v=${HOMEPAGE_VAR_JELLYFIN_KEY:-}; v=${v//\\/\\\\}; v=${v//\"/\\\"}
printf 'header = "Authorization: MediaBrowser Token=\\"%s\\""\n' "$v" > "$TMP/jelly"

# Lecture en cours, et sa methode : un transcodage charge le processeur, une
# lecture directe ne coute rien. `PlayMethod` vaut DirectPlay, DirectStream
# (conteneur refait, flux copies) ou Transcode.
JQ_LECTURE='[.[]? | select(.NowPlayingItem) | (.PlayState.PlayMethod // "") as $p
  | "\(.UserName) — \(.NowPlayingItem.Name)"
    + (if $p == "Transcode" then " (transcodage)" elif $p == "DirectStream" then " (flux direct)"
       elif $p == "DirectPlay" then " (lecture directe)" else "" end)] | join(" · ")'

qlogin(){ curl -s --max-time 5 -c "$CK" --data-binary @"$TMP/qb.login" \
  "http://$IP:$PORT_QBIT/api/v2/auth/login" >/dev/null 2>&1; }

tick(){
  printf -v NOWS '%(%s)T' -1
  RX=0; TX=0; { read -r RX < "$NIC/rx_bytes"; read -r TX < "$NIC/tx_bytes"; } 2>/dev/null
  NET=$(( RX + TX ))
  read -r _ a b c d e f h _ < /proc/stat; IDLE=$d; TOT=$((a+b+c+d+e+f+h))
  MT=1; MA=0
  while read -r k v _; do
    case "$k" in MemTotal:) MT=$v;; MemAvailable:) MA=$v; break;; esac
  done < /proc/meminfo
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
    # ⚠️ `transfer/info` ET NON `sync/maindata` : ce dernier rend l etat de TOUS
    # les torrents pour en lire deux debits, que `transfer/info` donne en
    # quelques octets. Lus sans `jq`, par une expression rationnelle de bash.
    QB=$(curl -s --max-time 5 -b "$CK" "http://$IP:$PORT_QBIT/api/v2/transfer/info")
    case "$QB" in '{'*) ;; *) qlogin; QB=$(curl -s --max-time 5 -b "$CK" "http://$IP:$PORT_QBIT/api/v2/transfer/info");; esac
    QDL=0; QUL=0
    [[ "$QB" =~ \"dl_info_speed\":([0-9]+) ]] && QDL=${BASH_REMATCH[1]}
    [[ "$QB" =~ \"up_info_speed\":([0-9]+) ]] && QUL=${BASH_REMATCH[1]}

    JNOW=$(curl -s --max-time 5 -K "$TMP/jelly" "http://$IP:$PORT_JELLYFIN/Sessions" \
      | jq -r "$JQ_LECTURE" 2>/dev/null)
  fi

  # `t` : sans horodatage, la page ne pouvait pas savoir que ces valeurs avaient
  # cesse de bouger. JSON ecrit a la main ; seul le titre en cours de lecture est
  # du texte, echappe ici.
  j=${JNOW:-}; j=${j//\\/\\\\}; j=${j//\"/\\\"}; j=${j//$'\n'/ }; j=${j//$'\r'/}; j=${j//$'\t'/ }
  printf '{"t":%d,"cpu":%d,"ram":%d,"net":%d,"qbit":{"dl":%d,"ul":%d},"jnow":"%s"}\n' \
    "$NOWS" "$CPU" "$RAM" "$DEB" "$QDL" "$QUL" "$j" > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
}

# Le cron ne descend pas sous la minute : on boucle pendant la sienne.
# Boucle bornee dans le TEMPS, pas en nombre de tours : un compte fixe finit par
# deborder la minute, le flock refuse alors le passage suivant et on perd une
# minute entiere de mesures.
QDL=0; QUL=0; JNOW=""; I=0
printf -v FIN '%(%s)T' -1; FIN=$(( FIN + 57 ))
# L attente de 2 s se fait sur un tube qui ne recevra jamais rien : `read -t` y
# patiente sans processus, la ou `sleep` en lancait un a chaque tour.
exec 8<> <(:)
while printf -v MAINT '%(%s)T' -1; [ "$MAINT" -lt "$FIN" ]; do I=$((I + 1)); tick; read -r -t 2 -u 8 || true; done
