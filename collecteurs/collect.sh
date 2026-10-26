#!/bin/bash
# Collecte toutes les sources du homelab dans un seul data.json
#
#   collect.sh            passage normal (cron root, deux fois par minute)
#   collect.sh --essai    meme collecte, ecrite dans /tmp/collect-essai.json, sans
#                         rien toucher d autre (ni historique, ni etats, ni caches)
#
# ⚠️ REECRIT POUR LE COUT LE 08/10/2026 (audit, etape 3). Mesure sur le NAS :
# environ 690 processus par passe, deux passes par minute, 48 % du processeur
# de toute la supervision, sur une machine dont la memoire est le goulot. Trois
# causes, trois remedes :
#   1. de petits sous-processus partout (`$(n …)` soixante-dix fois, `cat`, `awk`,
#      `wc`) : les lectures de /proc et /sys et les conversions passent par les
#      builtins de bash ;
#   2. des donnees LENTES interrogees toutes les 30 s (la bibliotheque complete de
#      Radarr et Sonarr, Umami, le CRM…) : elles sont relevees toutes les 5 min,
#      et gardees entre deux releves (`lent.sh`) ;
#   3. le meme JSON de qBittorrent relu par une dizaine de `jq` : un seul `jq`
#      par source.
# Le contenu de data.json n a pas change.
#
# ⚠️ AUCUN SECRET SUR LA LIGNE DE COMMANDE : elle est lisible par tout compte du
# NAS (`ps`, /proc/<pid>/cmdline). Mots de passe et cles passent par des fichiers
# prives (`-K`, `--data-binary @fichier`), dans un dossier `mktemp -d` en 700,
# efface en sortie ; les cles d API sont des EN-TETES, plus des parametres d URL.
set -uo pipefail
set -a; . /volume1/docker/tools/homepage.env; set +a
ICI=/volume1/docker/homelab

# --- Ce qui identifie l installation : collect.conf, SANS SECRET ---
# Valeurs par defaut ci-dessous ; `collect.conf`, a cote, les remplace. Ce
# fichier rend le script IDENTIQUE partout : seule la configuration differe.
: "${NAS_IP:=nas.local}" "${SITE_URL:=https://example.com}" "${SITE_HOTE:=example.com}" "${UMAMI_SITE_ID:=}"
PORT_QBIT=8080; PORT_RADARR=7878; PORT_SONARR=8989; PORT_PROWLARR=9696; PORT_BAZARR=6767
PORT_JELLYFIN=8096; PORT_SEERR=5055; PORT_ADGUARD=3000; PORT_KUMA=3001; PORT_UMAMI=3002
# Hote d annonce -> nom du tracker. ⚠️ ECRITE A LA MAIN : un tracker peut
# annoncer sous deux hotes distincts, aucune regle ne peut le deviner. Un hote
# absent de la table s affiche tel quel, ce qui le signale plutot que de le taire.
TRACKERS_NOMS='{"tracker.orion.example":"Orion","vega.example":"Vega","tk.vega.example":"Vega","tk.altair.example":"Altair"}'
[ -f "$ICI/collect.conf" ] && . "$ICI/collect.conf"
: "${CERT_HOTES:=$SITE_HOTE}"      # domaines dont on lit le certificat
IP=$NAS_IP

ESSAI=0; [ "${1:-}" = "--essai" ] && ESSAI=1
if [ "$ESSAI" = 1 ]; then
  ETATS=/tmp/collect-essai; mkdir -p "$ETATS"; OUT=/tmp/collect-essai.json
  for f in nas-collect.state nas-diskio.state nas-qbit.cookie; do
    [ -f "/var/lib/$f" ] && cp -p "/var/lib/$f" "$ETATS/$f"
  done
  ST=$ETATS/nas-collect.state; DIOS=$ETATS/nas-diskio.state; CK=$ETATS/nas-qbit.cookie
else
  ETATS=/var/lib/homelab-collect; mkdir -p "$ETATS"; OUT=$ICI/www/data.json
  ST=/var/lib/nas-collect.state; DIOS=/var/lib/nas-diskio.state
  # Le cookie qBittorrent est PARTAGE avec collect-fast.sh : on ne se reconnecte
  # que s il a expire, au lieu de 2 880 connexions par jour.
  CK=/var/lib/nas-qbit.cookie
fi
PREC=$ICI/www/data.json            # la collecte precedente : certificat, VPN
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
printf -v NOWS '%(%s)T' -1
printf -v NOWM '%(%M)T' "$NOWS"
g(){ curl -s --max-time 8 "$@"; }

