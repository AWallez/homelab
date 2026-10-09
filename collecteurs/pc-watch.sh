#!/bin/bash
# Allume ou eteint le PC fixe a la demande de la page. Les actions recues sont
# VALIDEES contre une liste fixe : le declencheur ne peut rien executer d autre.
# Meme forme que `maj-watch.sh`, dont il reprend le verrou et la cadence.
# Poste vise : `pc.conf`, a cote (voir `pc.conf.exemple`).
set -uo pipefail
ICI=/volume1/docker/homelab
D=$ICI/www/data
TRIG=$D/pc.json; ST=$D/pc-status.json; LOCK=/var/lock/pc-watch.lock
CLE=$ICI/.ssh/pc
PC_IP=; PC_USER=
[ -f "$ICI/pc.conf" ] && . "$ICI/pc.conf"
if [ -z "$PC_IP" ] || [ -z "$PC_USER" ]; then
  echo "pc-watch : $ICI/pc.conf absent ou incomplet (PC_IP, PC_USER)" >&2
  exit 1
fi

# ⚠️ ECRITURE PAR UN FICHIER TEMPORAIRE PUIS `mv -T` (08/10/2026). `data/`
# appartient a nginx et ce script tourne en root : ecrire directement dans
# `pc-status.json` suivrait un lien symbolique qui y aurait ete pose, et le
# `chown` donnerait a nginx le fichier vise. `mktemp` cree un fichier neuf,
# `mv -T` remplace le lien sans le suivre.
st(){ local t; t=$(mktemp "$D/.pc-status.XXXXXX") || return 0
      printf '{"state":"%s","at":"%s","msg":"%s"}\n' "$1" "$(date '+%H:%M:%S')" "$2" > "$t"
      chown 101:101 "$t" 2>/dev/null; chmod 664 "$t"; mv -fT "$t" "$ST"; }

run(){
  [ -f "$TRIG" ] || return 0
  # ⚠️ UNE DEMANDE PERIMEE EST JETEE. Sans ce delai, un fichier depose pendant
  # une coupure du veilleur rallumerait le poste au retour du service, des
  # heures plus tard et sans que personne ne l ait demande.
  if [ $(( $(date +%s) - $(stat -c %Y "$TRIG") )) -gt 120 ]; then rm -f "$TRIG"; return 0; fi
  A=$(jq -r '.action // empty' "$TRIG" 2>/dev/null | tr -d '\r')
  rm -f "$TRIG"
  case "$A" in
    on)
      st running "reveil demande"
      /usr/bin/python3 "$ICI/reveille-pc.py" >> /var/log/pc-watch.log 2>&1
      st done "paquet magique envoye"
      ;;
    off)
      # ⚠️ LA CLE EST RESTREINTE A UNE COMMANDE FORCEE cote PC. Sans cette
      # restriction, une cle sans phrase de passe posee sur le NAS donnerait
      # un acces administrateur complet au poste.
      if [ ! -f "$CLE" ]; then st done "extinction non configuree"; return 0; fi
      st running "extinction demandee"
      if ssh -i "$CLE" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
             -o ConnectTimeout=5 "$PC_USER@$PC_IP" true >> /var/log/pc-watch.log 2>&1; then
        st done "extinction lancee"
      else
        st done "le poste n a pas repondu"
      fi
      ;;
    *) st done "action inconnue" ;;
  esac
}

exec 9>"$LOCK"; flock -n 9 || exit 0
for i in $(seq 1 11); do run; sleep 5; done
