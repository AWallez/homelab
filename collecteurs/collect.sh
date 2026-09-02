#!/bin/bash
# Collecte toutes les sources du homelab dans un seul data.json
set -uo pipefail
set -a; . /volume1/docker/tools/homepage.env; set +a
IP=${NAS_IP:-nas.local}
OUT=/volume1/docker/homelab/www/data.json
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
NOWS=$(date +%s)
g(){ curl -s --max-time 8 "$@"; }
n(){ [ -n "${1:-}" ] && [ "$1" != "null" ] && echo "$1" || echo 0; }

# --- Machine ---
# Processeur et reseau mesures ENTRE deux passages, via un fichier d etat.
# Supprime la pause d une seconde et donne une moyenne sur l intervalle
# plutot qu un echantillon instantane.
NIC=/sys/class/net/eth0/statistics
NETNOW=$(( $(cat $NIC/rx_bytes 2>/dev/null || echo 0) + $(cat $NIC/tx_bytes 2>/dev/null || echo 0) ))
read -r _ a b c d e f h _ < /proc/stat; IDLE=$d; TOT=$((a+b+c+d+e+f+h))
ST=/var/lib/nas-collect.state
if [ -r "$ST" ]; then read -r PI PT PN PE < "$ST"; else PI=0; PT=0; PN=0; PE=0; fi
printf '%s %s %s %s\n' "$IDLE" "$TOT" "$NETNOW" "$NOWS" > "$ST"
if [ "${PT:-0}" -gt 0 ] && [ "$TOT" -gt "${PT:-0}" ]; then
  CPU=$(( 100 - (100*(IDLE-PI)/(TOT-PT)) ))
else CPU=0; fi
DT=$(( NOWS - ${PE:-0} ))
if [ "${PN:-0}" -gt 0 ] && [ "$DT" -gt 0 ] && [ "$NETNOW" -ge "${PN:-0}" ]; then
  NET=$(( (NETNOW - PN) / DT ))
else NET=0; fi
MT=$(awk '/MemTotal/{print $2}' /proc/meminfo); MA=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
RAM=$(( 100 - (100*MA/MT) ))
CORES=$(nproc 2>/dev/null || echo 1)
UP=$(awk '{printf "%d", $1/86400}' /proc/uptime)
RUN=$(docker ps -q | wc -l); ALL=$(docker ps -aq | wc -l)

# --- Disque, charge et temperature lus A LA SOURCE : /proc, /sys et df ---
read -r DUSED DSIZE < <(df -B1 /volume1 2>/dev/null | awk 'NR==2{print $3, $2}')
DPC=0; [ "${DSIZE:-0}" -gt 0 ] && DPC=$(( 100*DUSED/DSIZE ))
read -r LOAD1 LOAD5 LOAD15 _ < /proc/loadavg
# Entrees/sorties disque : secteurs lus/ecrits, convertis en octets/s entre deux passages.
DIOS=/var/lib/nas-diskio.state; DR=0; DW=0
if [ -r /sys/block/dm-0/stat ]; then
  read -r _ _ SR _ _ _ SW _ < /sys/block/dm-0/stat
  if [ -r "$DIOS" ]; then read -r PSR PSW PDE < "$DIOS"; else PSR=0; PSW=0; PDE=0; fi
  printf '%s %s %s\n' "$SR" "$SW" "$NOWS" > "$DIOS"
  DD=$(( NOWS - ${PDE:-0} ))
  if [ "${PSR:-0}" -gt 0 ] && [ "$DD" -gt 0 ]; then
    DR=$(( (SR - PSR) * 512 / DD )); DW=$(( (SW - PSW) * 512 / DD ))
    [ "$DR" -lt 0 ] && DR=0; [ "$DW" -lt 0 ] && DW=0
  fi
fi
SWT=$(awk '/SwapTotal/{print $2}' /proc/meminfo); SWF=$(awk '/SwapFree/{print $2}' /proc/meminfo)
SWP=0; [ "${SWT:-0}" -gt 0 ] && SWP=$(( 100 - 100*SWF/SWT ))
NVT=0
for hw in /sys/class/hwmon/hwmon*; do
  [ "$(cat "$hw/name" 2>/dev/null)" = "nvme" ] || continue
  v=$(cat "$hw/temp1_input" 2>/dev/null || echo 0); [ "${v:-0}" -gt $((NVT*1000)) ] && NVT=$((v/1000))
done
TEMP=0
for hw in /sys/class/hwmon/hwmon*; do
  [ "$(cat "$hw/name" 2>/dev/null)" = "coretemp" ] || continue
  for f in "$hw"/temp*_input; do
    v=$(cat "$f" 2>/dev/null || echo 0)
    [ "${v:-0}" -gt $((TEMP*1000)) ] && TEMP=$((v/1000))
  done
done