# En-tete ou option SECRETE, dans un fichier prive lu par `curl -K`.
# Les guillemets et barres obliques sont echappes pour la syntaxe de curl.
cfg(){ local v="$3"; v=${v//\\/\\\\}; v=${v//\"/\\\"}; printf '%s = "%s"\n' "$2" "$v" > "$TMP/$1"; }
cfg radarr  header "X-Api-Key: ${HOMEPAGE_VAR_RADARR_KEY:-}"
cfg sonarr  header "X-Api-Key: ${HOMEPAGE_VAR_SONARR_KEY:-}"
cfg prowl   header "X-Api-Key: ${HOMEPAGE_VAR_PROWLARR_KEY:-}"
cfg bazarr  header "X-API-KEY: ${HOMEPAGE_VAR_BAZARR_KEY:-}"
cfg seerr   header "X-Api-Key: ${HOMEPAGE_VAR_SEERR_KEY:-}"
cfg adguard user   "${HOMEPAGE_VAR_ADGUARD_USER:-}:${HOMEPAGE_VAR_ADGUARD_PASS:-}"
# ⚠️ JELLYFIN 12 A SUPPRIME L AUTHENTIFICATION PAR PARAMETRE D URL. Mesure le
# 09/09/2026 sur la 12.0.0 : `?api_key=` renvoie 401, et l en-tete `X-Emby-Token`
# aussi. Seul `Authorization: MediaBrowser Token="..."` repond encore 200.
cfg jelly   header "Authorization: MediaBrowser Token=\"${HOMEPAGE_VAR_JELLYFIN_KEY:-}\""
printf 'username=%s&password=%s' "${HOMEPAGE_VAR_QBIT_USER:-}" "${HOMEPAGE_VAR_QBIT_PASS:-}" > "$TMP/qb.login"

# Une mesure absente ou « null » vaut 0 dans data.json (`ko` dit pourquoi).
# Sans sous-processus : l ancienne `n()` en lancait un par valeur.
nz(){ local v; for v; do case "${!v:-}" in ''|null) printf -v "$v" 0;; esac; done; }
# SERVICES MUETS : une API qui ne repond pas est NOTEE dans `ko`, au lieu de
# devenir un 0. Avant le 08/10/2026, Radarr arrete donnait « Aucun film manquant »
# en vert, et Kuma injoignable « toutes les sondes OK ». La page dit alors « ne
# repond pas » sur la carte, et le compte comme un incident.
KO=""; muet(){ KO="$KO\"$1\","; }

# ============================================================================
# 1. DONNEES LENTES : toutes les 5 min, gardees entre deux releves
# ============================================================================
# ⚠️ `LENT_V` change quand la liste des variables gardees change : un cache ecrit
# par une version anterieure est alors ignore, et tout est releve.
# En essai, le cache vit dans /tmp lui aussi : un premier essai fait une passe
# complete, un second dans les 5 min une passe ordinaire, et les deux se mesurent.
LENT_V=2; LENT=$ETATS/lent.sh; LENT_T=0
[ -r "$LENT" ] && . "$LENT"
if [ "${LENT_VU:-0}" != "$LENT_V" ] || [ $((NOWS - LENT_T)) -ge 290 ]; then
  KO_LENT=""; muetl(){ KO_LENT="$KO_LENT\"$1\","; }
  CORES=$(nproc 2>/dev/null || echo 1)
  # ⚠️ LE CHEMIN NOYAU N EST PAS UNE IDENTITE : le noyau 6.18 a interverti nvme0
  # et nvme1, et les deux courbes se sont echangees en silence. Le slot vient du
  # NUMERO DE SERIE (`nvme-slots.sh`) ; il ne change pas d une minute a l autre.
  SLOTS=$("$ICI/nvme-slots.sh" 2>/dev/null)

  # --- Radarr / Sonarr (la bibliotheque complete, pour la place prise) ---
  RMIS=$(g -K "$TMP/radarr" "http://$IP:$PORT_RADARR/api/v3/wanted/missing" | jq -r '.totalRecords // empty' 2>/dev/null)
  [ -n "$RMIS" ] || muetl radarr
  RQ=$(g -K "$TMP/radarr" "http://$IP:$PORT_RADARR/api/v3/queue" | jq -r '.totalRecords // 0' 2>/dev/null)
  RSZ=$(g -K "$TMP/radarr" "http://$IP:$PORT_RADARR/api/v3/movie" | jq '[.[].sizeOnDisk] | add // 0' 2>/dev/null)
  SMIS=$(g -K "$TMP/sonarr" "http://$IP:$PORT_SONARR/api/v3/wanted/missing" | jq -r '.totalRecords // empty' 2>/dev/null)
  [ -n "$SMIS" ] || muetl sonarr
  SQ=$(g -K "$TMP/sonarr" "http://$IP:$PORT_SONARR/api/v3/queue" | jq -r '.totalRecords // 0' 2>/dev/null)
  SSZ=$(g -K "$TMP/sonarr" "http://$IP:$PORT_SONARR/api/v3/series" | jq '[.[].statistics.sizeOnDisk] | add // 0' 2>/dev/null)

  # --- Prowlarr ---
  # ⚠️ `/health` est la SEULE source d alerte de la carte : Prowlarr y signale
  # lui-meme un indexeur devenu indisponible apres trop d echecs. Un indexeur
  # desactive A LA MAIN n y figure pas, et c est voulu : c est un choix.
  PHL=$(g -K "$TMP/prowl" "http://$IP:$PORT_PROWLARR/api/v1/health")
  PSA=0; PMSG=""
  if [ -n "$PHL" ] && mapfile -t PL < <(printf '%s' "$PHL" | jq -r 'if type == "array" then (length, (.[0].message // "" | gsub("[\r\n]"; "") | gsub("\t"; " "))) else empty end' 2>/dev/null) && [ "${#PL[@]}" -ge 1 ]; then
    PSA=${PL[0]}; PMSG=${PL[1]:-}
  else muetl prowlarr; fi
  # Statistiques PAR INDEXEUR (`n`, `g` seulement), nom raccourci pour tenir
  # dans une pastille de carte etroite.
  PIX=$(g -K "$TMP/prowl" "http://$IP:$PORT_PROWLARR/api/v1/indexerstats" | jq -c '[.indexers[]? | {
    n: ((.indexerName // "?") | sub(" *\\(API\\)$"; "")), g: (.numberOfGrabs // 0) }]' 2>/dev/null)
  [ -n "$PIX" ] || PIX='[]'

  # --- Bazarr ---
  BZE=$(g -K "$TMP/bazarr" "http://$IP:$PORT_BAZARR/api/episodes/wanted" | jq -r '.total // empty' 2>/dev/null)
  [ -n "$BZE" ] || muetl bazarr
  BZM=$(g -K "$TMP/bazarr" "http://$IP:$PORT_BAZARR/api/movies/wanted" | jq -r '.total // 0' 2>/dev/null)

  # --- Jellyfin ---
  JM=""; JS=0; JE=0
  IFS=$'\t' read -r JM JS JE < <(g -K "$TMP/jelly" "http://$IP:$PORT_JELLYFIN/Items/Counts" \
    | jq -r '[(.MovieCount // ""), (.SeriesCount // 0), (.EpisodeCount // 0)] | @tsv' 2>/dev/null)
  [ -n "$JM" ] || muetl jellyfin
  # Lecture en cours : `live.json` la donne toutes les 2 s et prime dans la page ;
  # celle-ci ne sert que s il manque. Meme filtre que collect-fast.sh.
  JQ_LECTURE='[.[]? | select(.NowPlayingItem) | (.PlayState.PlayMethod // "") as $p
    | "\(.UserName) — \(.NowPlayingItem.Name)"
      + (if $p == "Transcode" then " (transcodage)" elif $p == "DirectStream" then " (flux direct)"
         elif $p == "DirectPlay" then " (lecture directe)" else "" end)] | join(" · ")'
  JNOW=$(g -K "$TMP/jelly" "http://$IP:$PORT_JELLYFIN/Sessions" \
    | jq -r "$JQ_LECTURE" 2>/dev/null)

  # --- Seerr ---
  SRP=""; SRA=0
  IFS=$'\t' read -r SRP SRA < <(g -K "$TMP/seerr" "http://$IP:$PORT_SEERR/api/v1/request/count" \
    | jq -r '[(.pending // ""), (.completed // 0)] | @tsv' 2>/dev/null)
  [ -n "$SRP" ] || muetl seerr

  # --- AdGuard ---
  AQ=""; AB=0; AL=0
  IFS=$'\t' read -r AQ AB AL < <(g -K "$TMP/adguard" "http://$IP:$PORT_ADGUARD/control/stats" \
    | jq -r '[(.num_dns_queries // ""), (.num_blocked_filtering // 0), ((.avg_processing_time // 0) * 1000 | floor)] | @tsv' 2>/dev/null)
  [ -n "$AQ" ] || muetl adguard

  # --- CRM : leads non lus, total, traites, anciennete du dernier contact ---
  # Une seule requete, la ou il y en avait deux.
  CRMX=$(docker exec portfolio-postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAF"|" -c "select count(*) filter (where status = '"'"'non_lu'"'"'), count(*), count(*) filter (where status <> '"'"'non_lu'"'"'), coalesce(now()::date - max(created_at)::date, -1) from contacts"' 2>/dev/null)
  LEADS=""; CTOT=""; CTRT=""; CAGE=""
  IFS='|' read -r LEADS CTOT CTRT CAGE <<< "${CRMX//[[:space:]]/}"
  [ -n "$CTOT" ] || muetl crm

  # --- cross-seed : sa base, en lecture seule ---
  # ⚠️ `-readonly` : le demon ecrit dans cette base, on ne s y invite pas. Le WAL
  # est lu au passage. `job_log.last_run` est en MILLISECONDES.
  CSL=$(sqlite3 -readonly -separator '|' /volume1/docker/arr/cross-seed/cross-seed.db \
    "select ifnull((select last_run/1000 from job_log where name='search'),0),
            (select count(*) from decision where decision='MATCH'),
            (select count(*) from searchee),
            (select count(*) from indexer where active=1),
            (select count(*) from indexer);" 2>/dev/null)
  CSRUN=""; CSM=""; CSS=""; CSIA=""; CSIT=""
  IFS='|' read -r CSRUN CSM CSS CSIA CSIT <<< "$CSL"
  for v in CSRUN CSM CSS CSIA CSIT; do case "${!v}" in ''|*[!0-9]*) printf -v "$v" 0;; esac; done

  # --- Umami : visiteurs, visites, pages vues sur 7 jours ---
  # Identifiants par les VARIABLES D ENVIRONNEMENT de jq (`env`), jamais par ses
  # arguments, lisibles dans `ps`.
  UV=""; UP7=0; UVI=0; USERIE='[]'
  U="${HOMEPAGE_VAR_UMAMI_USER:-}" P="${HOMEPAGE_VAR_UMAMI_PASS:-}" \
    jq -nc '{username: env.U, password: env.P}' > "$TMP/umami.login" 2>/dev/null
  UTK=$(g -X POST -H 'Content-Type: application/json' --data-binary @"$TMP/umami.login" \
    "http://$IP:$PORT_UMAMI/api/auth/login" | jq -r '.token // empty' 2>/dev/null)
  if [ -n "$UTK" ] && [ -n "$UMAMI_SITE_ID" ]; then
    cfg umami header "Authorization: Bearer $UTK"
    UPER="startAt=$(( (NOWS - 604800) * 1000 ))&endAt=$(( NOWS * 1000 ))"
    IFS=$'\t' read -r UV UP7 UVI < <(g -K "$TMP/umami" \
      "http://$IP:$PORT_UMAMI/api/websites/$UMAMI_SITE_ID/stats?$UPER" \
      | jq -r '[(.visitors // ""), (.pageviews // 0), (.visits // 0)] | @tsv' 2>/dev/null)
    # Les sept jours, sans `date` : `printf %()T` est un builtin.
    UDAYS="["; for i in 6 5 4 3 2 1 0; do
      printf -v j '%(%Y-%m-%d)T' $((NOWS - i * 86400)); UDAYS="$UDAYS\"$j\"${i:+,}"
    done; UDAYS="${UDAYS%,}]"
    USERIE=$(g -K "$TMP/umami" \
      "http://$IP:$PORT_UMAMI/api/websites/$UMAMI_SITE_ID/pageviews?$UPER&unit=day&timezone=Europe/Brussels" \
      | jq -c --argjson d "$UDAYS" '
          ([.sessions[]? | {key:((.x|tostring)[0:10]), value:.y}] | from_entries) as $m
          | [ $d[] | ($m[.] // 0) ]' 2>/dev/null)
    [ -n "$USERIE" ] || USERIE='[]'
  fi
  [ -n "$UV" ] || muetl umami

  # --- WireGuard : clients connectes, nommes depuis wg0.conf ---
  # Un seul `docker exec` pour la configuration ET l etat, un seul `awk`.
  WX=$(docker exec wg-easy sh -c 'cat /etc/wireguard/wg0.conf; echo "@@DUMP@@"; wg show wg0 dump' 2>/dev/null)
  WT=0; WC=0; WNAMES=""; WCL='[]'
  mapfile -t WL < <(printf '%s\n' "$WX" | awk -v now="$NOWS" '
    function esc(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); return s }
    /^@@DUMP@@$/ { dump=1; tete=1; next }
    !dump && /^# Client:/ { n=$3; next }
    !dump && /^PublicKey/ { m[$3]=n; next }
    dump && tete { tete=0; next }
    dump && NF { t++; nm = ($1 in m && m[$1] != "") ? m[$1] : "inconnu"; on = ($5 > 0 && now - $5 < 150)
                 if (on) { c++; noms = noms (noms != "" ? ", " : "") nm }
                 cl = cl (cl != "" ? "," : "") "{\"n\":\"" esc(nm) "\",\"on\":" (on ? "true" : "false") "}" }
    END { printf "%d %d\n%s\n[%s]\n", t, c, noms, cl }')
  if [ "${#WL[@]}" -ge 3 ]; then read -r WT WC <<< "${WL[0]}"; WNAMES=${WL[1]}; WCL=${WL[2]}; fi
  # wg-easy arrete ou sans reponse : MUET (17/10/2026). La carte disait
  # « Aucune connexion · 0 enregistré », comme un VPN simplement inutilise.
  [[ "$WX" == *"@@DUMP@@"* ]] || muetl wireguard

  # --- Mises a jour : l etat de compose-auto-update (`maj.json`) ---
  # On en reconstruit le format qu attend la tuile. « total » compte ce qui
  # attend une action MANUELLE : une version disponible pour un conteneur
  # manuel, ou un blocage. « nuit » compte celles d un conteneur automatique,
  # que la passe du matin installera seule : depuis le releve de la journee
  # (26/10/2026), elles se voient avant, et ne sont pas a faire a la main.
  # « vu » : l heure du controle le plus recent, passe ou releve.
  # ⚠️ L AGE SE MESURE SUR LA DERNIERE PASSE (`derniere_passe.fin`), plus sur le
  # `mtime` du fichier : le releve le reecrit toutes les trois heures et
  # masquerait une passe en panne. `mtime` reste le repli d un etat sans passe.
  UPDF=$ICI/www/maj.json
  UPD=$(jq -c '
    def manuel: .blocage != null or (.disponible != null and .mode != "auto");
    def nuit: .disponible != null and .mode == "auto" and .blocage == null;
    {
    total: ([.conteneurs[] | select(manuel)] | length),
    nuit: ([.conteneurs[] | select(nuit)] | length),
    verifies: (.conteneurs | length),
    maj: ((.derniere_passe.fin // "") | if . == "" then "?" else "\(.[8:10])/\(.[5:7]) \(.[11:16])" end),
    items: [.conteneurs | to_entries[] | {n: .key, upd: (.value | manuel), nuit: (.value | nuit)}]
  }' "$UPDF" 2>/dev/null) || UPD='{}'
  [ -n "$UPD" ] || UPD='{}'
  UPDP=$(jq -r '.derniere_passe.fin // empty' "$UPDF" 2>/dev/null)
  UPDR=$(jq -r '.dernier_releve.fin // empty' "$UPDF" 2>/dev/null)
  UPDT=$(date -d "${UPDP:-}" +%s 2>/dev/null) || UPDT=0
  [ -n "$UPDP" ] || UPDT=$(stat -c %Y "$UPDF" 2>/dev/null || echo 0)
  if [ "${UPDT:-0}" -gt 0 ]; then UPDH=$(( (NOWS - UPDT) / 3600 )); else UPDH=-1; fi
  UPDV=$UPDT
  if [ -n "$UPDR" ]; then
    UPDRT=$(date -d "$UPDR" +%s 2>/dev/null || echo 0)
    [ "$UPDRT" -gt "$UPDV" ] && UPDV=$UPDRT
  fi
  if [ "$UPDV" -gt 0 ]; then
    printf -v UPDVU '%(%d/%m %H:%M)T' "$UPDV"
    UPD=$(jq -c --arg vu "$UPDVU" '. + {vu: $vu}' <<< "$UPD" 2>/dev/null || echo "$UPD")
  fi

  # --- Sauvegarde : horodatage et anciennete ---
  BST=$(stat -c %Y /var/lib/nas-backup.last 2>/dev/null || echo 0)
  if [ "$BST" -gt 0 ]; then
    printf -v BDATE '%(%d/%m à %H:%M)T' "$BST"; BAGO=$(( (NOWS - BST) / 3600 ))
  else BDATE="jamais"; BAGO=-1; fi

  # --- UptimeRobot : les sites VUS D INTERNET (09/10/2026) ---
  # Le test du site par ce script part du NAS et n en sort pas : « joignable »
  # n y prouve rien pour un visiteur. UptimeRobot sonde de l exterieur ; on lit
  # ses moniteurs avec une cle EN LECTURE SEULE, passee par fichier comme les
  # autres secrets. Un moniteur : `h` l hote sonde, `s` l etat d UptimeRobot
  # (2 en ligne, 8 et 9 hors ligne, 0 en pause, 1 pas encore sonde), `r` la
  # disponibilite en % sur 1, 7 et 30 jours, `b` la derniere coupure.
  # ⚠️ Un echec GARDE le releve precedent, date par `t` : la page juge son age,
  # plutot que de perdre la vue de l exterieur a la premiere requete ratee.
  if [ -n "${HOMEPAGE_VAR_UPTIMEROBOT_KEY:-}" ]; then
    printf 'api_key=%s&format=json&custom_uptime_ratios=1-7-30&logs=1&logs_limit=10' \
      "$HOMEPAGE_VAR_UPTIMEROBOT_KEY" > "$TMP/ur"
    URN=$(g -X POST --data-binary @"$TMP/ur" https://api.uptimerobot.com/v2/getMonitors \
      | jq -c --argjson t "$NOWS" 'select(.stat == "ok") | {t: $t, m: [.monitors[] | {
          n: .friendly_name, h: ((.url // "") | sub("^[a-z]+://"; "") | sub("[/:?].*$"; "")), s: .status,
          r: ((.custom_uptime_ratio // "") | split("-") | map(tonumber? // null)),
          b: ([.logs[]? | select(.type == 1)][0] | if . then {t: .datetime, d: .duration} else null end)}]}' 2>/dev/null)
    [ -n "$URN" ] && UR=$URN
  fi
  # ⚠️ Defini AVANT `declare -p` : une variable absente y fait echouer toute la
  # sauvegarde du cache, et chaque passe redeviendrait une passe lente.
  : "${UR:=null}"

  LENT_T=$NOWS; LENT_VU=$LENT_V
  declare -p LENT_T LENT_VU KO_LENT CORES SLOTS RMIS RQ RSZ SMIS SQ SSZ PSA PMSG PIX BZE BZM \
    JM JS JE JNOW SRP SRA AQ AB AL LEADS CTOT CTRT CAGE CSRUN CSM CSS CSIA CSIT \
    UV UP7 UVI USERIE WT WC WNAMES WCL UPD UPDH BAGO BDATE UR > "$LENT.tmp" 2>/dev/null \
    && mv "$LENT.tmp" "$LENT"
fi
KO="$KO${KO_LENT:-}"
: "${UR:=null}"                    # aucune cle UptimeRobot, ou jamais releve

# ============================================================================
# 2. A CHAQUE PASSE : la machine, le site, qBittorrent, Kuma, le VPN
# ============================================================================
# --- Machine ---
# Processeur et reseau mesures ENTRE deux passages, via un fichier d etat :
# une moyenne sur l intervalle plutot qu un echantillon instantane.
NIC=/sys/class/net/eth0/statistics
RX=0; TX=0
{ read -r RX < "$NIC/rx_bytes"; read -r TX < "$NIC/tx_bytes"; } 2>/dev/null
NETNOW=$(( RX + TX ))
read -r _ a b c d e f h _ < /proc/stat; IDLE=$d; TOT=$((a+b+c+d+e+f+h))
if [ -r "$ST" ]; then read -r PI PT PN PE < "$ST"; else PI=0; PT=0; PN=0; PE=0; fi
printf '%s %s %s %s\n' "$IDLE" "$TOT" "$NETNOW" "$NOWS" > "$ST"
CPU=0; [ "${PT:-0}" -gt 0 ] && [ "$TOT" -gt "${PT:-0}" ] && CPU=$(( 100 - (100*(IDLE-PI)/(TOT-PT)) ))
DT=$(( NOWS - ${PE:-0} )); NET=0
[ "${PN:-0}" -gt 0 ] && [ "$DT" -gt 0 ] && [ "$NETNOW" -ge "${PN:-0}" ] && NET=$(( (NETNOW - PN) / DT ))
MT=1; MA=0; SWT=0; SWF=0
while read -r k v _; do
  case "$k" in MemTotal:) MT=$v;; MemAvailable:) MA=$v;; SwapTotal:) SWT=$v;; SwapFree:) SWF=$v;; esac
done < /proc/meminfo
RAM=$(( 100 - (100*MA/MT) ))
SWP=0; [ "$SWT" -gt 0 ] && SWP=$(( 100 - 100*SWF/SWT ))
# Temps de fonctionnement : un redemarrage non ordonne se voit au SAUT du compteur.
read -r UPS _ < /proc/uptime; UPT=${UPS%%.*}; UP=$(( UPT / 86400 ))
RUN=0; ALL=0
mapfile -t LST < <(docker ps -a --format '{{.State}}' 2>/dev/null)
ALL=${#LST[@]}; for s in "${LST[@]}"; do case "$s" in running|paused) RUN=$((RUN+1));; esac; done

# --- Disque, charge et temperatures, lus A LA SOURCE ---
DUSED=0; DSIZE=0
{ read -r _; read -r DUSED DSIZE; } < <(df -B1 --output=used,size /volume1 2>/dev/null)
DPC=0; [ "${DSIZE:-0}" -gt 0 ] && DPC=$(( 100*DUSED/DSIZE )); DTOT=${DSIZE:-0}
read -r LOAD1 LOAD5 LOAD15 _ < /proc/loadavg
# Entrees/sorties disque : secteurs lus/ecrits, en octets/s entre deux passages.
DR=0; DW=0
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
# NVT : le plus chaud des NVMe ; TEMP : le plus chaud des coeurs ; ETH : le PHY
# du controleur 10 GbE, autour de 71 °C en permanence, NORMAL par conception
# (pris pour une surchauffe le 12/07 : l enregistrer evite d y revenir).
NVT=0; TEMP=0; ETH=0
for hw in /sys/class/hwmon/hwmon*; do
  nm=""; { read -r nm < "$hw/name"; } 2>/dev/null
  case "$nm" in
    nvme) v=0; { read -r v < "$hw/temp1_input"; } 2>/dev/null; [ "$v" -gt $((NVT*1000)) ] && NVT=$((v/1000)) ;;
    coretemp) for f in "$hw"/temp*_input; do
                v=0; { read -r v < "$f"; } 2>/dev/null; [ "$v" -gt $((TEMP*1000)) ] && TEMP=$((v/1000))
              done ;;
    eth0) v=0; { read -r v < "$hw/temp1_input"; } 2>/dev/null; ETH=$((v/1000)) ;;
  esac
done
# CINQ positions NVMe, par slot (voir `nvme-slots.sh`) : une position vide vaut
# 0, et la page ecarte d elle-meme une serie nulle. `temp1_input` est le capteur
# « Composite », celui que SMART rapporte.
# ⚠️ Toute position supplementaire demanderait AUSSI une colonne dans
# `history-build.sh` et `history-min.sh`, sinon elle serait relevee puis jetee.
NV0=0; NV1=0; NV2=0; NV3=0; NV4=0
while read -r sl ct; do
  case "$sl" in [0-4]) ;; *) continue;; esac
  for f in /sys/class/nvme/"$ct"/hwmon*/temp1_input; do
    v=0; { read -r v < "$f"; } 2>/dev/null; printf -v "NV$sl" '%d' "$((v / 1000))"; break
  done
done <<< "${SLOTS:-}"

# --- PC fixe : allume ou non ---
# ⚠️ ON SONDE LE PORT 22, PAS L ICMP : Windows bloque le ping par defaut. Cout :
# 2 ms quand le poste repond, 1 s quand il est absent — ne pas remonter cette
# sonde dans `collect-fast.sh`, qui boucle toutes les 2 s.
# ⚠️ LA DERNIERE VUE EST PERSISTEE : sans elle, un poste ETEINT et un poste SORTI
# DU RESEAU se confondraient. Au-dela de 24 h sans reponse, la carte s allume.
# Adresse du poste : `pc.conf` (voir `pc.conf.exemple`). Sans lui, pas de sonde.
PC_IP=; [ -f "$ICI/pc.conf" ] && . "$ICI/pc.conf"
PCVUF=$ICI/pc-vu; PCON=false
if [ -n "$PC_IP" ] && nc -z -w 1 "$PC_IP" 22 2>/dev/null; then
  PCON=true; [ "$ESSAI" = 0 ] && printf '%s\n' "$NOWS" > "$PCVUF"
fi
PCVU=0; { read -r PCVU < "$PCVUF"; } 2>/dev/null; case "$PCVU" in ''|*[!0-9]*) PCVU=0;; esac

# --- Site public : joignabilite, temps de reponse, expiration du certificat ---
# ⚠️ `%{http_code}` est indispensable : en cas d echec curl ecrit quand meme une
# duree (8000 ms sur un delai depasse, 0 sur un refus), le temps seul ne permet
# pas de conclure. Sans code valide, SMS reste VIDE, hors de la moyenne.
# ⚠️ SUP vaut 1 ou 2, JAMAIS 0 : history-build.sh ecrit 0 pour un creneau sans
# donnee, et le ruban serait sinon ecarlate pendant ses 24 premieres heures.
SCODE=0; STIME=0
read -r SCODE STIME < <(curl -s -o /dev/null --max-time 8 -w '%{http_code} %{time_total}\n' "$SITE_URL" 2>/dev/null)
SI=${STIME%%.*}; SF=${STIME#*.}; [ "$SF" = "$STIME" ] && SF=0; SF="${SF}000"
SMS=$(( 10#${SI:-0} * 1000 + 10#${SF:0:3} ))
case "$SCODE" in 200|301|302|307|308) SUP=1; SOK=true;; *) SUP=2; SOK=false; SMS="";; esac
# Certificat, IP et localisation du VPN de la passe precedente : un seul `jq`.
SCERT=-1; GPREV=""; GLOC=""
IFS=$'\t' read -r SCERT GPREV GLOC < <(jq -r '[(.site.cert // -1), (.vpn.ip // ""), (.vpn.loc // "")] | @tsv' "$PREC" 2>/dev/null)
case "$SCERT" in ''|*[!0-9-]*) SCERT=-1;; esac
# Un certificat ne bouge pas d une minute a l autre : verifie a l heure ronde.
if [ "$NOWM" = "00" ] || [ "$SCERT" -le 0 ]; then
  CE=$(echo | timeout 8 openssl s_client -connect "$SITE_HOTE:443" -servername "$SITE_HOTE" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  [ -n "$CE" ] && SCERT=$(( ( $(date -d "$CE" +%s) - NOWS ) / 86400 ))
fi

# --- Certificats de TOUS les domaines publics (09/10/2026) ---
# Caddy renouvelle chaque certificat a part : un renouvellement en echec sur un
# sous-domaine ne se voyait nulle part, seul celui du site etait lu. Un objet par
# domaine de `CERT_HOTES` : `j` les jours restants, `v` la duree de vie du
# certificat en jours (la page juge sur leur rapport), tous deux a null si le
# certificat n a pas pu etre lu.
# Lus a l heure ronde, EN PARALLELE (moins d une demi-seconde pour huit), et a
# chaque passage tant que l un d eux reste illisible : un echec passager se
# corrige en trente secondes au lieu d une heure.
# ⚠️ Relus aussi quand la LISTE change (`CHS` : les domaines de la passe
# precedente). Sans cela, un domaine ajoute a `collect.conf` attendait l heure
# ronde : vecu a l installation, la carte n en a montre qu un pendant 40 min.
CERTS='[]'; CHS=""
{ read -r CERTS; read -r CHS; } < <(jq -r '(.certs // []) | (tojson, ([.[].h] | join(" ")))' "$PREC" 2>/dev/null)
[ -n "$CERTS" ] || CERTS='[]'
read -ra CHL <<< "$CERT_HOTES"
if [ "$NOWM" = "00" ] || [ "$CHS" != "${CHL[*]}" ] || [[ "$CERTS" == *'"j":null'* ]]; then
  for h in $CERT_HOTES; do
    ( f=$(echo | timeout 8 openssl s_client -connect "$h:443" -servername "$h" 2>/dev/null \
          | openssl x509 -noout -startdate -enddate 2>/dev/null)
      a=$(printf '%s\n' "$f" | sed -n 's/^notBefore=//p'); b=$(printf '%s\n' "$f" | sed -n 's/^notAfter=//p')
      A=$(date -d "$a" +%s 2>/dev/null); B=$(date -d "$b" +%s 2>/dev/null)
      if [ -n "$a" ] && [ -n "$b" ] && [ -n "$A" ] && [ -n "$B" ]; then
        printf '{"h":"%s","j":%d,"v":%d}\n' "$h" $(( (B - NOWS) / 86400 )) $(( (B - A) / 86400 ))
      else
        printf '{"h":"%s","j":null,"v":null}\n' "$h"
      fi ) > "$TMP/cert.$h" &
  done
  wait
  CERTS=$(for h in $CERT_HOTES; do cat "$TMP/cert.$h"; done | jq -sc '.' 2>/dev/null)
  [ -n "$CERTS" ] || CERTS='[]'
fi

# --- qBittorrent : etat, ratio par tracker, dette de partage, cross-seed ---
# ⚠️ UNE SEULE REQUETE ET UN SEUL `jq`. `sync/maindata` porte `server_state` ET
# les torrents ; le meme objet etait relu par une dizaine de `jq`.
QURL=http://$IP:$PORT_QBIT/api/v2
QMD=$(g -b "$CK" "$QURL/sync/maindata")
case "$QMD" in '{'*) ;; *)
  g -c "$CK" --data-binary @"$TMP/qb.login" "$QURL/auth/login" >/dev/null
  QMD=$(g -b "$CK" "$QURL/sync/maindata") ;;
esac
# ⚠️ SEUIL FIXE de trois jours de partage : l ENGAGEMENT envers les trackers
# prives, et non la preference du client, desactivee (elle valait alors 0, et la
# dette serait tombee a zero pour toujours sans le moindre signe).
QLIM=4320
# Ratios releves CHEZ les trackers par `ratios.sh`, une fois par heure : aucune
# requete reseau ici, on joint le fichier. Absent ou corrompu, `vr` vaut null.
RATF=$ICI/www/ratios.json; [ -r "$RATF" ] || RATF=/dev/null
QNB=0; QDL=""; QUL=""; QRT=0; QAD=0; QAU=0; QCX=""; QPR=0; QDET=0; QTR='[]'; CSQ='{}'
mapfile -t QL < <(printf '%s' "$QMD" | jq -r --argjson noms "$TRACKERS_NOMS" --rawfile rat "$RATF" \
  --argjson lim "$QLIM" '
  (.server_state // {}) as $s
  | [ (.torrents // {}) | to_entries[] | .value ] as $t
  | ($lim * 60) as $lim
  | ($rat | (try fromjson catch {}) | if type == "object" then . else {} end) as $x
  # 1. L etat du client. ⚠️ `connection_status` FIREWALLED est le cas vicieux :
  #    le client marche, telecharge, mais son port entrant est injoignable.
  #    Les torrents ARRETES avant d avoir rendu leur du forment la dette ; la
  #    marge de 300 s est celle de `purge-cross-seed.py`, et `stoppedUP` ET
  #    `pausedUP` couvrent qBittorrent 5 et ses reprises de configuration.
  | ([ ($t | length), ($s.dl_info_speed // 0), ($s.up_info_speed // 0), ($s.global_ratio // "0"),
       ($s.alltime_dl // 0), ($s.alltime_ul // 0), ($s.connection_status // ""),
       ($s.total_peer_connections // 0),
       (if $lim <= 0 then 0 else [ $t[] | select((.state // "") | test("^(stopped|paused)UP$"))
                                         | select((.seeding_time // 0) < $lim - 300) ] | length end)
     ] | @tsv),
  # 2. Ratio par tracker, puis UNION avec ratios.json : un tracker sans torrent
  #    charge garde sa ligne (la carte entiere disparaissait sinon des que la
  #    file se vidait, le 01/09/2026). Jointure sur le NOM normalise.
    ([ $t[] | select(((.tracker // "") | length) > 0)
       | ((.tracker | split("/")[2]) // "?") as $h
       | { n: ($noms[$h] // $h), u: (.uploaded // 0), d: (.downloaded // 0) } ]
     | group_by(.n)
     | map({ n: .[0].n, u: (map(.u) | add), d: (map(.d) | add) })
     | map(. + { r: (if .d > 0 then ((.u / .d * 100 | floor) / 100) else 0 end) })
     | sort_by(-.u)
     | map(. + {vr: ($x[.n] // null)}) as $q
     | [ ($x | keys_unsorted[]) | select(. != "maj") | select(($x[.] | type) == "object") ] as $nn
     | $q + [ $nn[] as $n | select(($q | map(.n) | index($n)) == null)
              | { n: $n, u: 0, d: 0, r: 0, vr: $x[$n] } ]
     | tojson),
  # 3. cross-seed, cote client. ⚠️ Le compte « a purger » applique EXACTEMENT la
  #    regle de purge-cross-seed.py : deux regles qui divergeraient annonceraient
  #    une suppression qui n arrive pas.
    ([ $t[] | select((.save_path // "") | test("cross-seed")) ] as $c
     | { nb: ($c | length), taille: (($c | map(.size) | add) // 0),
         envoye: (($c | map(.uploaded) | add) // 0),
         actifs: ([ $c[] | select((.state // "") | test("UP$"))
                         | select((.state // "") | test("^(stopped|paused)") | not) ] | length),
         purge: (if $lim <= 0 then 0 else [ $c[] | select((.state // "") | test("^(stopped|paused)UP$"))
                                               | select((.seeding_time // 0) >= $lim - 300) ] | length end) }
     | tojson)' 2>/dev/null)
if [ "${#QL[@]}" -ge 3 ]; then
  IFS=$'\t' read -r QNB QDL QUL QRT QAD QAU QCX QPR QDET <<< "${QL[0]}"; QTR=${QL[1]}; CSQ=${QL[2]}
fi

# --- Kuma : actifs, inactifs, stabilite, et etat PAR GROUPE ---
# ⚠️ DEUX POINTS D ENTREE, joints sur l identifiant : `/status-page/<slug>` donne
# la COMPOSITION des groupes, `/heartbeat/<slug>` l ETAT courant. Les
# identifiants sont des ENTIERS d un cote, des CHAINES de l autre : `tostring`.
# ⚠️ `$KH` PESE 177 Ko : en `--argjson` il depasse la taille maximale d un
# argument, l execve echoue et la panne est muette. Il passe par l ENTREE
# STANDARD, reduit a un objet identifiant -> dernier statut avant d aller plus loin.
# ⚠️ KUMA A QUATRE STATUTS : 0 hors ligne, 1 en ligne, 2 EN ATTENTE (tentatives
# en cours, deja un echec), 3 en maintenance. « En defaut » = ni 1 ni 3.
KURL=http://$IP:$PORT_KUMA/api/status-page
KH=$(g "$KURL/heartbeat/${HOMEPAGE_VAR_KUMA_SLUG:-}")
KS=$(g "$KURL/${HOMEPAGE_VAR_KUMA_SLUG:-}")
KU=0; KD=0; KPC=0; KKO=0; KLAST='{}'; KL=()
[ -n "$KH" ] && mapfile -t KL < <(printf '%s' "$KH" | jq -r '
  if (.heartbeatList | type) != "object" then empty else
    ((.heartbeatList) | map_values(last | .status)) as $l
    | ([ (.uptimeList // {})[] ] | if length > 0 then ((add / length * 1000 | floor) / 10) else 0 end) as $pc
    | ([ ([ $l[] | select(. == 1) ] | length), ([ $l[] | select(. == 0) ] | length), $pc,
         ([ $l[] | select(. != 1 and . != 3) ] | length) ] | @tsv),
      ($l | tojson)
  end' 2>/dev/null)
# ⚠️ KUMA INJOIGNABLE N EST PAS « TOUT VA BIEN » : c est une absence de mesure.
# Colonne d historique : 1 toutes les sondes repondent, 2 au moins une en defaut,
# 0 RESERVE a l absence de mesure (ruban neutre, pas ecarlate).
if [ "${#KL[@]}" -ge 2 ]; then
  IFS=$'\t' read -r KU KD KPC KKO <<< "${KL[0]}"; KLAST=${KL[1]}
  if [ "$KKO" -gt 0 ]; then KUP=2; else KUP=1; fi
else muet kuma; KUP=0; fi
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

# --- Gluetun : IP publique du tunnel, port entrant, sante ---
# Un seul `docker exec` pour les deux fichiers.
GX=$(docker exec arr-gluetun sh -c 'printf "%s\n%s\n" "$(cat /tmp/gluetun/ip)" "$(cat /tmp/gluetun/forwarded_port)"' 2>/dev/null)
GIP=""; GPORT=""
{ read -r GIP; read -r GPORT; } <<< "$GX"
GH=$(docker inspect -f '{{.State.Health.Status}}' arr-gluetun 2>/dev/null)
# ⚠️ CES DEUX VALEURS VIENNENT DE L INTERIEUR D UN CONTENEUR, et ce script tourne
# en root : elles sont VALIDEES avant tout usage. Collees telles quelles dans le
# `bash -c` et dans le JSON, un conteneur compromis pouvait faire executer du
# code a l hote ou casser `data.json`.
[[ "$GIP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || GIP=""
[[ "$GPORT" =~ ^[0-9]{1,5}$ ]] || GPORT=""
# Le fichier de port ne prouve RIEN (le 22/08 il annoncait un port que Proton ne
# routait plus) : seul un vrai test TCP sur l IP publique du tunnel distingue un
# port vivant d un port fantome. Meme convention 1/2 que `siteup` pour l historique.
GOPEN=false
if [ -n "$GIP" ] && [ -n "$GPORT" ]; then
  timeout 5 bash -c 'cat < /dev/null > "/dev/tcp/$1/$2"' _ "$GIP" "$GPORT" 2>/dev/null && GOPEN=true
fi
[ "$GOPEN" = true ] && VUP=1 || VUP=2
# Le journal de gluetun n est relu QUE si la localisation manque ou si l IP a
# change : lire 800 lignes de journal a chaque passage coutait cher.
if [ -z "$GLOC" ] || [ "$GIP" != "$GPREV" ]; then
  GLOC=$(docker logs --tail 800 arr-gluetun 2>&1 | grep -i 'Public IP address is' | tail -1 \
    | sed -n 's/.*(\([^)]*\) - source.*/\1/p' | awk -F', ' '{print $NF", "$1}')
fi

# ============================================================================
# 3. ASSEMBLAGE
# ============================================================================
# L historique garde les mesures BRUTES : vides quand le site ou le client ne
# repondaient pas. `history-build.sh` exclut le vide des moyennes ; un 0 y
# serait compte comme une vraie mesure.
H_SMS=$SMS; H_QDL=$QDL; H_QUL=$QUL
[ -n "${PIX:-}" ] || PIX='[]'; [ -n "${UPD:-}" ] || UPD='{}'
[ -n "${WCL:-}" ] || WCL='[]'; [ -n "${USERIE:-}" ] || USERIE='[]'
nz RMIS RQ RSZ SMIS SQ SSZ PSA BZE BZM QDL QUL QAD QAU QPR QNB QDET JM JS JE SRP SRA \
   AQ AB AL KU KD KPC WC WT GPORT UV UP7 UVI LEADS CTOT CTRT CAGE SMS DTOT UPT \
   CSRUN CSM CSS CSIA CSIT UPDH BAGO
printf -v TS '%(%H:%M)T' "$NOWS"
# ECRITURE ATOMIQUE : la page relit `data.json` sans cesse ; `mv` dans le meme
# dossier lui donne l ancien fichier entier, ou le nouveau, jamais un demi.
# ⚠️ On ne sort PAS en cas d echec : la ligne d historique qui suit reste utile.
if jq -n --argjson m "{\"cpu\":$CPU,\"ram\":$RAM,\"up\":$UP,\"run\":$RUN,\"all\":$ALL,\"ramu\":$((MT-MA)),\"ramt\":$MT,\"cores\":${CORES:-1},\"net\":$NET,\"disk\":$DPC,\"load\":$LOAD1,\"load5\":$LOAD5,\"load15\":$LOAD15,\"temp\":$TEMP,\"dr\":$DR,\"dw\":$DW,\"swap\":$SWP,\"nvme\":$NVT}" \
  --argjson r "{\"mis\":$RMIS,\"q\":$RQ,\"size\":$RSZ}" \
  --argjson s "{\"mis\":$SMIS,\"q\":$SQ,\"size\":$SSZ}" \
  --argjson p "{\"sante\":$PSA,\"ix\":$PIX}" --arg pmsg "${PMSG:-}" \
  --argjson b "{\"ep\":$BZE,\"mv\":$BZM}" \
  --argjson q "{\"dl\":$QDL,\"ul\":$QUL,\"adl\":$QAD,\"aul\":$QAU,\"pairs\":$QPR,\"nb\":$QNB,\"dette\":$QDET}" \
  --arg qrt "$QRT" --arg qcx "$QCX" --argjson qtr "$QTR" \
  --argjson j "{\"films\":$JM,\"series\":$JS,\"episodes\":$JE}" --arg jnow "${JNOW:-}" \
  --argjson se "{\"pending\":$SRP,\"done\":$SRA}" \
  --argjson ag "{\"q\":$AQ,\"b\":$AB,\"lat\":$AL}" \
  --argjson k "{\"up\":$KU,\"down\":$KD,\"pc\":$KPC}" \
  --argjson w "{\"c\":$WC,\"t\":$WT}" --arg wn "${WNAMES:-}" \
  --argjson v "{\"port\":$GPORT,\"open\":$GOPEN}" --arg vip "$GIP" --arg vh "$GH" --arg vloc "$GLOC" \
  --argjson u "{\"visitors\":$UV,\"views\":$UP7,\"visits\":$UVI}" \
  --argjson upd "$UPD" --argjson updh "$UPDH" --argjson leads "$LEADS" \
  --argjson bago "$BAGO" --arg bdate "${BDATE:-jamais}" --arg ts "$TS" \
  --argjson wcl "$WCL" --argjson us "$USERIE" \
  --argjson crm "{\"tot\":$CTOT,\"traites\":$CTRT,\"age\":$CAGE}" \
  --argjson site "{\"ms\":$SMS,\"cert\":$SCERT,\"ok\":$SOK}" --argjson certs "$CERTS" --argjson ur "$UR" --argjson dtot "$DTOT" \
  --argjson kg "$KG" --argjson csq "$CSQ" \
  --argjson cs "{\"run\":$CSRUN,\"match\":$CSM,\"suivis\":$CSS,\"idx\":$CSIA,\"idxtot\":$CSIT}" \
  --argjson pc "{\"on\":$PCON,\"vu\":$PCVU}" \
  --argjson upt "$UPT" --argjson t "$NOWS" --argjson ko "[${KO%,}]" \
  '{t:$t,ko:$ko,ts:$ts,nas:($m+{disktot:$dtot,uptime:$upt}),radarr:$r,sonarr:$s,prowlarr:($p+{msg:$pmsg}),
    bazarr:$b,qbit:({dl:$q.dl,ul:$q.ul,ratio:$qrt,adl:$q.adl,aul:$q.aul,etat:$qcx,pairs:$q.pairs,nb:$q.nb,dette:$q.dette}+{tr:$qtr}),
    jellyfin:($j+{now:$jnow}),seerr:$se,adguard:$ag,
    kuma:($k+{groupes:$kg}),wg:($w+{noms:$wn,clients:$wcl}),
    vpn:{ip:$vip,port:$v.port,health:$vh,open:$v.open,loc:$vloc},
    umami:($u+{serie:$us}),site:$site,certs:$certs,ur:$ur,crm:$crm,updates:($upd+{age:$updh}),leads:$leads,
    backup:{h:$bago,date:$bdate},cross:($csq+$cs),pc:$pc}' > "$OUT.tmp" 2>"$TMP/jq.err" && [ -s "$OUT.tmp" ]; then
  mv "$OUT.tmp" "$OUT"; chmod 644 "$OUT"
else
  rm -f "$OUT.tmp"; echo "data.json NON remplace : assemblage jq en echec : $(head -c 300 "$TMP/jq.err")" >&2
fi

# --- Historique : une ligne par passage, en CSV ---
# ⚠️ TROIS REGLES. 1. Ce bloc est le DERNIER du script : place au milieu, il
# laissait des mesures calculees apres lui invisibles a l historique. 2. Toute
# colonne ajoutee ici doit l etre AUSSI dans history-build.sh et history-min.sh.
# 3. On AJOUTE TOUJOURS EN FIN : deplacer une colonne rendrait faux tout
# l historique deja enregistre, sans le moindre signe. La page lit PAR NOM.
# ⚠️ SOUS VERROU, partage avec la purge de `history-build.sh`. Au-dela de 5 s
# d attente on ajoute quand meme : la collecte ne doit jamais rester bloquee.
[ "$ESSAI" = 1 ] && exit 0
(
  flock -w 5 9 || true
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$NOWS" "$CPU" "$RAM" "$DPC" "$NET" \
    "$LOAD1" "$TEMP" "$DR" "$DW" "$LOAD5" "$LOAD15" "$SWP" "$NVT" "$NV0" "$NV1" "$ETH" "$NV2" "$NV3" \
    "$H_SMS" "$SUP" "$H_QDL" "$H_QUL" "$VUP" "$KUP" "$NV4" \
    >> "$ICI/history.csv"
) 9>/var/lock/homelab-history.lock
