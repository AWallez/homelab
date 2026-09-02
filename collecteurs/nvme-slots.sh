#!/bin/sh
# Correspondance STABLE entre les colonnes nvme0..nvme3 de l historique et les
# disques physiquement presents, etablie sur le NUMERO DE SERIE.
#
# POURQUOI. Le 01/09/2026, la mise a jour UGOS 1.19.1 (noyau 6.18.15) a INVERSE
# l enumeration des deux SSD : le disque systeme est passe de nvme0 a nvme1, et
# le disque de donnees de nvme1 a nvme0. Les colonnes de temperature ont donc
# change de disque sans que rien ne le signale, et les deux courbes se croisent
# dans l historique a l heure du redemarrage. Un numero de controleur n est PAS
# une identite ; un numero de serie l est.
#
# SORTIE : une ligne « <slot> <controleur> » par disque present, par exemple
#   0 nvme1
#   1 nvme0
#
# Un disque INCONNU est ajoute au premier slot libre et la table completee.
# C est ce qui preserve la propriete voulue au depart : ajouter un SSD dans un
# des deux emplacements M.2 libres suffit a le voir apparaitre, sans rien
# editer a la main.
CONF=/volume1/docker/homelab/nvme-serie.conf
[ -f "$CONF" ] || printf '# slot=numero de serie\n' > "$CONF"

for d in /sys/class/nvme/nvme[0-9]; do
  [ -e "$d/serial" ] || continue
  ctrl=${d##*/}
  ser=$(tr -d ' \t\r\n' < "$d/serial" 2>/dev/null)
  [ -n "$ser" ] || continue

  slot=$(awk -F= -v s="$ser" '$2==s { print $1; exit }' "$CONF")
  if [ -z "$slot" ]; then
    # Premier slot libre. `awk` sort 0 quand le slot est pris, donc la boucle
    # avance tant qu il l est.
    slot=0
    while awk -F= -v n="$slot" '$1==n { pris=1 } END { exit !pris }' "$CONF"; do
      slot=$((slot + 1))
    done
    printf '%s=%s\n' "$slot" "$ser" >> "$CONF"
  fi
  printf '%s %s\n' "$slot" "$ctrl"
done