# --- Temperatures detaillees ---
# NVT ci-dessus ne garde que le MAXIMUM des deux disques : on perd lequel
# chauffe. On releve donc chacun separement.
# ⚠️ LE CHEMIN NOYAU N EST PAS UNE IDENTITE : le noyau 6.18 a interverti nvme0
# et nvme1, et les deux courbes se sont echangees en silence. Le slot vient
# desormais du NUMERO DE SERIE (`nvme-slots.sh`). Un slot vide rend un
# controleur vide, le chemin ne correspond a rien, la temperature retombe a 0,
# ce que la page ecarte deja.
# `temp1_input` est le capteur « Composite », celui que SMART rapporte ; les
# suivants sont des points chauds toujours plus eleves (57 C contre 46), on ne
# les enregistre pas pour rester comparable.
# La machine a QUATRE emplacements M.2 : on les releve tous d office, un disque
# ajoute plus tard sera pris en compte sans retoucher ce script.
SLOTS=$(/volume1/docker/homelab/nvme-slots.sh 2>/dev/null)
ctrl() { echo "$SLOTS" | awk -v n="$1" '$1==n { print $2; exit }'; }
NV0=$(cat /sys/class/nvme/$(ctrl 0)/hwmon*/temp1_input 2>/dev/null | head -n 1)
NV1=$(cat /sys/class/nvme/$(ctrl 1)/hwmon*/temp1_input 2>/dev/null | head -n 1)
NV2=$(cat /sys/class/nvme/$(ctrl 2)/hwmon*/temp1_input 2>/dev/null | head -n 1)
NV3=$(cat /sys/class/nvme/$(ctrl 3)/hwmon*/temp1_input 2>/dev/null | head -n 1)
NV0=$(( ${NV0:-0} / 1000 )); NV1=$(( ${NV1:-0} / 1000 ))
NV2=$(( ${NV2:-0} / 1000 )); NV3=$(( ${NV3:-0} / 1000 ))
# Controleur reseau 10 GbE, capteur PHY (temp1 ; temp2 est le MAC, meme valeur).
# Il tourne autour de 71 C en permanence : c est NORMAL par conception, et ca
# avait ete pris pour une surchauffe le 12/07. L enregistrer evite d y revenir.
ETH=0
for hw in /sys/class/hwmon/hwmon*; do
  [ "$(cat "$hw/name" 2>/dev/null)" = "eth0" ] || continue
  v=$(cat "$hw/temp1_input" 2>/dev/null || echo 0); ETH=$(( ${v:-0} / 1000 ))
done

# --- Site public : joignabilite, temps de reponse, expiration du certificat ---
# ⚠️ `%{http_code}` est indispensable : en cas d echec curl ecrit quand meme une
# duree (8000 ms sur un delai depasse, 0 sur un refus de connexion), le temps
# seul ne permet donc pas de conclure. Sans code valide, SMS est laisse VIDE
# pour que la mesure ratee n entre pas dans la moyenne de l historique.
#
# ⚠️ SUP vaut 1 ou 2, JAMAIS 0. history-build.sh ecrit 0 pour un creneau sans
# donnee ; sans cette convention on ne distinguerait pas « le site etait mort »
# de « la colonne n existait pas encore », et le ruban de la carte Site serait
# ecarlate pendant ses premieres 24 heures.
SRAW=$(curl -s -o /dev/null --max-time 8 -w '%{http_code} %{time_total}' \
  ${SITE_URL:-https://example.com} 2>/dev/null)
SCODE=$(echo "$SRAW" | awk '{print $1+0}')
SMS=$(echo "$SRAW" | awk '{printf "%d", $2*1000}')
case "$SCODE" in 200|301|302|307|308) SUP=1; SOK=true;; *) SUP=2; SOK=false; SMS="";; esac
SCERT=$(jq -r '.site.cert // -1' "$OUT" 2>/dev/null)
case "$SCERT" in ''|*[!0-9-]*) SCERT=-1;; esac
# Un certificat ne bouge pas d une minute a l autre : verifie a l heure ronde seulement.
if [ "$(date +%M)" = "00" ] || [ "$SCERT" -le 0 ]; then
  CE=$(echo | timeout 8 openssl s_client -connect ${SITE_HOTE:-example.com}:443 -servername ${SITE_HOTE:-example.com} 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  [ -n "$CE" ] && SCERT=$(( ( $(date -d "$CE" +%s) - NOWS ) / 86400 ))
fi

# --- qBittorrent ---
# ⚠️ UNE SEULE REQUETE. `sync/maindata` renvoie `server_state` ET l objet
# `torrents` au complet : compter les torrents ne demande pas un appel a
# `torrents/info`. Le collecteur passant deux fois par minute, ce retrait evite
# 2880 requetes et 5760 lancements de jq par jour.
g -c "$TMP/qb" -d "username=$HOMEPAGE_VAR_QBIT_USER&password=$HOMEPAGE_VAR_QBIT_PASS" \
  "http://$IP:8080/api/v2/auth/login" >/dev/null
QMD=$(g -b "$TMP/qb" "http://$IP:8080/api/v2/sync/maindata")
QB=$(echo "$QMD" | jq -c '.server_state // {}')
QNB=$(echo "$QMD" | jq -r '(.torrents // {}) | length' 2>/dev/null)
case "$QNB" in ''|*[!0-9]*) QNB=0;; esac
QDL=$(echo "$QB" | jq -r '.dl_info_speed // 0'); QUL=$(echo "$QB" | jq -r '.up_info_speed // 0')
QRT=$(echo "$QB" | jq -r '.global_ratio // "0"')
QAD=$(echo "$QB" | jq -r '.alltime_dl // 0'); QAU=$(echo "$QB" | jq -r '.alltime_ul // 0')

