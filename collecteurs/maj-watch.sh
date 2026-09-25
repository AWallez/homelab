#!/bin/bash
# Exécute ce que la page demande : mettre à jour des conteneurs, ou changer leur mode.
#
# La page dépose `data/trigger.json` (seul fichier inscriptible, en PUT) ; ce
# script, lancé chaque minute par le cron root, le lit toutes les 5 s et passe
# la main à compose-auto-update.
#
# ⚠️ DEPUIS LE 25/09/2026, PLUS DE LISTE FIGÉE ICI. Elle obligeait à tenir deux
# listes à jour, et un nouveau conteneur n'était pas actionnable depuis la page.
# C'est compose-auto-update qui refuse un nom qu'il ne connaît pas. On garde
# seulement un contrôle de forme sur les noms : le fichier vient d'une page web.
set -uo pipefail
D=/volume1/docker/homelab/www/data
TRIG=$D/trigger.json; ST=$D/maj-status.json; LOCK=/var/lock/maj-watch.lock
OUTIL=/volume1/docker/tools/compose-auto-update

cau() { (cd "$OUTIL" && python3 -m compose_auto_update --config "$OUTIL/config.toml" "$@"); }

# ⚠️ jq et non printf : un message contenant un guillemet produisait un JSON
# invalide, et la page restait bloquée sur « en attente du démarrage ».
st() {
  jq -nc --arg s "$1" --arg a "$(date '+%H:%M:%S')" --arg m "$2" --argjson ok "${3:-true}" \
     '{state:$s, at:$a, msg:$m, ok:$ok}' > "$ST"
  chown 101:101 "$ST" 2>/dev/null; chmod 664 "$ST"
}

nom_valide() { [[ "$1" =~ ^[a-z0-9][a-z0-9_.-]{0,62}$ ]]; }

# Le journal de chaque action rejoint celui de la passe de nuit :
#   journalctl -t compose-auto-update
journaliser() { systemd-cat -t compose-auto-update; }

run() {
  [ -f "$TRIG" ] || return 0
  if [ $(( $(date +%s) - $(stat -c %Y "$TRIG") )) -gt 300 ]; then rm -f "$TRIG"; return 0; fi
  ACTION=$(jq -r '.action // "appliquer"' "$TRIG" 2>/dev/null)

  case "$ACTION" in
    mode)
      NOM=$(jq -r '.nom // ""' "$TRIG" 2>/dev/null); MODE=$(jq -r '.mode // ""' "$TRIG" 2>/dev/null)
      rm -f "$TRIG"
      case "$MODE" in auto|manuel|defaut) ;; *) st done "mode refusé : « $MODE »" false; return 0 ;; esac
      nom_valide "$NOM" || { st done "nom refusé" false; return 0; }
      st running "$NOM passe en $MODE"
      cau mode "$NOM" "$MODE" 2>&1 | journaliser
      case "${PIPESTATUS[0]}" in
        0) st done "$NOM passe en $MODE" ;;
        3) st done "une passe est en cours, réessaie dans quelques minutes" false ;;
        *) st done "$NOM : changement refusé (journalctl -t compose-auto-update)" false ;;
      esac ;;

    appliquer)
      SEL=$(jq -r '.items[]?' "$TRIG" 2>/dev/null | tr -d '\r'); rm -f "$TRIG"
      LISTE=""; for c in $SEL; do nom_valide "$c" && LISTE="$LISTE $c"; done
      [ -z "$LISTE" ] && { st done "aucun conteneur reconnu" false; return 0; }
      OK=0; RATES=""
      for c in $LISTE; do
        st running "mise à jour de $c"
        cau appliquer "$c" 2>&1 | journaliser
        case "${PIPESTATUS[0]}" in
          0) OK=$((OK + 1)) ;;
          3) RATES="$RATES $c (passe en cours)" ;;
          *) RATES="$RATES $c" ;;
        esac
      done
      if [ -z "$RATES" ]; then st done "terminé : $OK conteneur(s) mis à jour"
      else st done "terminé, en échec :$RATES ; la raison est affichée sur la ligne" false; fi ;;

    *) rm -f "$TRIG"; st done "action inconnue" false ;;
  esac
}

exec 9>"$LOCK"; flock -n 9 || exit 0
for i in $(seq 1 11); do run; sleep 5; done
