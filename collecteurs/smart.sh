#!/bin/bash

# cron ne fournit qu un PATH minimal, sans /usr/sbin ou vivent smartctl et nvme :
# le script ecrivait alors un tableau vide, alors qu il fonctionne lance a la main.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
# Sante SMART des SSD NVMe -> www/smart.json.
# Quotidien : ces valeurs evoluent sur des mois, les relever souvent n a aucun sens.
set -uo pipefail
OUT=/volume1/docker/homelab/www/smart.json
L=$(mktemp); trap 'rm -f "$L"' EXIT
# ⚠️ ON BOUCLE SUR LES SLOTS et non sur /dev/nvme[0-9] : le nom noyau a change
# au redemarrage du 01/09/2026, et la carte aurait interverti les deux disques
# en silence. `nvme-slots.sh` rend « <slot> <controleur> », le slot venant du
# numero de serie.
/volume1/docker/homelab/nvme-slots.sh 2>/dev/null | while read -r slot ctrl; do
  dev=/dev/$ctrl
  [ -e "$dev" ] || continue
  smartctl -j -a "$dev" 2>/dev/null | jq -c --arg dev "nvme$slot" '
    select(.model_name != null) |
    (.nvme_smart_health_information_log // {}) as $h |
    { n:$dev, modele:.model_name,
      go:((((.user_capacity.bytes // .nvme_total_capacity) // 0)/1000000000)|floor),
      ok:(.smart_status.passed // false), temp:(.temperature.current // 0),
      usure:($h.percentage_used // 0), spare:($h.available_spare // 100),
      heures:($h.power_on_hours // 0), cycles:($h.power_cycles // 0),
      brutaux:($h.unsafe_shutdowns // 0), erreurs:($h.media_errors // 0),
      ecrit:((($h.data_units_written // 0)*512000/10000000000)|floor/100) }' >> "$L"
done
# Ecriture atomique, par coherence avec les autres collecteurs.
if jq -s -c '{ts:(now|floor), d:.}' "$L" > "$OUT.tmp" \
   && jq -e . "$OUT.tmp" >/dev/null 2>&1; then
  mv "$OUT.tmp" "$OUT"; chmod 644 "$OUT"
else
  rm -f "$OUT.tmp"; echo "smart.json NON remplace : assemblage jq en echec" >&2
fi
