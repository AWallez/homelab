#!/bin/bash
# shellcheck disable=SC2034  # les variables testees sont lues par `eval` dans vrai()
# Banc d essai des collecteurs, SANS le NAS : chaque script est copie avec ses
# chemins rediriges vers un dossier temporaire, et `docker`, `smartctl`,
# `nvme-slots.sh` ou `python3` sont remplaces par des bouchons.
#
#   bash outils/teste-collecteurs.sh
#
# Ce que ca prouve : la LOGIQUE des scripts face aux pannes (source muette,
# outil en echec). Ce que ca ne prouve pas : le comportement sur le vrai
# materiel, sous cron, avec les versions d outils du NAS.
set -uo pipefail
R=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
H=$T/h; B=$T/bin; mkdir -p "$H/www/data" "$B"
ECHECS=0
ok()  { echo "  ok    $1"; }
ko()  { echo "  ECHEC $1"; ECHECS=$((ECHECS + 1)); }
vrai(){ if eval "$2"; then ok "$1"; else ko "$1"; fi; }

# Copie d un collecteur, chemins du NAS rediriges vers $H.
prepare() {
  sed -e "s#/volume1/docker/homelab#$H#g" -e "s#/var/lock/#$T/#g" -e "s#/var/log/#$T/#g" \
      -e "s#^export PATH=.*#export PATH=\"$B:\$PATH\"#" "$R/collecteurs/$1" > "$T/$1"
}
bouchon() { printf '#!/bin/bash\n%s\n' "$2" > "$B/$1"; chmod +x "$B/$1"; }

echo "smart.sh"
prepare smart.sh; cp "$R/fixtures/smart.json" "$H/www/smart.json"; cp "$H/www/smart.json" "$T/avant"
printf '#!/bin/sh\nexit 0\n' > "$H/nvme-slots.sh"; chmod +x "$H/nvme-slots.sh"
bash "$T/smart.sh" 2>/dev/null; rc=$?
vrai "aucun disque lu : code d erreur" '[ "$rc" -ne 0 ]'
vrai "aucun disque lu : smart.json garde" 'cmp -s "$T/avant" "$H/www/smart.json"'
printf '#!/bin/sh\necho "0 null"\n' > "$H/nvme-slots.sh"
bouchon smartctl "echo '{\"model_name\":\"X\",\"smart_status\":{\"passed\":true},\"temperature\":{\"current\":41}}'"
bash "$T/smart.sh"
vrai "un disque lu : smart.json ecrit" '[ "$(jq -r ".d[0].temp" "$H/www/smart.json")" = 41 ]'

echo "history-build.sh"
prepare history-build.sh; NOW=$(date +%s); : > "$H/history.csv"
for i in $(seq 0 30); do
  echo "$((NOW - i * 120)),12,40,55,1000,0.5,48,0,0,0.4,0.3,10,41,40,39,71,,,120,1,500,20,1,1," >> "$H/history.csv"
done
bash "$T/history-build.sh"
vrai "historique valide : ecrit" 'jq -e ".j | length > 0" "$H/www/history.json" >/dev/null'
cp "$H/www/history.json" "$T/avant"; mkdir -p "$T/awk-ko"
printf '#!/bin/sh\nprintf "{\\"j\\":[[1,2"\n' > "$T/awk-ko/awk"; chmod +x "$T/awk-ko/awk"
PATH="$T/awk-ko:$PATH" bash "$T/history-build.sh" 2>/dev/null
vrai "sortie tronquee : history.json garde" 'cmp -s "$T/avant" "$H/www/history.json"'

echo "containers.sh"
prepare containers.sh
echo "$NOW;arr-sonarr;1.0;5.0;0" > "$H/containers.csv"
printf 'arr-sonarr;2\njellyfin;0\n' > "$H/restarts.state"
echo '{"t":1,"c":[],"ev":[]}' > "$H/www/containers.json"; cp "$H/www/containers.json" "$T/avant"
bouchon docker 'exit 1'
PATH="$B:$PATH" bash "$T/containers.sh" 2>/dev/null
vrai "docker muet : etat des redemarrages garde" 'grep -q "^arr-sonarr;2$" "$H/restarts.state"'
vrai "docker muet : containers.json garde" 'cmp -s "$T/avant" "$H/www/containers.json"'
bouchon docker 'case "$1" in
  ps) if [ "${2:-}" = -q ]; then echo abc; else echo "abc;arr-sonarr"; fi ;;
  inspect) echo "/arr-sonarr;3;2026-11-03T10:00:00Z" ;;
  stats) echo "arr-sonarr;1.5%;4.0%" ;;
esac'
PATH="$B:$PATH" bash "$T/containers.sh"
vrai "redemarrage detecte (2 -> 3)" 'jq -e "[.ev[] | select(.n == \"arr-sonarr\")] | length > 0" "$H/www/containers.json" >/dev/null'

echo "maj-watch.sh"
sed -n '/^st() {/,/^}/p' "$R/collecteurs/maj-watch.sh" > "$T/st.sh"
( D=$H/www/data; ST=$D/maj-status.json
  # shellcheck source=/dev/null
  . "$T/st.sh"; st "done" "ok" true; st "done" "x" "pas-un-booleen" 2>/dev/null )
vrai "jq en echec : ancien etat garde" '[ "$(jq -r .msg "$H/www/data/maj-status.json")" = ok ]'

echo "pc-watch.sh et reveille-pc.py"
printf 'PC_IP=192.0.2.10\nPC_USER=essai\n' > "$H/pc.conf"
bouchon reveil-ko 'exit 1'
sed -e "s#/volume1/docker/homelab#$H#g" -e "s#/var/lock/#$T/#g" -e "s#/var/log/#$T/#g" \
    -e "s#/usr/bin/python3 #$B/reveil-ko #" -e 's#^for _ in \$(seq 1 11).*#run#' \
    "$R/collecteurs/pc-watch.sh" > "$T/pc-watch.sh"
echo '{"action":"on"}' > "$H/www/data/pc.json"
bash "$T/pc-watch.sh"
vrai "reveil en echec : annonce comme tel" 'jq -r .msg "$H/www/data/pc-status.json" | grep -q echec'
python3 -I - "$R/collecteurs/reveille-pc.py" >/dev/null 2>&1 <<'E'
import runpy, socket, sys
class Muet(socket.socket):
    def sendto(self, *a): raise OSError("simule")
socket.socket = Muet
chemin = sys.argv[1]; sys.argv = [chemin, "AA:BB:CC:DD:EE:FF"]
runpy.run_path(chemin, run_name="__main__")
E
rc=$?
vrai "aucun paquet parti : code d erreur" '[ "$rc" -ne 0 ]'

echo
if [ "$ECHECS" -eq 0 ]; then echo "tous les essais passent"; else echo "$ECHECS essai(s) en echec"; exit 1; fi