# ⚠️ `connection_status` vaut connected, firewalled ou disconnected.
# FIREWALLED est le cas vicieux : le client fonctionne, telecharge, n affiche
# aucune erreur, mais son port entrant est injoignable. Plus personne ne peut
# lui demander quoi que ce soit et le ratio cesse de monter sans que rien n ait
# l air casse. C est la seule condition d alerte de la carte.
QCX=$(echo "$QB" | jq -r '.connection_status // ""')
QPR=$(echo "$QB" | jq -r '.total_peer_connections // 0')

# --- qBittorrent : ratio PAR TRACKER, et dette de partage ---
# ⚠️ SEUIL FIXE, et NON PLUS la preference du client. La limite de partage de
# qBittorrent a ete DESACTIVEE pour que les torrents sement au-dela de trois
# jours — mais la preference valait alors 0, et le `if $s <= 0 then 0` des deux
# calculs plus bas aurait fait tomber la dette a zero POUR TOUJOURS, sans le
# moindre signe : une pastille muette qui affirme que tout va bien est pire que
# pas de pastille.
# Ce seuil est l ENGAGEMENT envers les trackers prives — trois jours de partage
# minimum — et non le moment ou le client s arrete, puisqu il ne s arrete plus.
QLIM=4320

# ⚠️ Correspondance ECRITE A LA MAIN. Vega annonce sous deux hotes distincts :
# aucune regle ne peut deviner qu ils designent le meme tracker. Un hote absent
# de la table s affiche tel quel, ce qui le signale plutot que de le taire.
QTR=$(echo "$QMD" | jq -c '
  {"tracker.orion.example":"Orion","vega.example":"Vega","tk.vega.example":"Vega",
   "tk.altair.example":"Altair"} as $noms
  | [ (.torrents // {}) | to_entries[] | .value
      | select(((.tracker // "") | length) > 0)
      | ((.tracker | split("/")[2]) // "?") as $h
      | { n: ($noms[$h] // $h), u: (.uploaded // 0), d: (.downloaded // 0) } ]
  | group_by(.n)
  | map({ n: .[0].n, u: (map(.u) | add), d: (map(.d) | add) })
  | map(. + { r: (if .d > 0 then ((.u / .d * 100 | floor) / 100) else 0 end) })
  | sort_by(-.u)' 2>/dev/null)
echo "$QTR" | jq -e . >/dev/null 2>&1 || QTR='[]'

# --- ratio REEL de chaque tracker, joint depuis ratios.sh ---
# ⚠️ AUCUNE REQUETE RESEAU ICI. Ce collecteur tourne deux fois par minute ; il
# se contente de lire le fichier ecrit une fois par heure par `ratios.sh`.
# Fichier absent, vide ou corrompu : `vr` vaut null, et la carte le dit plutot
# que d inventer un chiffre.
# ⚠️ La jointure se fait sur le NOM normalise (`.n`), pas sur l hote : Vega
# annonce sous deux hotes distincts, et `ratios.sh` ne connait que le nom.
RAT=$(cat /volume1/docker/homelab/www/ratios.json 2>/dev/null)
echo "$RAT" | jq -e . >/dev/null 2>&1 || RAT='{}'
# ⚠️ UNION et non simple jointure. Les ratios viennent des SITES des trackers,
# pas de qBittorrent : ils restent valables meme sans aucun torrent charge. Les
# greffer uniquement sur la liste du client faisait disparaitre la carte entiere
# des que la file se vidait — vecu le 01/09/2026, la file etant tombee a zero.
# Un tracker connu de `ratios.json` mais absent du client est donc ajoute, avec
# des compteurs a zero ; un tracker deja present garde SES chiffres, sans
# doublon possible puisque l ajout est conditionne a son absence.
QTR=$(echo "$QTR" | jq -c --argjson x "$RAT" '
  map(. + {vr: ($x[.n] // null)}) as $q
  | [ ($x | keys_unsorted[]) | select(. != "maj") | select(($x[.] | type) == "object") ] as $noms
  | $q + [ $noms[] as $n
           | select(($q | map(.n) | index($n)) == null)
           | { n: $n, u: 0, d: 0, r: 0, vr: $x[$n] } ]' 2>/dev/null)
echo "$QTR" | jq -e . >/dev/null 2>&1 || QTR='[]'

# Torrents ARRETES avant d avoir rendu leur du. La marge de 300 s absorbe
# l ecart entre le moment ou qBittorrent atteint la limite et celui ou il
# arrete — c est la meme que celle de `purge-cross-seed.py`.
# ⚠️ `stoppedUP` ET `pausedUP` : qBittorrent 5 a renomme l etat, la forme
# ancienne reste possible sur une reprise de configuration.
QDET=$(echo "$QMD" | jq -r --argjson lim "$QLIM" '
  ($lim * 60) as $s
  | if $s <= 0 then 0 else
      [ (.torrents // {}) | to_entries[] | .value
        | select(((.state // "") | test("^(stopped|paused)UP$")))
        | select(((.seeding_time // 0) < $s - 300)) ] | length
    end' 2>/dev/null)
case "$QDET" in ''|*[!0-9]*) QDET=0;; esac

# --- Radarr / Sonarr ---
RK=$HOMEPAGE_VAR_RADARR_KEY; SK=$HOMEPAGE_VAR_SONARR_KEY
RMIS=$(g "http://$IP:7878/api/v3/wanted/missing?apikey=$RK" | jq -r '.totalRecords // 0')
RQ=$(g "http://$IP:7878/api/v3/queue?apikey=$RK" | jq -r '.totalRecords // 0')
RSZ=$(g "http://$IP:7878/api/v3/movie?apikey=$RK" | jq '[.[].sizeOnDisk] | add // 0')
SMIS=$(g "http://$IP:8989/api/v3/wanted/missing?apikey=$SK" | jq -r '.totalRecords // 0')
SQ=$(g "http://$IP:8989/api/v3/queue?apikey=$SK" | jq -r '.totalRecords // 0')
SSZ=$(g "http://$IP:8989/api/v3/series?apikey=$SK" | jq '[.[].statistics.sizeOnDisk] | add // 0')

# --- Prowlarr ---
# ⚠️ `/health` est la SEULE source d alerte de la carte. Prowlarr y signale
# lui-meme un indexeur devenu indisponible apres trop d echecs — la panne qui
# coupe silencieusement l approvisionnement de Radarr et Sonarr. Un indexeur
# desactive A LA MAIN n y figure pas, et c est voulu : c est un choix, pas une
# panne. La carte n avait aucune condition d alerte avant le 25/08/2026.
PK="apikey=$HOMEPAGE_VAR_PROWLARR_KEY"
PHL=$(g "http://$IP:9696/api/v1/health?$PK")
PSA=$(echo "$PHL" | jq 'length' 2>/dev/null)
case "$PSA" in ''|*[!0-9]*) PSA=0;; esac
PMSG=$(echo "$PHL" | jq -r '.[0].message // ""' 2>/dev/null | tr -d '\r\n')

# Statistiques PAR INDEXEUR, plus sommees. Le taux global qu affichait la carte
# jusqu au 25/08 valait 52 %, moyenne de 100 %, 37 % et 33 % : une valeur unique
# ne pouvait decrire aucun des trois. Seules `n` et `g` sont retenues, le reste
# — requetes, echecs cumules, temps de reponse — n a pas d usage a l ecran.
# ⚠️ Le nom est raccourci : « Orion Reborn (API) » ne tient pas dans une pastille
# de carte etroite, qui passe en `white-space: nowrap` des trois pastilles.
PS=$(g "http://$IP:9696/api/v1/indexerstats?$PK")
PIX=$(echo "$PS" | jq -c '[.indexers[]? | {
  n: ((.indexerName // "?") | sub(" *\\(API\\)$"; "")),
  g: (.numberOfGrabs // 0) }]' 2>/dev/null)
echo "$PIX" | jq -e . >/dev/null 2>&1 || PIX='[]'

# --- Bazarr ---
BZE=$(g "http://$IP:6767/api/episodes/wanted?apikey=$HOMEPAGE_VAR_BAZARR_KEY" | jq -r '.total // 0')
BZM=$(g "http://$IP:6767/api/movies/wanted?apikey=$HOMEPAGE_VAR_BAZARR_KEY" | jq -r '.total // 0')

# --- Jellyfin ---
JC=$(g "http://$IP:8096/Items/Counts?api_key=$HOMEPAGE_VAR_JELLYFIN_KEY")
JM=$(echo "$JC" | jq -r '.MovieCount // 0'); JS=$(echo "$JC" | jq -r '.SeriesCount // 0')
JE=$(echo "$JC" | jq -r '.EpisodeCount // 0')
JNOW=$(g "http://$IP:8096/Sessions?api_key=$HOMEPAGE_VAR_JELLYFIN_KEY" \
  | jq -r '[.[] | select(.NowPlayingItem) | "\(.UserName) — \(.NowPlayingItem.Name)"] | join(" · ")')

# --- Seerr ---
SR=$(g -H "X-Api-Key: $HOMEPAGE_VAR_SEERR_KEY" "http://$IP:5055/api/v1/request/count")
SRP=$(echo "$SR" | jq -r '.pending // 0'); SRA=$(echo "$SR" | jq -r '.completed // 0')

# --- AdGuard ---
AG=$(g -u "$HOMEPAGE_VAR_ADGUARD_USER:$HOMEPAGE_VAR_ADGUARD_PASS" "http://$IP:3000/control/stats")
AQ=$(echo "$AG" | jq -r '.num_dns_queries // 0'); AB=$(echo "$AG" | jq -r '.num_blocked_filtering // 0')
AL=$(echo "$AG" | jq -r '(.avg_processing_time // 0) * 1000 | floor')

# --- Kuma : actifs, inactifs, stabilité moyenne ---
KH=$(g "http://$IP:3001/api/status-page/heartbeat/$HOMEPAGE_VAR_KUMA_SLUG")
KU=$(echo "$KH" | jq '[.heartbeatList[] | last | .status] | map(select(.==1)) | length')
KD=$(echo "$KH" | jq '[.heartbeatList[] | last | .status] | map(select(.==0)) | length')
KPC=$(echo "$KH" | jq '[.uptimeList[]] | if length>0 then ((add/length*1000|floor)/10) else 0 end')

# --- Kuma : etat PAR GROUPE, avec le nom des sondes en defaut ---
# La carte annoncait « 3 sondes hors ligne » sans dire lesquelles.
# ⚠️ DEUX POINTS D ENTREE, joints sur l identifiant : `/status-page/<slug>` donne
# la COMPOSITION des groupes, `/heartbeat/<slug>` l ETAT courant. Aucun des deux
# ne porte les deux informations.
# ⚠️ Les identifiants sont des ENTIERS cote composition et des CHAINES cote
# battements : sans `tostring` la jointure ne remonte rien, en silence.
# ⚠️ Une sonde sans battement (fraichement creee) vaut « en ligne » par defaut :
# elle est en attente, pas en echec.
KS=$(g "http://$IP:3001/api/status-page/$HOMEPAGE_VAR_KUMA_SLUG")
# ⚠️ `$KH` PESE 177 Ko. Le passer en `--argjson` depasse la taille maximale d un
# argument (128 Ko) : l execve echoue avec « Argument list too long », jq ne
# demarre meme pas, et `2>/dev/null` rendait la panne totalement muette. Les
# autres lectures de $KH y echappent parce qu elles passent par l ENTREE
# STANDARD. On reduit donc d abord, sur stdin, a un objet identifiant -> dernier
# statut : quelques centaines d octets, passables en argument sans risque.
KLAST=$(printf '%s' "$KH" | jq -c '(.heartbeatList // {}) | map_values(last | .status)' 2>/dev/null)
case "$KLAST" in ''|null) KLAST='{}';; esac
echo "$KLAST" | jq -e . >/dev/null 2>&1 || KLAST='{}'

# --- Kuma : une colonne d historique, meme convention que siteup et vpnup ---
# ⚠️ 1 = toutes les sondes repondent, 2 = au moins une en defaut, et le 0 est
# RESERVE a l absence de mesure. C est ce zero qui rendra le ruban neutre
# pendant les 24 h de remplissage, au lieu d ecarlate.
# ⚠️ « en defaut » = tout ce qui n est ni 1 (en ligne) ni 3 (maintenance). Le
# statut 2 (tentatives en cours) en fait partie : sans lui on reste aveugle
# pendant les deux minutes mesurees le 28/08 sur l arret de diun.
KKO=$(echo "$KLAST" | jq '[.[]] | map(select(. != 1 and . != 3)) | length' 2>/dev/null)
case "$KKO" in ''|*[!0-9]*) KKO=0;; esac
if [ "$KKO" -gt 0 ]; then KUP=2; else KUP=1; fi

# Temps de fonctionnement du NAS. Un redemarrage non ordonne ne laissait aucune
# trace visible sur la page : le compteur repart de zero, et c est justement ce
# saut qui constitue l information.
UPT=$(cut -d. -f1 /proc/uptime 2>/dev/null)
case "$UPT" in ''|*[!0-9]*) UPT=0;; esac

# --- cross-seed : son activite reelle ---
# ⚠️ DEUX SOURCES, une seule nouvelle. Les torrents viennent de `$QMD`, deja
# recupere pour la carte qBittorrent : aucun appel de plus. Seule la base de
# cross-seed est une lecture nouvelle, et elle est LOCALE.
# ⚠️ Lecture en `-readonly` : le demon ecrit dans cette base, on ne s y invite
# pas. Le WAL de 4 Mo est lu au passage, sans quoi on verrait l etat du 25/08.
# ⚠️ `job_log.last_run` est en MILLISECONDES.
CSDB=/volume1/docker/arr/cross-seed/cross-seed.db
CSL=$(sqlite3 -readonly -separator '|' "$CSDB" \
  "select ifnull((select last_run/1000 from job_log where name='search'),0),
          (select count(*) from decision where decision='MATCH'),
          (select count(*) from searchee),
          (select count(*) from indexer where active=1),
          (select count(*) from indexer);" 2>/dev/null)
CSRUN=$(echo "$CSL" | cut -d'|' -f1); CSM=$(echo "$CSL" | cut -d'|' -f2)
CSS=$(echo "$CSL" | cut -d'|' -f3); CSIA=$(echo "$CSL" | cut -d'|' -f4)
CSIT=$(echo "$CSL" | cut -d'|' -f5)
for v in CSRUN CSM CSS CSIA CSIT; do
  eval "x=\$$v"; case "$x" in ''|*[!0-9]*) eval "$v=0";; esac
done

# ⚠️ Le compte « a purger » applique EXACTEMENT la regle de purge-cross-seed.py :
# torrent arrete, dans /data/cross-seed, ayant rendu son temps a 300 s pres.
# Deux regles qui divergeraient annonceraient une suppression qui n arrive pas.
CSQ=$(echo "$QMD" | jq -c --argjson lim "$QLIM" '
  ($lim * 60) as $s
  | [ (.torrents // {}) | to_entries[] | .value
      | select(((.save_path // "") | test("cross-seed"))) ] as $t
  | { nb: ($t | length),
      taille: (($t | map(.size) | add) // 0),
      envoye: (($t | map(.uploaded) | add) // 0),
      actifs: ([ $t[] | select(((.state // "") | test("UP$"))) 
                      | select(((.state // "") | test("^(stopped|paused)") | not)) ] | length),
      purge: (if $s <= 0 then 0 else
               [ $t[] | select(((.state // "") | test("^(stopped|paused)UP$")))
                      | select(((.seeding_time // 0) >= $s - 300)) ] | length end) }' 2>/dev/null)
echo "$CSQ" | jq -e . >/dev/null 2>&1 || CSQ='{}'

CS=$(jq -nc --argjson q "$CSQ" --argjson run "$(n $CSRUN)" --argjson m "$(n $CSM)" \
     --argjson s "$(n $CSS)" --argjson ia "$(n $CSIA)" --argjson it "$(n $CSIT)" \
     '$q + {run:$run, match:$m, suivis:$s, idx:$ia, idxtot:$it}' 2>/dev/null)
echo "$CS" | jq -e . >/dev/null 2>&1 || CS='{}'
# ⚠️ KUMA A QUATRE STATUTS, pas deux : 0 hors ligne, 1 en ligne, 2 EN ATTENTE
# (tentatives en cours), 3 en maintenance. Mesure : un conteneur arrete passe en
# 2 au bout d une minute et y reste plus de deux minutes avant toute bascule en
# 0. Ne retenir que le 0 rend AVEUGLE pendant toute cette fenetre — la page
# passait au rouge grace a la carte des conteneurs pendant que la carte Kuma
# restait verte.
# Une sonde en attente echoue DEJA. On la compte, sous un autre mot.
KG=$(jq -n --argjson s "${KS:-null}" --argjson e "$KLAST" '
  if ($s | type) != "object" then []
  else [ ($s.publicGroupList // [])[]
         | { n: .name, tot: ((.monitorList // []) | length),
             noms: [ (.monitorList // [])[] | . as $m
                     | select((($e[($m.id | tostring)]) // 1) == 0) | $m.name ],
             natt: [ (.monitorList // [])[] | . as $m
                     | select((($e[($m.id | tostring)]) // 1) == 2) | $m.name ] }
         | . + { ko: (.noms | length), att: (.natt | length) } ]
  end' 2>/dev/null)
case "$KG" in ''|null) KG='[]';; esac
echo "$KG" | jq -e . >/dev/null 2>&1 || KG='[]'

# --- CRM ---
LEADS=$(docker exec portfolio-postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from contacts where status='"'"'non_lu'"'"'"' 2>/dev/null | tr -d ' ')

# --- CRM : total, traites, anciennete du dernier contact ---
CRMX=$(docker exec portfolio-postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAF"|" -c "select count(*), count(*) filter (where status <> '"'"'non_lu'"'"'), coalesce(now()::date - max(created_at)::date, -1) from contacts"' 2>/dev/null | tr -d ' ')
CTOT=$(echo "$CRMX" | cut -d'|' -f1); CTRT=$(echo "$CRMX" | cut -d'|' -f2); CAGE=$(echo "$CRMX" | cut -d'|' -f3)

# --- Umami : visiteurs, visites, pages vues ---
UTK=$(g -X POST "http://$IP:3002/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$HOMEPAGE_VAR_UMAMI_USER\",\"password\":\"$HOMEPAGE_VAR_UMAMI_PASS\"}" | jq -r .token)
US=$(g -H "Authorization: Bearer $UTK" \
  "http://$IP:3002/api/websites/${UMAMI_SITE_ID}/stats?startAt=$(( $(date -d '7 days ago' +%s) * 1000 ))&endAt=$(date +%s000)")
UV=$(echo "$US" | jq -r '.visitors // 0'); UP7=$(echo "$US" | jq -r '.pageviews // 0')
UVI=$(echo "$US" | jq -r '.visits // 0')
UPV=$(g -H "Authorization: Bearer $UTK" \
  "http://$IP:3002/api/websites/${UMAMI_SITE_ID}/pageviews?startAt=$(( $(date -d '7 days ago' +%s) * 1000 ))&endAt=$(date +%s000)&unit=day&timezone=Europe/Brussels")
UDAYS=$(for i in 6 5 4 3 2 1 0; do date -d "$i days ago" +%Y-%m-%d; done \
  | jq -R -s -c 'split("\n") | map(select(length>0))')
USERIE=$(echo "$UPV" | jq -c --argjson d "$UDAYS" '
  ([.sessions[]? | {key:((.x|tostring)[0:10]), value:.y}] | from_entries) as $m
  | [ $d[] | ($m[.] // 0) ]' 2>/dev/null)
echo "$USERIE" | jq -e . >/dev/null 2>&1 || USERIE='[]'

# --- WireGuard : noms des clients connectés (mappés depuis wg0.conf) ---
MAP=$(docker exec wg-easy sh -c 'cat /etc/wireguard/wg0.conf' 2>/dev/null \
  | awk '/^# Client:/{n=$3} /^PublicKey/{print $3" "n}')
WD=$(docker exec wg-easy wg show wg0 dump 2>/dev/null | tail -n +2)
WT=$(echo "$WD" | awk 'NF{t++} END{print t+0}')
WNAMES=""
for k in $(echo "$WD" | awk -v n="$NOWS" 'NF && $5>0 && n-$5<150 {print $1}'); do
  nm=$(echo "$MAP" | grep -F "$k " | awk '{print $2}')
  WNAMES="${WNAMES}${WNAMES:+, }${nm:-inconnu}"
done
WC=$(echo "$WD" | awk -v n="$NOWS" 'NF && $5>0 && n-$5<150 {c++} END{print c+0}')
WCL=$(echo "$WD" | awk -v n="$NOWS" 'NF{print $1"\t"(($5>0 && n-$5<150)?1:0)}' \
  | while IFS=$'\t' read -r k on; do
      nm=$(echo "$MAP" | grep -F "$k " | awk '{print $2}')
      printf '%s\t%s\n' "${nm:-inconnu}" "$on"
    done \
  | jq -R -s -c 'split("\n") | map(select(length>0) | split("\t") | {n:.[0], on:(.[1]=="1")})' 2>/dev/null)
echo "$WCL" | jq -e . >/dev/null 2>&1 || WCL='[]'

# --- Gluetun : IP publique du tunnel, port entrant, santé ---
GIP=$(docker exec arr-gluetun cat /tmp/gluetun/ip 2>/dev/null | tr -d '\r\n')
GPORT=$(docker exec arr-gluetun cat /tmp/gluetun/forwarded_port 2>/dev/null | tr -d '\r\n')
GH=$(docker inspect -f '{{.State.Health.Status}}' arr-gluetun 2>/dev/null)
# Le fichier de port ne prouve RIEN : le 22/08 il annoncait 61310 alors que
# Proton ne routait plus rien (mapping NAT-PMP expire cote serveur). Seul un
# vrai test TCP sur l IP publique du tunnel distingue un port vivant d un port
# fantome. bash est appele explicitement car dash n a pas /dev/tcp.
GOPEN=false
if [ -n "$GIP" ] && [ -n "$GPORT" ]; then
  timeout 5 bash -c "cat < /dev/null > /dev/tcp/$GIP/$GPORT" 2>/dev/null && GOPEN=true
fi
# Joignabilite du port entrant pour l historique, meme convention que `siteup` :
# 1 joignable, 2 injoignable, JAMAIS 0 — history-build.sh reserve le 0 aux
# creneaux sans mesure, et sans cette distinction le ruban de la carte serait
# ecarlate pendant ses 24 premieres heures.
# ⚠️ La valeur vient du TEST TCP, pas du fichier de port. Le 24/08, Proton
# reattribuait le meme port 264 fois en 24 heures, avec un trou entre chaque :
# le fichier existait la plupart du temps, le port ne repondait pas.
[ "$GOPEN" = true ] && VUP=1 || VUP=2
# Le log n est relu QUE si la localisation manque ou si l IP a change :
# lire 800 lignes de journal a chaque passage etait le poste le plus cher du script.
GPREV=$(jq -r '.vpn.ip // ""' "$OUT" 2>/dev/null)
GLOC=$(jq -r '.vpn.loc // ""' "$OUT" 2>/dev/null)
if [ -z "$GLOC" ] || [ "$GIP" != "$GPREV" ]; then
  GLOC=$(docker logs --tail 800 arr-gluetun 2>&1 | grep -i 'Public IP address is' | tail -1 \
    | sed -n 's/.*(\([^)]*\) - source.*/\1/p' | awk -F', ' '{print $NF", "$1}')
fi

# --- Disque : taille totale, pour la barre de composition ---
DTOT=$(df -B1 /volume1 2>/dev/null | awk 'NR==2{print $2}')

# --- Sauvegarde : horodatage et ancienneté ---
BST=$(stat -c %Y /var/lib/nas-backup.last 2>/dev/null || echo 0)
if [ "$BST" -gt 0 ]; then
  BDATE=$(date -d "@$BST" '+%d/%m à %H:%M'); BAGO=$(( (NOWS - BST) / 3600 ))
else BDATE="jamais"; BAGO=-1; fi

# Age du dernier controle, en heures, releve sur le `mtime` du fichier.
# `updates.json` ne porte que la chaine d affichage « 25/08 00:17 », pas
# d horodatage exploitable — mais il est reecrit a chaque controle, par le cron
# de 7 h comme par `maj-watch.sh` apres une mise a jour appliquee. Sa date de
# modification est donc un temoin fidele, sans rien changer a check-updates.sh.
# ⚠️ Sans cette mesure, un `check-updates.sh` mort laissait la carte afficher
# « Tout est a jour » indefiniment, compteur fige sur sa derniere valeur.
UPDF=/volume1/docker/homelab/www/updates.json
UPD=$(cat "$UPDF" 2>/dev/null || echo '{}')
UPDT=$(stat -c %Y "$UPDF" 2>/dev/null || echo 0)
if [ "${UPDT:-0}" -gt 0 ]; then UPDH=$(( (NOWS - UPDT) / 3600 )); else UPDH=-1; fi

jq -n --argjson m "{\"cpu\":$CPU,\"ram\":$RAM,\"up\":$UP,\"run\":$RUN,\"all\":$ALL,\"ramu\":$((MT-MA)),\"ramt\":$MT,\"cores\":$CORES,\"net\":$NET,\"disk\":$DPC,\"load\":$LOAD1,\"load5\":$LOAD5,\"load15\":$LOAD15,\"temp\":$TEMP,\"dr\":$DR,\"dw\":$DW,\"swap\":$SWP,\"nvme\":$NVT}" \
  --argjson r "{\"mis\":$(n $RMIS),\"q\":$(n $RQ),\"size\":$(n $RSZ)}" \
  --argjson s "{\"mis\":$(n $SMIS),\"q\":$(n $SQ),\"size\":$(n $SSZ)}" \
  --argjson p "{\"sante\":$(n $PSA),\"ix\":$PIX}" --arg pmsg "$PMSG" \
  --argjson b "{\"ep\":$(n $BZE),\"mv\":$(n $BZM)}" \
  --argjson q "{\"dl\":$(n $QDL),\"ul\":$(n $QUL),\"ratio\":\"$QRT\",\"adl\":$(n $QAD),\"aul\":$(n $QAU),\"etat\":\"$QCX\",\"pairs\":$(n $QPR),\"nb\":$(n $QNB),\"dette\":$(n $QDET)}" \
  --argjson qtr "$QTR" \
  --argjson j "{\"films\":$(n $JM),\"series\":$(n $JS),\"episodes\":$(n $JE)}" --arg jnow "$JNOW" \
  --argjson se "{\"pending\":$(n $SRP),\"done\":$(n $SRA)}" \
  --argjson ag "{\"q\":$(n $AQ),\"b\":$(n $AB),\"lat\":$(n $AL)}" \
  --argjson k "{\"up\":$(n $KU),\"down\":$(n $KD),\"pc\":$(n $KPC)}" \
  --argjson w "{\"c\":$(n $WC),\"t\":$(n $WT)}" --arg wn "$WNAMES" \
  --argjson v "{\"ip\":\"$GIP\",\"port\":$(n $GPORT),\"health\":\"$GH\",\"open\":$GOPEN}" --arg vloc "$GLOC" \
  --argjson u "{\"visitors\":$(n $UV),\"views\":$(n $UP7),\"visits\":$(n $UVI)}" \
  --argjson upd "$UPD" --argjson updh "$UPDH" --argjson leads "$(n $LEADS)" \
  --argjson bago "$BAGO" --arg bdate "$BDATE" --arg ts "$(date '+%H:%M')" \
  --argjson wcl "$WCL" --argjson us "$USERIE" \
  --argjson crm "{\"tot\":$(n $CTOT),\"traites\":$(n $CTRT),\"age\":$(n $CAGE)}" \
  --argjson site "{\"ms\":$(n $SMS),\"cert\":$SCERT,\"ok\":$SOK}" --argjson dtot "$(n $DTOT)" \
  --argjson kg "$KG" --argjson cs "$CS" \
  --argjson upt "$(n $UPT)" \
  '{ts:$ts,nas:($m+{disktot:$dtot,uptime:$upt}),radarr:$r,sonarr:$s,prowlarr:($p+{msg:$pmsg}),
    bazarr:$b,qbit:($q+{tr:$qtr}),jellyfin:($j+{now:$jnow}),seerr:$se,adguard:$ag,
    kuma:($k+{groupes:$kg}),wg:($w+{noms:$wn,clients:$wcl}),vpn:($v+{loc:$vloc}),
    umami:($u+{serie:$us}),site:$site,crm:$crm,updates:($upd+{age:$updh}),leads:$leads,
    backup:{h:$bago,date:$bdate},cross:$cs}' > "$OUT.tmp"
# ECRITURE ATOMIQUE. La page relit `data.json` toutes les 5 s et ce collecteur
# l ecrivait en direct : elle tombait regulierement sur un fichier tronque, d ou
# des « data.json illisible » en console. `mv` est atomique dans le meme dossier :
# un lecteur voit l ancien fichier entier, ou le nouveau, jamais un demi-fichier.
# ⚠️ On ne sort PAS en cas d echec : la ligne CSV qui suit alimente l historique
# et reste utile meme si l assemblage JSON a rate.
if [ -s "$OUT.tmp" ] && jq -e . "$OUT.tmp" >/dev/null 2>&1; then
  mv "$OUT.tmp" "$OUT"; chmod 644 "$OUT"; jq . "$OUT" | head -30
else
  rm -f "$OUT.tmp"; echo "data.json NON remplace : assemblage jq en echec" >&2
fi

# --- Historique : une ligne par passage, en CSV (bien plus leger que du JSON) ---
# ⚠️ TROIS REGLES :
#
# 1. CE BLOC EST LE DERNIER DU SCRIPT, ET IL DOIT LE RESTER. Place au milieu du
#    fichier, il laissait trois mesures — le site, qBittorrent, Gluetun — se
#    calculer APRES lui, donc invisibles a l historique. Ecrit en dernier, il
#    voit tout.
# 2. Toute colonne ajoutee ici doit l etre AUSSI dans history-build.sh (`NC` et
#    la liste `champs`), sans quoi elle n atteindra jamais la page.
# 3. On AJOUTE TOUJOURS EN FIN, jamais au milieu. Deplacer une colonne rendrait
#    faux tout l historique deja enregistre, sans le moindre signe exterieur :
#    la page a longtemps trace la colonne 12 sous l etiquette « swap » alors que
#    le swap etait en 11, invisible parce que 43 % et 46 °C dessinent la meme
#    ligne. D ou l ordre inesthetique ci-dessous, nvme2 et nvme3 apres eth0 :
#    c est l ordre d apparition. La page cherche ses colonnes PAR NOM.
printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$NOWS" "$CPU" "$RAM" "$DPC" "$NET" \
  "$LOAD1" "$TEMP" "$DR" "$DW" "$LOAD5" "$LOAD15" "$SWP" "$NVT" "$NV0" "$NV1" "$ETH" "$NV2" "$NV3" \
  "$SMS" "$SUP" "$QDL" "$QUL" "$VUP" "$KUP" \
  >> /volume1/docker/homelab/history.csv
