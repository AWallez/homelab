#!/usr/bin/env python3
"""Collecteur « systeme » du tableau de bord -> www/systeme.json.

    systeme.py            un passage (cron, chaque minute, en root)
    systeme.py --nuit     mesure seulement la place prise par chaque dossier (cron, la nuit)
    systeme.py --essai    affiche ce qui serait ecrit, n ecrit rien

Il alimente les cartes Memoire, Stockage, Securite, Acces, Reseau local et
Internet, les ventilateurs de la carte Temperatures et le detail de la carte
Sauvegarde. La page fusionne ce fichier avec `data.json`.

POURQUOI UN FICHIER A PART et non des blocs de plus dans `collect.sh` : chaque
script ecrit son propre fichier, aucune ecriture n est concurrente, et une
panne ici laisse le reste du tableau de bord intact.

POURQUOI PYTHON : une dizaine de formats a lire (cgroups, zram, /proc,
reponses JSON de la box et de nftables, journaux). En shell, chacun aurait
demande son `awk`. Bibliotheque standard seulement.

⚠️ AUCUN SECRET n est lu ni ecrit : ni contenu de fichier, ni jeton. Le controle
des droits teste si un compte SANS DROIT peut lire un fichier, sans l ouvrir.

Reglages propres a l installation : `systeme.conf`, a cote du script (voir
`systeme.conf.exemple`).
"""
import calendar
import configparser
import fcntl
import glob
import ipaddress
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import time

# ⚠️ CRON NE FOURNIT QU UN PATH MINIMAL, sans /usr/sbin ou vivent `nft`,
# `dmidecode` et `runuser` : lance a la main tout marchait, par cron le pare-feu
# devenait « illisible » (05/10/2026, meme piege que `smart.sh` en aout).
os.environ["PATH"] = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

ICI = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.path.join(ICI, "www", "systeme.json")
ETAT_DIR = "/var/lib/homelab-systeme"
ETAT = os.path.join(ETAT_DIR, "etat.json")
NUIT = os.path.join(ETAT_DIR, "espace.json")
SAUVEGARDE = "/var/lib/nas-backup.json"
MO = 1048576

ESSAI = "--essai" in sys.argv
NUIT_DEMANDEE = "--nuit" in sys.argv
MAINTENANT = time.time()
PROBLEMES = []          # ce qui n a pas pu etre lu, rendu dans le fichier


def note(msg):
    PROBLEMES.append(msg)


# ---------------------------------------------------------------- outils
def lire(chemin, defaut=""):
    try:
        with open(chemin, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return defaut


def entier(chemin, defaut=0):
    try:
        return int(lire(chemin).split()[0])
    except (ValueError, IndexError):
        return defaut


def cmd(args, delai=10):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=delai)
        return r.stdout if r.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def mo(octets):
    return round(octets / MO)


def conf():
    c = configparser.ConfigParser(delimiters=("=",))
    c.optionxform = str                          # les noms de dossier gardent leur casse
    c.read(os.path.join(ICI, "systeme.conf"), encoding="utf-8")
    return c


CONF = conf()


def liste(section, cle):
    return [x.strip() for x in CONF.get(section, cle, fallback="").split(",") if x.strip()]


def charger_etat():
    try:
        return json.loads(lire(ETAT) or "{}")
    except ValueError:
        return {}


# ---------------------------------------------------------------- noms
def noms_adresses():
    """Adresse -> nom : celles de `systeme.conf`, puis les clients WireGuard,
    lus dans la configuration de wg-easy (commentaire « # Client: nom » suivi
    de sa ligne AllowedIPs). Une adresse inconnue reste affichee telle quelle."""
    n = dict(CONF.items("noms")) if CONF.has_section("noms") else {}
    conteneur = CONF.get("reseau", "wireguard", fallback="")
    if conteneur:
        nom = None
        for l in cmd(["docker", "exec", conteneur, "sh", "-c",
                      "grep -E '^# Client:|^AllowedIPs' /etc/wireguard/wg0.conf"]).splitlines():
            m = re.match(r"# Client:\s*(\S+)", l)
            if m:
                nom = m.group(1)
                continue
            m = re.match(r"AllowedIPs\s*=\s*([0-9.]+)/32", l)
            if m and nom:
                n.setdefault(m.group(1), nom)
                nom = None
    return n


def reseaux_locaux():
    return [ipaddress.ip_network(x) for x in
            liste("reseau", "locaux") or ["192.168.0.0/16", "10.0.0.0/8", "127.0.0.0/8"]]


LOCAUX = reseaux_locaux()


def local(ip):
    try:
        a = ipaddress.ip_address(ip.replace("::ffff:", ""))
    except ValueError:
        return True
    return any(a in r for r in LOCAUX)


# ---------------------------------------------------------------- memoire
def meminfo():
    m = {}
    for l in lire("/proc/meminfo").splitlines():
        k, _, v = l.partition(":")
        try:
            m[k] = int(v.split()[0]) * 1024
        except (ValueError, IndexError):
            pass
    return m


def zram():
    l = []
    for d in sorted(glob.glob("/sys/block/zram*")):
        s = lire(d + "/mm_stat").split()
        if len(s) < 3:
            continue
        algo = re.search(r"\[([^\]]+)\]", lire(d + "/comp_algorithm"))
        l.append({"n": os.path.basename(d), "algo": algo.group(1) if algo else "",
                  "orig": mo(int(s[0])), "compr": mo(int(s[1])), "used": mo(int(s[2])),
                  "cap": mo(entier(d + "/disksize"))})
    return l


def swaps():
    """Les espaces d echange HORS zram : la partition et le fichier, sur SSD."""
    l = []
    for ligne in lire("/proc/swaps").splitlines()[1:]:
        p = ligne.split()
        if len(p) < 4 or "zram" in p[0]:
            continue
        l.append({"n": "fichier" if p[1] == "file" else "ssd", "chemin": p[0],
                  "used": round(int(p[3]) / 1024), "size": round(int(p[2]) / 1024)})
    return l


def barrettes(etat):
    """Barrettes installees et emplacements libres (dmidecode, root). Recalcule
    toutes les six heures : une barrette ne s ajoute pas a chaud."""
    c = etat.get("ram")
    if c and MAINTENANT - c.get("t", 0) < 21600:
        return c["v"]
    sortie = cmd(["dmidecode", "-t", "17"])
    if not sortie:
        note("barrettes : dmidecode illisible (root ?)")
        return c["v"] if c else None
    tailles = re.findall(r"^\s*Size:\s*(.+)$", sortie, re.M)
    go = 0
    libres = 0
    for t in tailles:
        m = re.match(r"(\d+)\s*(GB|MB)", t)
        if m:
            go += int(m.group(1)) / (1024 if m.group(2) == "MB" else 1)
        else:
            libres += 1
    v = {"go": round(go), "slots": len(tailles), "libres": libres}
    etat["ram"] = {"t": MAINTENANT, "v": v}
    return v


CATEGORIES = [
    ("conteneurs", re.compile(r"docker-[0-9a-f]{12,}\.scope$")),
    ("docker", re.compile(r"/(containerd|docker|docker_serv)\.service$")),
    ("cameras", re.compile(r"camera|stream_serv|camerams")),
    ("photos", re.compile(r"photo|album|aiconsole|hetero|ai_serv|_ai_")),
]


def categorie(chemin):
    for k, rx in CATEGORIES:
        if rx.search(chemin):
            return k
    if chemin.startswith("system.slice/") and chemin.endswith(".service"):
        return "systeme"
    return "autres"


def nom_feuille(chemin, k, conteneurs):
    b = os.path.basename(chemin)
    if k == "conteneurs":
        m = re.search(r"docker-([0-9a-f]{12,})\.scope", b)
        return conteneurs.get(m.group(1)[:12], m.group(1)[:12]) if m else b
    if k == "autres":
        haut = chemin.split("/")[0]
        return {"user.slice": "sessions", "init.scope": "init"}.get(haut, haut.replace(".slice", ""))
    return re.sub(r"\.(service|scope)$", "", b).replace("@", " · ")


def cgroups(etat):
    """La memoire de CHAQUE groupe de processus, sans le cache : `anon` du cgroup
    et ce qui a ete evacue en swap. Les feuilles additionnees retombent sur le
    total du systeme a moins de 1 % (mesure le 05/10/2026). Le processeur se
    calcule entre deux passages, d apres `cpu.stat`."""
    racine = "/sys/fs/cgroup"
    conteneurs = {}
    for l in cmd(["docker", "ps", "--no-trunc", "--format", "{{.ID}} {{.Names}}"]).splitlines():
        i, _, n = l.partition(" ")
        conteneurs[i[:12]] = n
    prec = etat.get("cpu", {})
    dt = MAINTENANT - prec.get("t", 0)
    neuf = {"t": MAINTENANT}
    feuilles = []
    for d, sous, fichiers in os.walk(racine):
        if "memory.stat" not in fichiers:
            continue
        if any(os.path.exists(os.path.join(d, s, "memory.stat")) for s in sous):
            continue
        rel = os.path.relpath(d, racine)
        anon = 0
        for l in lire(d + "/memory.stat").splitlines():
            if l.startswith("anon "):
                anon = int(l.split()[1])
                break
        sw = entier(d + "/memory.swap.current")
        us = 0
        for l in lire(d + "/cpu.stat").splitlines():
            if l.startswith("usage_usec "):
                us = int(l.split()[1])
                break
        neuf[rel] = us
        cpu = None
        if rel in prec and 0 < dt < 600 and us >= prec[rel]:
            cpu = round((us - prec[rel]) / (dt * 1e6) * 100, 1)
        if anon or sw:
            feuilles.append((rel, anon, sw, cpu))
    etat["cpu"] = neuf
    groupes = {}
    for rel, anon, sw, cpu in feuilles:
        k = categorie(rel)
        g = groupes.setdefault(k, {"k": k, "mo": 0, "t": 0, "l": {}})
        n = nom_feuille(rel, k, conteneurs)
        e = g["l"].setdefault(n, {"n": n, "mo": 0, "t": 0, "cpu": None})
        e["mo"] += anon
        e["t"] += sw
        if cpu is not None:
            e["cpu"] = round((e["cpu"] or 0) + cpu, 1)
    anon_conteneurs = {}
    for g in groupes.values():
        if g["k"] == "conteneurs":
            anon_conteneurs = {n: mo(e["mo"]) for n, e in g["l"].items()}
        l = sorted(g["l"].values(), key=lambda e: -(e["mo"] + e["t"]))
        for e in l:
            e["mo"], e["t"] = mo(e["mo"]), mo(e["t"])
        g["mo"] = sum(e["mo"] for e in l)
        g["t"] = sum(e["t"] for e in l)
        if g["k"] == "conteneurs":
            g["n"] = len(l)
            g["l"] = []                  # la page detaille les conteneurs par pile
            continue
        # Les tout petits processus sont regroupes : 60 lignes de 0 Mo noieraient
        # les 10 qui comptent. Leur somme reste exacte.
        gros = [e for e in l if e["mo"] + e["t"] >= 5]
        petits = [e for e in l if e["mo"] + e["t"] < 5]
        if len(petits) > 1:
            gros.append({"n": "%d autres" % len(petits), "mo": sum(e["mo"] for e in petits),
                         "t": sum(e["t"] for e in petits), "cpu": None})
        else:
            gros += petits
        g["l"] = [{k: v for k, v in e.items() if v is not None} for e in gros]
    # Pointe sur 24 h, par heure : une analyse ponctuelle reste visible une journee.
    pointes = etat.setdefault("pointes", {})
    h = int(MAINTENANT // 3600)
    for g in groupes.values():
        p = pointes.setdefault(g["k"], {})
        p[str(h)] = max(p.get(str(h), 0), g["mo"])
        for cle in [c for c in p if int(c) < h - 23]:
            del p[cle]
        g["p"] = max(p.values())
    return list(groupes.values()), anon_conteneurs


def pression():
    some = re.search(r"some avg10=([\d.]+) avg60=[\d.]+ avg300=([\d.]+)", lire("/proc/pressure/memory"))
    return (float(some.group(1)), float(some.group(2))) if some else (0.0, 0.0)


def memoire(etat):
    m = meminfo()
    z = zram()
    sw = swaps()
    tot, libre = m.get("MemTotal", 0), m.get("MemFree", 0)
    prog = m.get("AnonPages", 0)
    cache = m.get("Cached", 0) + m.get("Buffers", 0)
    zr = sum(x["used"] for x in z) * MO
    noyau = max(0, tot - prog - zr - cache - libre)
    psi, psi5 = pression()
    g, anon = cgroups(etat)
    return {
        "tot": mo(tot), "dispo": mo(m.get("MemAvailable", 0)), "prog": mo(prog),
        "zram": mo(zr), "noyau": mo(noyau), "cache": mo(cache), "libre": mo(libre),
        "tasse": sum(x["orig"] for x in z), "zcap": sum(x["cap"] for x in z),
        "ssd": sum(x["used"] for x in sw), "psi": psi, "psi5": psi5,
        "ram": barrettes(etat), "g": g, "anon": anon,
        "det": {"zram": z, "swaps": [{k: v for k, v in x.items() if k != "chemin"} for x in sw],
                "noyau": {"slab_r": mo(m.get("SReclaimable", 0)), "slab_u": mo(m.get("SUnreclaim", 0)),
                          "pt": mo(m.get("PageTables", 0)), "ks": mo(m.get("KernelStack", 0))},
                "cache": {"actif": mo(m.get("Active(file)", 0)), "inactif": mo(m.get("Inactive(file)", 0)),
                          "shmem": mo(m.get("Shmem", 0))}},
    }


# ---------------------------------------------------------------- ventilateurs
NOMS_VENTILOS = {"cpufan": "processeur", "sysfan1": "boîtier 1", "sysfan2": "boîtier 2"}


def ventilateurs():
    """`/proc/it86/fan`, lisible en root seulement. Format UGOS :
    « sysfan1 speed:482 » ; repli sur les capteurs hwmon s il n existe pas.
    (Emplacement trouve dans le code de l application Stats Hub, 05/10/2026.)"""
    brut = lire("/proc/it86/fan")
    l = []
    for n, v in re.findall(r"(\S+)\s+speed[:\s]+(\d+)", brut):
        l.append({"n": NOMS_VENTILOS.get(n, n), "rpm": int(v)})
    if not l:
        for f in sorted(glob.glob("/sys/class/hwmon/hwmon*/fan*_input")):
            l.append({"n": os.path.basename(f).replace("_input", ""), "rpm": entier(f)})
    if not l:
        note("ventilateurs : /proc/it86/fan illisible (root ?)")
    return l


# ---------------------------------------------------------------- reseau local
def lien():
    i = CONF.get("reseau", "interface", fallback="eth0")
    d = "/sys/class/net/" + i
    if not os.path.isdir(d):
        note("lien : interface %s introuvable" % i)
        return None
    cc = entier(d + "/carrier_changes")
    return {"up": 1 if lire(d + "/operstate").strip() == "up" else 0,
            "vit": entier(d + "/speed"), "mtu": entier(d + "/mtu"),
            # Une montee au demarrage compte 1 ; chaque coupure ajoute une
            # descente et une remontee.
            "coup": max(0, (cc - 1) // 2), "err": entier(d + "/statistics/rx_errors")}


# ---------------------------------------------------------------- internet
def box(chemin):
    """Interface locale de la box : ces routes repondent SANS mot de passe.
    ⚠️ Le certificat est au nom de la box, pas de son adresse : on presente le
    bon nom (SNI) et on n exige pas la verification, sur le reseau local."""
    hote = CONF.get("box", "adresse", fallback="")
    nom = CONF.get("box", "nom", fallback="")
    if not hote:
        return None
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with socket.create_connection((hote, 443), timeout=4) as s:
            with ctx.wrap_socket(s, server_hostname=nom or hote) as t:
                t.sendall(("GET /api/v1/%s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n"
                           % (chemin, nom or hote)).encode())
                rep = b""
                while True:
                    b = t.recv(65536)
                    if not b:
                        break
                    rep += b
        tete, _, corps = rep.partition(b"\r\n\r\n")
        if b"chunked" in tete.lower():
            out, reste = b"", corps
            while reste:
                taille, _, reste = reste.partition(b"\r\n")
                n = int(taille.strip() or b"0", 16)
                if n == 0:
                    break
                out, reste = out + reste[:n], reste[n + 2:]
            corps = out
        return json.loads(corps.decode("utf-8", "replace"))
    except (OSError, ValueError):
        return None


def latence():
    cible = CONF.get("box", "latence", fallback="1.1.1.1")
    t0 = time.monotonic()
    try:
        with socket.create_connection((cible, 443), timeout=3):
            return round((time.monotonic() - t0) * 1000)
    except OSError:
        return 0


def internet(etat):
    ip, st, dev = box("wan/ip"), box("wan/ip/stats"), box("device")
    if not ip or not st:
        note("internet : la box ne repond pas")
        return None
    try:
        w = ip[0]["wan"]
        s = st[0]["wan"]["ip"]["stats"]
        d = (dev or [{}])[0].get("device", {})
    except (KeyError, IndexError, TypeError):
        note("internet : reponse de la box inattendue")
        return None
    rx, tx = int(s["rx"]["bytes"]), int(s["tx"]["bytes"])
    # Debit entre deux passages, puis moyenne par creneau de 10 min sur 24 h.
    # ⚠️ Les compteurs de la box ne bougent pas a chaque seconde : un debit
    # instantane vaudrait souvent 0, la moyenne du creneau lisse ces paliers.
    h = etat.setdefault("wan", {"prec": None, "creneau": None, "h": []})
    p = h.get("prec")
    if p and rx >= p[1] and tx >= p[2] and 0 < MAINTENANT - p[0] < 600:
        c = int(MAINTENANT // 600) * 600
        cr = h.get("creneau")
        if not cr or cr[0] != c:
            if cr and cr[3] > 0:
                h["h"].append([cr[0], round(cr[1] / cr[3]), round(cr[2] / cr[3])])
            cr = [c, 0, 0, 0]
        cr[1] += rx - p[1]
        cr[2] += tx - p[2]
        cr[3] += MAINTENANT - p[0]
        h["creneau"] = cr
        h["h"] = h["h"][-144:]
    h["prec"] = [MAINTENANT, rx, tx]
    return {
        "ok": 1 if w.get("ip", {}).get("state") == "Up" and w.get("link", {}).get("state") == "Up" else 0,
        "v6": 1 if w.get("ip", {}).get("ip6state") == "Up" else 0,
        "cd": s["rx"].get("contractualBandwidth", 0), "cu": s["tx"].get("contractualBandwidth", 0),
        "boxup": int(d.get("uptime", -1)), "err": int(s["rx"].get("packetserrors", 0)) + int(s["tx"].get("packetserrors", 0)),
        "lat": latence(), "h": h["h"],
    }


# ---------------------------------------------------------------- securite et acces
JOURNAL = re.compile(r"^(\S+)\s+\S+\s+sshd\[\d+\]:\s+(.*)$")
EVENEMENTS = [
    (re.compile(r"Accepted (publickey|password) for (\S+) from ([0-9a-fA-F.:]+)"), True),
    (re.compile(r"Failed (?:password|publickey) for (?:invalid user )?(\S+) from ([0-9a-fA-F.:]+)"), False),
    (re.compile(r"Invalid user (\S+) from ([0-9a-fA-F.:]+)"), False),
]


def journal_ssh():
    """Connexions SSH des dernieres 24 h, lues dans `auth.log` (et l archive de
    la veille). Horodatage ISO, comme UGOS l ecrit."""
    debut = MAINTENANT - 86400
    ev = []
    for f in ("/var/log/auth.log.1", "/var/log/auth.log"):
        for l in lire(f).splitlines():
            m = JOURNAL.match(l)
            if not m:
                continue
            try:
                t = time.mktime(time.strptime(m.group(1)[:19], "%Y-%m-%dT%H:%M:%S"))
            except ValueError:
                continue
            if t < debut:
                continue
            for rx, ok in EVENEMENTS:
                e = rx.search(m.group(2))
                if not e:
                    continue
                if ok:
                    ev.append({"t": int(t), "s": "SSH", "u": e.group(2), "ip": e.group(3), "ok": True,
                               "r": "clé" if e.group(1) == "publickey" else "mot de passe"})
                else:
                    ev.append({"t": int(t), "s": "SSH", "u": e.group(1), "ip": e.group(2), "ok": False,
                               "r": "refusée"})
                break
    return ev


UGOS = re.compile(r"\s(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\.\d+\s+\S+\s+insertLog login User \[([^\]]*)\]"
                  r" from \[([^\]]*)\]\s*(.*)$")


def journal_ugos():
    """Connexions a l interface UGOS des dernieres 24 h, lues dans le journal
    de `log_serv` (root seulement). Forme reperee le 05/10/2026 :
    « insertLog login User [admin] from [192.168.1.10] logged in successfully. »,
    suivie de « using biometrics » depuis l application mobile.
    ⚠️ AUCUN ECHEC N AVAIT ENCORE ETE JOURNALISE : on ne connait pas leur
    formulation. Toute ligne de connexion qui ne dit pas « successfully » est
    donc comptee comme refusee, plutot que de passer inapercue. Heure locale."""
    debut = MAINTENANT - 86400
    ev = []
    for f in ("/var/ugreen/log/log_serv.slog.1", "/var/ugreen/log/log_serv.slog"):
        for l in lire(f).splitlines():
            m = UGOS.search(l)
            if not m:
                continue
            try:
                t = time.mktime(time.strptime(m.group(1), "%Y-%m-%d %H:%M:%S"))
            except ValueError:
                continue
            if t < debut:
                continue
            ok = "successfully" in m.group(4)
            ev.append({"t": int(t), "s": "UGOS", "u": m.group(2), "ip": m.group(3), "ok": ok,
                       "r": ("biométrie" if "biometric" in m.group(4) else "mot de passe") if ok else "refusée"})
    return ev


def sessions(noms):
    """Connexions ouvertes maintenant, par protocole, avec le nom de la machine."""
    ports = {"3260": "iSCSI", "22": "SSH", "445": "SMB"}
    vus = {}
    for l in cmd(["ss", "-Htn", "state", "established"]).splitlines():
        p = l.split()
        if len(p) < 4:
            continue
        port = p[2].rsplit(":", 1)[-1]
        if port not in ports:
            continue
        ip = p[3].rsplit(":", 1)[0].strip("[]").replace("::ffff:", "")
        cle = (ports[port], noms.get(ip, ip))
        vus[cle] = vus.get(cle, 0) + 1
    out = []
    for proto in ("iSCSI", "SSH", "SMB"):
        l = [(n, c) for (p, n), c in vus.items() if p == proto]
        if not l:
            out.append({"t": proto, "n": "", "c": 0})
        for n, c in sorted(l, key=lambda x: -x[1]):
            out.append({"t": proto, "n": n, "c": c})
    return out


def regles_parefeu():
    """Regles du pare-feu des conteneurs. On verifie que CHAQUE reseau Docker
    prevu par `firewall-docker-rules.sh` a sa regle : un simple compte ne
    dirait pas lequel manque."""
    brut = cmd(["nft", "-j", "list", "chain", "ip", "filter", "DOCKER-USER"])
    if not brut:
        note("pare-feu : nft illisible (root ?)")
        return None, []
    try:
        regles = [x["rule"] for x in json.loads(brut)["nftables"] if "rule" in x]
    except (ValueError, KeyError):
        return None, []
    acceptees, interfaces = 0, set()
    for r in regles:
        e = r.get("expr", [])
        if any("jump" in x and x["jump"].get("target") == "UG_FORWARD" for x in e):
            break
        if any("accept" in x for x in e):
            acceptees += 1
        for x in e:
            m = x.get("match", {})
            if m.get("left", {}).get("meta", {}).get("key") in ("iifname", "oifname"):
                interfaces.add(m.get("right"))
    script = lire(CONF.get("securite", "script_parefeu", fallback="/usr/local/bin/firewall-docker-rules.sh"))
    prevus = re.findall(r'NET_\w+="([^"]+)"', script) + (["bridge"] if "docker0" in script else [])
    manq = []
    for n in prevus:
        i = cmd(["docker", "network", "inspect", "-f", "{{.Id}}", n]).strip()
        if not i:
            continue                      # reseau supprime : plus rien a ouvrir
        pont = "docker0" if n == "bridge" else "br-" + i[:12]
        if pont not in interfaces:
            manq.append(n)
    return acceptees, manq


def fichiers_ouverts(etat):
    """Fichiers sensibles lisibles par un compte SANS DROIT (`nobody`). On teste
    l acces, on n ouvre rien. ⚠️ `stat` ment sur ce volume (ACL UGOS) : seul un
    vrai test d acces dit la verite. Toutes les cinq minutes."""
    c = etat.get("ouverts")
    if c and MAINTENANT - c.get("t", 0) < 300:
        return c["v"], c["n"]
    base = CONF.get("securite", "racine", fallback="/volume1/docker")
    l = []
    for motif in liste("securite", "sensibles") or ["*/.env", "*/*.env", "*/*/.env"]:
        l += glob.glob(os.path.join(base, motif))
    l = sorted(set(f for f in l if os.path.isfile(f)))
    ouverts = []
    for f in l:
        try:
            r = subprocess.run(["runuser", "-u", "nobody", "--", "test", "-r", f],
                               capture_output=True, timeout=5)
        except (OSError, subprocess.SubprocessError):
            note("fichiers sensibles : runuser indisponible")
            return [], 0
        if r.returncode == 0:
            ouverts.append(os.path.relpath(f, base))
    etat["ouverts"] = {"t": MAINTENANT, "v": ouverts, "n": len(l)}
    return ouverts, len(l)


def securite_acces(etat):
    noms = noms_adresses()
    ev = journal_ssh() + journal_ugos()
    # L adresse devient un nom quand on la connait ; une adresse inconnue reste
    # affichee telle quelle, c est justement elle qu il faut remarquer.
    ext = 0
    for e in ev:
        ip = e.pop("ip")
        e["x"] = not local(ip)
        ext += e["x"]
        e["n"] = noms.get(ip, ip)
    refus = sum(1 for e in ev if not e["ok"])
    fw, manq = regles_parefeu()
    ouverts, verifies = fichiers_ouverts(etat) if os.geteuid() == 0 else (None, 0)
    if ouverts is None:
        note("fichiers sensibles : controle reserve a root")
    ssh = bool(cmd(["ss", "-Hltn", "sport", "=", ":22"]).strip())
    secu = {"fw": fw, "manq": manq, "ouverts": ouverts or [], "verifies": verifies,
            "refus": refus, "ext": ext, "ssh": ssh}
    # Les connexions identiques qui se suivent sont regroupees ICI, sur les 24 h
    # entieres : regroupees par la page sur les seules huit dernieres, un
    # script qui se connecte en boucle affichait « x8 » au lieu de « x117 ».
    groupes = []
    for e in sorted(ev, key=lambda e: -e["t"]):
        p = groupes[-1] if groupes else None
        if p and all(p[k] == e[k] for k in ("s", "u", "n", "r", "ok")):
            p["c"] += 1
        else:
            groupes.append(dict(e, c=1))
    # TOUTES les connexions des 24 h, pour la fenetre de la carte (05/10/2026),
    # en tableaux courts : [heure, service, compte, machine, methode, ok, Internet].
    # Bornees aux 600 plus recentes : une attaque en force brute ne doit pas
    # faire gonfler un fichier que la page relit toutes les 20 s. `n` garde le
    # vrai total, la fenetre dit quand la liste est coupee.
    tous = [[e["t"], e["s"], e["u"], e["n"], e["r"], int(e["ok"]), int(e["x"])]
            for e in sorted(ev, key=lambda e: -e["t"])[:600]]
    acces = {"now": sessions(noms), "log": groupes[:8], "ev": tous, "n": len(ev), "ext": ext}
    return secu, acces


# ---------------------------------------------------------------- stockage
def slots():
    """Slot -> controleur, d apres `nvme-slots.sh` (identite par numero de serie)."""
    s = {}
    for l in cmd([CONF.get("stockage", "slots", fallback=os.path.join(ICI, "nvme-slots.sh"))]).splitlines():
        p = l.split()
        if len(p) == 2:
            s[p[1]] = "nvme" + p[0]
    return s


def disque(dev):
    """« nvme1n1p2 » -> « nvme1 » : le controleur d une partition."""
    m = re.match(r"(nvme\d+)n\d+", os.path.basename(dev))
    return m.group(1) if m else None


def montage(point):
    for l in lire("/proc/mounts").splitlines():
        p = l.split()
        if len(p) > 2 and p[1] == point:
            return p[0], p[2]
    return None, None


def occupe(point):
    try:
        s = os.statvfs(point)
    except OSError:
        return 0, 0
    return s.f_blocks * s.f_frsize, (s.f_blocks - s.f_bfree) * s.f_frsize


def btrfs_erreurs(point, etat):
    c = etat.get("btrfs", {}).get(point)
    if c and MAINTENANT - c["t"] < 600:
        return c["v"]
    sortie = cmd(["btrfs", "device", "stats", point])
    if not sortie:
        note("btrfs : statistiques illisibles (root ?)")
        return None
    v = sum(int(x) for x in re.findall(r"\s(\d+)\s*$", sortie, re.M))
    etat.setdefault("btrfs", {})[point] = {"t": MAINTENANT, "v": v}
    return v


# ---------------------------------------------------------------- detail des disques
def smart_json(ctrl):
    """`smartctl -j -a` d un controleur NVMe (root).
    ⚠️ LE CODE DE RETOUR EST UN MASQUE DE BITS, non nul des que le journal
    d erreurs du disque contient une entree, ce qui est courant et benin :
    `cmd()` aurait jete toute la sortie."""
    try:
        r = subprocess.run(["smartctl", "-j", "-a", "/dev/" + ctrl], capture_output=True, text=True, timeout=20)
        return json.loads(r.stdout or "{}")
    except (OSError, subprocess.SubprocessError, ValueError):
        return {}


def sondes(ctrl):
    """Sondes de temperature d un disque et ses seuils d alerte et critique,
    lus dans hwmon (sans root). Le seuil vient de la sonde « Composite »."""
    for h in glob.glob("/sys/class/hwmon/hwmon*"):
        if os.path.basename(os.path.realpath(os.path.join(h, "device"))) != ctrl:
            continue
        capt = []
        for f in sorted(glob.glob(os.path.join(h, "temp*_input")), key=lambda f: int(re.sub(r"\D", "", os.path.basename(f)) or 0)):
            v = entier(f)
            if v > 0:
                capt.append([lire(f.replace("_input", "_label")).strip() or os.path.basename(f)[:-6], round(v / 1000)])
        return capt, [round(entier(os.path.join(h, "temp1_max")) / 1000) or None,
                      round(entier(os.path.join(h, "temp1_crit")) / 1000) or None]
    return [], [None, None]


def partitions(ctrl):
    """Partitions du disque et ce qu elles portent (RAID, volume, montage)."""
    try:
        a = json.loads(cmd(["lsblk", "-J", "-b", "-o", "NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT",
                            "/dev/%sn1" % ctrl]) or "{}")
    except ValueError:
        return []
    out = []

    def porte(n):
        l = []
        for c in n.get("children") or []:
            l.append({"n": c.get("name"), "t": c.get("type"), "fs": c.get("fstype"), "m": c.get("mountpoint")})
            l += porte(c)
        return l
    for b in a.get("blockdevices", []):
        for p in b.get("children") or []:
            out.append({"n": p.get("name"), "o": int(p.get("size") or 0), "fs": p.get("fstype"),
                        "m": p.get("mountpoint"), "sur": porte(p)})
    return out


def disques(etat):
    """Detail de chaque SSD pour sa fenetre (05/10/2026) : bilan SMART complet,
    sondes et seuils de temperature, liaison PCIe, partitions, et le rythme
    d ecriture tire d un releve par heure garde dans l etat (huit jours).
    SMART bouge lentement : relu toutes les 10 minutes, pas a chaque passage.
    Les cles sont les SLOTS (`nvme-slots.sh`), comme smart.json et les
    colonnes de temperature de l historique."""
    c = etat.get("disq_c")
    if c and MAINTENANT - c.get("t", 0) < 600:
        return c["v"]
    sl = slots()
    hist = etat.setdefault("disq_h", {})
    out = {}
    for d in sorted(glob.glob("/sys/class/nvme/nvme[0-9]*")):
        ctrl = os.path.basename(d)
        n = sl.get(ctrl, ctrl)
        s = smart_json(ctrl)
        h = s.get("nvme_smart_health_information_log") or {}
        if not h:
            note("disques : SMART illisible pour %s (root ?)" % ctrl)
        w = int(h.get("data_units_written") or 0) * 512000      # unite NVMe : 1 000 blocs de 512 o
        r = int(h.get("data_units_read") or 0) * 512000
        rel = hist.setdefault(n, [])
        if w and (not rel or MAINTENANT - rel[-1][0] >= 3600):
            rel.append([int(MAINTENANT), w, r])
            del rel[:-200]

        def rythme(age):
            vieux = [x for x in rel if MAINTENANT - x[0] >= age]
            if not vieux or not w:
                return None
            x = vieux[-1]
            return round((w - x[1]) / ((MAINTENANT - x[0]) / 86400))
        capt, seuils = sondes(ctrl)
        out[n] = {
            "ctrl": ctrl,
            "fw": (s.get("firmware_version") or lire(d + "/firmware_rev")).strip(),
            "ok": (s.get("smart_status") or {}).get("passed"),
            "lien": [lire(d + "/device/current_link_speed").strip(), lire(d + "/device/current_link_width").strip(),
                     lire(d + "/device/max_link_speed").strip(), lire(d + "/device/max_link_width").strip()],
            "seuils": seuils, "capt": capt,
            "h": {"cw": h.get("critical_warning"), "spare": h.get("available_spare"),
                  "spare_min": h.get("available_spare_threshold"), "usure": h.get("percentage_used"),
                  "ecrit": w or None, "lu": r or None, "occupe": h.get("controller_busy_time"),
                  "cycles": h.get("power_cycles"), "heures": h.get("power_on_hours"),
                  "brutaux": h.get("unsafe_shutdowns"), "err_media": h.get("media_errors"),
                  "err_journal": h.get("num_err_log_entries"),
                  "t_alerte": h.get("warning_temp_time"), "t_crit": h.get("critical_comp_time")},
            "rythme": {"j1": rythme(86400), "j7": rythme(7 * 86400)},
            "parts": partitions(ctrl),
        }
    etat["disq_c"] = {"t": MAINTENANT, "v": out}
    return out


def sous_volumes(point):
    """Sous-volumes btrfs du volume, chemins relatifs a sa racine, SANS les
    instantanes : un instantane partage ses donnees avec l original, les
    compter les ferait payer deux fois. Root seulement."""
    def chemins(opts):
        l = set()
        for x in cmd(["btrfs", "subvolume", "list"] + opts + [point], delai=60).splitlines():
            m = re.search(r" path (.+)$", x)
            if m:
                l.add(m.group(1).replace("<FS_TREE>/", ""))
        return l
    tous = chemins([])
    if not tous:
        note("espace : sous-volumes btrfs illisibles (root ?)")
    return sorted(c for c in tous - chemins(["-s"]) if os.path.isdir(os.path.join(point, c)))


def du(chemin):
    """Octets occupes sous `chemin`, sans sortir de son systeme de fichiers.
    ⚠️ LE CODE DE RETOUR EST IGNORE : `du` rend 1 des qu un fichier disparait
    pendant le parcours, ce qui arrive sans cesse sous Docker, et `cmd()` jetait
    alors tout le resultat : le poste tombait a zero."""
    try:
        r = subprocess.run(["du", "-sx", "-B1", chemin], capture_output=True, text=True, timeout=3600)
        return int(r.stdout.split()[0])
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        return 0


def btrfs_df(point):
    """Occupation interne d un volume btrfs, en octets : donnees, metadonnees et
    zone systeme, COPIES COMPRISES (DUP ou RAID 1 : deux exemplaires). La somme
    retombe exactement sur l occupation de `statvfs`, a la reserve pres. Sans
    root (verifie le 06/10/2026)."""
    o = {}
    for l in cmd(["btrfs", "filesystem", "df", "-b", point]).splitlines():
        m = re.match(r"(\w+), (\w+): total=(\d+), used=(\d+)", l.strip())
        k = {"Data": "data", "Metadata": "meta", "System": "sys"}.get(m.group(1)) if m else None
        if k:
            n = {"DUP": 2, "RAID1": 2, "RAID10": 2, "RAID1C3": 3, "RAID1C4": 4}.get(m.group(2).upper(), 1)
            o[k] = int(m.group(4)) * (1 if k == "data" else n)
    return o


def du_detail(chemin):
    """Taille de `chemin` et de chacun de ses enfants directs, fichiers compris,
    en UN SEUL parcours : un fichier a plusieurs noms (lien physique) n y est
    compte qu une fois, dans le premier dossier rencontre, et la somme des
    enfants retombe exactement sur le total.
    ⚠️ C est pourquoi « torrents » peut paraitre presque vide : ses fichiers
    sont aussi ceux de Films et Series, poses par Radarr et Sonarr en liens
    physiques. Chaque dossier est donc AUSSI mesure seul ; l ecart, `p`, est ce
    qu il partage avec un dossier deja compte. Mesure seule limitee aux
    dossiers qui ont au plus 40 sous-dossiers, pour garder la nuit courte."""
    tot, enf = 0, []
    try:
        r = subprocess.run(["du", "-x", "-a", "-B1", "-d", "1", chemin], capture_output=True, text=True, timeout=3600)
    except (OSError, subprocess.SubprocessError):
        return 0, []
    for l in r.stdout.splitlines():
        o, _, p = l.partition("\t")
        try:
            o = int(o)
        except ValueError:
            continue
        if p.rstrip("/") == chemin.rstrip("/"):
            tot = o
        else:
            enf.append({"n": os.path.basename(p), "o": o})
    reps = [e for e in enf if os.path.isdir(os.path.join(chemin, e["n"]))]
    if len(reps) <= 40:
        for e in reps:
            p = du(os.path.join(chemin, e["n"])) - e["o"]
            if p >= 1e9:
                e["p"] = p
    return tot, enf


def mesure_nuit():
    """Place prise par chaque grand dossier du volume (`du`, une fois par nuit :
    parcourir des teraoctets coute cher). Les postes viennent de `systeme.conf`.
    Les dossiers systeme d UGOS, ceux qui commencent par @, vont dans
    « applications » s ils ne sont pas nommes ailleurs.
    ⚠️ `du -x` S ARRETE AU BORD DE CHAQUE SOUS-VOLUME BTRFS, qui a son propre
    numero de peripherique. Le disque iSCSI de 3 To (un fichier « thick » dans
    @iscsi/LUN/thick/<id>/, sous-volume a part) etait donc ignore : 21 Go
    comptes, ceux de deux fichiers de test oublies (05/10/2026). Chaque
    sous-volume est maintenant mesure a part, en gardant `-x` : sans lui, `du`
    entrerait dans les montages des conteneurs (@docker/overlay2/*/merged) et
    compterait chaque image une seconde fois."""
    point = CONF.get("stockage", "volume", fallback="/volume1")
    postes = {k: liste("espace", k) for k in ("medias", "partages", "cameras", "iscsi", "docker")} \
        if CONF.has_section("espace") else {}
    nommes = {d for l in postes.values() for d in l}
    try:
        dossiers = os.listdir(point)
    except OSError:
        return
    postes["applis"] = [d for d in dossiers if d.startswith("@") and d not in nommes]
    sv = sous_volumes(point)
    res, det = {}, {}
    for k, l in postes.items():
        tot, dossiers_k = 0, []
        for d in l:
            t, enf = du_detail(os.path.join(point, d))
            # Les sous-volumes que `du -x` a sautes : chacun rejoint l enfant
            # dont il descend (@home/<compte> -> « <compte> », @iscsi/LUN/thick/<id> ->
            # « LUN »), ou devient un enfant s il n y en avait pas.
            for s in [s for s in sv if s.startswith(d + "/")]:
                o = du(os.path.join(point, s))
                t += o
                tete = s[len(d) + 1:].split("/")[0]
                e = next((x for x in enf if x["n"] == tete), None)
                if e:
                    e["o"] += o
                else:
                    enf.append({"n": tete, "o": o})
            tot += t
            enf.sort(key=lambda x: -x["o"])
            if len(enf) > 15:
                reste = enf[14:]
                enf = enf[:14] + [{"n": "%d autres" % len(reste), "o": sum(x["o"] for x in reste), "g": 1}]
            dossiers_k.append({"n": d, "o": t, "l": enf})
        res[k] = tot
        det[k] = sorted(dossiers_k, key=lambda x: -x["o"])
    # Ce que la carte range dans « Autres » : les entrees de premier niveau que
    # ni un poste ni la regle des « @ » ne reclament, et ce que btrfs garde en
    # donnees au moment de la mesure (pour l ecart avec `du`, voir `stockage`).
    nc = [{"n": d, "o": du(os.path.join(point, d))} for d in sorted(dossiers)
          if not d.startswith("@") and d not in nommes]
    df = btrfs_df(point)
    snap = len([x for x in cmd(["btrfs", "subvolume", "list", "-s", point], delai=60).splitlines() if " path " in x])
    # Le disque systeme : le contenu de chaque partition, un niveau.
    sysd = {}
    for m in (liste("stockage", "systeme") or ["/rootfs", "/boot", "/overlay"]) \
            + (liste("stockage", "applications") or ["/ugreen"]):
        enf = du_detail(m)[1]
        enf.sort(key=lambda x: -x["o"])
        sysd[m] = enf[:14] + ([{"n": "%d autres" % (len(enf) - 14), "o": sum(x["o"] for x in enf[14:]), "g": 1}]
                              if len(enf) > 15 else enf[14:15])
    if ESSAI:
        print(json.dumps({"non_classes": nc, "btrfs": df, "instantanes": snap,
                          "systeme": {m: [[x["n"], round(x["o"] / 1e6)] for x in l[:8]] for m, l in sysd.items()}},
                         ensure_ascii=False, indent=1))
        print(json.dumps({"sous_volumes": sv, "postes_go": {k: round(v / 1e9, 1) for k, v in res.items()},
                          "detail_go": {k: [[d["n"], round(d["o"] / 1e9, 1),
                                             [[e["n"], round(e["o"] / 1e9, 1)] + ([round(e["p"] / 1e9, 1)] if e.get("p") else [])
                                              for e in d["l"] if e["o"] >= 1e9]] for d in l]
                                        for k, l in det.items()},
                          "problemes": PROBLEMES}, ensure_ascii=False, indent=1))
        return
    ecrire(NUIT, {"t": MAINTENANT, "parts": res, "det": det, "nc": nc, "data": df.get("data"),
                  "snap": snap, "sys": sysd})


def stockage(etat):
    sl = slots()
    roles, grappes = {}, []
    nuit, nuit_j = {}, {}
    try:
        nuit_j = json.loads(lire(NUIT) or "{}")
        nuit = nuit_j.get("parts", {})
    except ValueError:
        pass
    # Les grappes RAID logicielles et le volume qu elles portent.
    arbre = {}
    try:
        arbre = json.loads(cmd(["lsblk", "-J", "-b", "-o", "NAME,TYPE,MOUNTPOINT,SIZE"]) or "{}")
    except ValueError:
        pass

    def descendre(noeud, nom):
        if noeud.get("name") == nom:
            return noeud
        for c in noeud.get("children", []) or []:
            r = descendre(c, nom)
            if r:
                return r
        return None

    def premier_montage(noeud):
        if noeud.get("mountpoint"):
            return noeud["mountpoint"]
        for c in noeud.get("children", []) or []:
            r = premier_montage(c)
            if r:
                return r
        return None

    for md in sorted(glob.glob("/sys/block/md*/md")):
        nom = md.split("/")[3]
        membres = [disque(x) for x in os.listdir(os.path.join(os.path.dirname(md), "slaves"))]
        membres = [sl.get(x, x) for x in membres if x]
        att = entier(md + "/raid_disks")
        n = att - entier(md + "/degraded")
        point = None
        for b in arbre.get("blockdevices", []):
            r = descendre(b, nom)
            if r:
                point = premier_montage(r)
                break
        if not point:
            continue
        _, fs = montage(point)
        tot, used = occupe(point)
        parts = {k: v for k, v in nuit.items() if v > 0}
        if nuit:
            # ⚠️ LES MEDIAS SONT MESURES, PLUS DEDUITS. Calcules comme le reste
            # de l occupation, ils absorbaient tout ce qu un autre poste
            # manquait : le disque iSCSI de 3 To y passait, et les medias
            # affichaient 4,5 To pour 0,9 reel (05/10/2026). Le reste va
            # maintenant dans « autres » : dossiers non classes, metadonnees.
            reste = used - sum(parts.values())
            if reste > 0:
                parts["autres"] = reste
        else:
            parts = {"autres": used}      # avant la premiere mesure de nuit
        g = {"nom": "Volume " + re.sub(r"\D", "", point) if re.search(r"\d", point) else point,
             "raid": lire(md + "/level").strip(), "fs": fs, "n": n, "att": att,
             "disques": membres, "err": btrfs_erreurs(point, etat) if fs == "btrfs" else None,
             "esp": {"tot": tot, "used": used, "parts": parts}}
        # Le detail dossier par dossier, pour la fenetre de l espace : seulement
        # pour le volume que mesure la nuit.
        if nuit_j.get("det") and point == CONF.get("stockage", "volume", fallback="/volume1"):
            g["esp"]["det"] = nuit_j["det"]
            g["esp"]["mesure"] = int(nuit_j.get("t") or 0)
            # « Autres », decompose (06/10/2026). Ce que `du` ne voit pas, d apres
            # btrfs lui-meme : les metadonnees (en double), la reserve, et l ecart
            # entre les donnees que btrfs garde et celles que `du` trouve dans les
            # fichiers, fige a la mesure de nuit : des blocs conserves par la copie
            # sur ecriture quand un gros fichier est reecrit par morceaux (disque
            # iSCSI, torrents), ou des instantanes. Le reste est ce qui a ete
            # ecrit (ou efface) depuis la mesure.
            df = btrfs_df(point) if fs == "btrfs" else {}
            if df and nuit_j.get("data") is not None and "autres" in parts:
                meta = df.get("meta", 0) + df.get("sys", 0)
                reserve = max(0, used - df.get("data", 0) - meta)
                nc = nuit_j.get("nc") or []
                cow = max(0, nuit_j["data"] - sum(nuit.values()) - sum(x["o"] for x in nc))
                g["esp"]["autres"] = {"meta": meta, "reserve": reserve, "cow": cow, "snap": nuit_j.get("snap", 0),
                                      "nc": nc, "depuis": parts["autres"] - meta - reserve - cow - sum(x["o"] for x in nc)}
        grappes.append(g)
        for x in membres:
            roles[x] = "donnees"
    # Le disque systeme : celui qui porte la racine.
    dev, _ = montage(CONF.get("stockage", "racine", fallback="/rootfs"))
    if dev:
        c = disque(dev)
        s = sl.get(c, c)
        roles[s] = "systeme"
        taille = 0
        for b in arbre.get("blockdevices", []):
            if b.get("name", "").startswith(c + "n"):
                taille = int(b.get("size") or 0)
        m_sys = liste("stockage", "systeme") or ["/rootfs", "/boot", "/overlay"]
        m_app = liste("stockage", "applications") or ["/ugreen"]
        sw = swaps()
        # ⚠️ UN FICHIER D ECHANGE POSE SUR UNE PARTITION DU SYSTEME occupe cette
        # partition : UGOS en met un de 4 Go dans /overlay, qui etait compte en
        # « systeme » (4 Go sur 7,7, releve le 06/10/2026). Il passe en swap.
        def fichiers_sw(m):
            l = []
            for x in sw:
                if x["n"] == "fichier" and x["chemin"].startswith(m.rstrip("/") + "/"):
                    try:
                        l.append((x["chemin"], os.stat(x["chemin"]).st_blocks * 512))
                    except OSError:
                        l.append((x["chemin"], x["size"] * MO))
            return l
        sdet = nuit_j.get("sys") or {}

        def entree(m):
            fs_ = fichiers_sw(m)
            o = occupe(m)[1] - sum(t for _, t in fs_)
            base = {os.path.basename(ch) for ch, _ in fs_}
            l = [x for x in sdet.get(m, []) if x["n"] not in base]
            reste = o - sum(x["o"] for x in l)
            if l and reste >= 100 * MO:
                l.append({"n": "structures du système de fichiers", "o": reste, "g": 1})
            return {"n": m, "o": o, "l": l}
        dsys, dapp = [entree(m) for m in m_sys], [entree(m) for m in m_app]
        dswap = [{"n": "partition " + os.path.basename(x["chemin"]), "o": x["size"] * MO}
                 for x in sw if x["n"] == "ssd" and c in x["chemin"]]
        dswap += [{"n": "fichier " + ch, "o": t} for m in m_sys + m_app for ch, t in fichiers_sw(m)]
        sys_parts = {"systeme": sum(x["o"] for x in dsys), "applis": sum(x["o"] for x in dapp),
                     "swap": sum(x["o"] for x in dswap)}
        grappes.append({"nom": "Système", "sys": True, "disques": [s],
                        "esp": {"tot": taille, "parts": {k: v for k, v in sys_parts.items() if v > 0},
                                "det": {"systeme": dsys, "applis": dapp, "swap": dswap},
                                "mesure": int(nuit_j.get("t") or 0) if sdet else 0}})
    # Emplacements de DONNEES : le disque systeme a le sien, a part (DXP480T
    # Plus : quatre M.2 pour les donnees, plus celui du systeme).
    tot_slots = CONF.getint("stockage", "emplacements", fallback=4)
    donnees = len([x for x in sl.values() if roles.get(x) != "systeme"])
    return {"grappes": grappes, "roles": roles,
            "slots": {"tot": tot_slots, "libres": max(0, tot_slots - donnees)}}


# ---------------------------------------------------------------- fankarr
def fankarr(etat):
    """Ce que FanKarr a telecharge (06/10/2026, demande : « des pastilles
    comme Sonarr et Radarr »). FanKarr n a pas d API simple a interroger, mais
    ses fichiers de suivi disent tout : `organized.json`, chaque episode importe
    avec son chemin ; `rss-synced.json`, les series suivies. Les telechargements
    EN COURS se comptent dans qBittorrent, par sa categorie (reglage `category`
    de FanKarr) : un torrent importe est supprime (`deleteTorrentOnMove`), il ne
    reste donc que ceux qui n ont pas fini. On lit les `.fastresume` sur disque,
    sans identifiant qBittorrent.
    Toutes les 10 minutes : rien de tout cela ne bouge vite."""
    c = etat.get("fankarr")
    if c and MAINTENANT - c.get("t", 0) < 600:
        return c["v"]
    rep = CONF.get("fankarr", "config", fallback="/volume1/docker/arr/fankarr/config")
    data = CONF.get("fankarr", "data", fallback="/volume1/Jellyfin")
    bt = CONF.get("fankarr", "bt_backup", fallback="/volume1/docker/arr/qbittorrent/config/qBittorrent/BT_backup")
    try:
        org = json.loads(lire(os.path.join(rep, "organized.json")) or "{}")
    except ValueError:
        org = {}
    if not org:
        note("fankarr : organized.json illisible")
        return None
    eps = [e for v in org.values() if isinstance(v, dict) for e in v.values() if isinstance(e, dict)]
    taille, absents, dernier = 0, 0, ""
    for e in eps:
        p = e.get("dest_path") or ""
        if p.startswith("/data/"):
            p = os.path.join(data, p[len("/data/"):])      # chemin vu par le conteneur -> NAS
        try:
            taille += os.stat(p).st_size
        except OSError:
            absents += 1
        dernier = max(dernier, e.get("at") or "")
    try:
        series = [x.get("serieName") for x in json.loads(lire(os.path.join(rep, "rss-synced.json")) or "{}").values()]
    except (ValueError, AttributeError):
        series = []
    try:
        cat = json.loads(lire(os.path.join(rep, "settings.json")) or "{}").get("category") or "fankai"
    except ValueError:
        cat = "fankai"
    motif = ("12:qBt-category%d:%s" % (len(cat.encode()), cat)).encode()
    cours = 0
    for f in glob.glob(os.path.join(bt, "*.fastresume")):
        try:
            with open(f, "rb") as h:
                cours += motif in h.read()
        except OSError:
            pass
    try:                                   # horodatage en UTC (« …Z ») : timegm, pas mktime
        t = calendar.timegm(time.strptime(dernier[:19], "%Y-%m-%dT%H:%M:%S")) if dernier else 0
    except ValueError:
        t = 0
    v = {"ep": len(eps), "o": taille, "absents": absents, "series": [s for s in series if s],
         "cours": cours, "dernier": t}
    etat["fankarr"] = {"t": MAINTENANT, "v": v}
    return v


# ---------------------------------------------------------------- kuma
def http_json(url):
    import urllib.request
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except (OSError, ValueError):
        return None


def utc(s):
    """« 2026-10-05 18:11:24.525 », heure UTC comme Kuma l ecrit."""
    import calendar
    try:
        return calendar.timegm(time.strptime(s[:19], "%Y-%m-%d %H:%M:%S"))
    except (ValueError, TypeError):
        return None


def kuma(etat):
    """Periodes hors ligne (0) ou en attente (2) de CHAQUE sonde sur 24 h, pour
    que l infobulle du ruban nomme les sondes en cause (05/10/2026).
    La page de statut ne rend que les 100 derniers battements de chaque sonde,
    soit 1 h 40 environ : c est le passage de chaque minute qui accumule les
    24 h. Un battement en echec vaut jusqu au battement suivant ; les periodes
    revues d un passage a l autre se fondent, rien n est compte deux fois."""
    base = CONF.get("kuma", "url", fallback="")
    page = CONF.get("kuma", "page", fallback="")
    if not base or not page:
        return None
    hb = http_json(base + "/api/status-page/heartbeat/" + page)
    sp = http_json(base + "/api/status-page/" + page)
    if not hb or not sp:
        note("kuma : page de statut injoignable")
        return None
    noms = {}
    for g in sp.get("publicGroupList", []):
        gn = re.sub(r"^[^\w*]+", "", g.get("name", "")).strip()
        for m in g.get("monitorList", []):
            noms[str(m["id"])] = (m.get("name", "?"), gn)
    st = etat.setdefault("kuma", {})
    debut = MAINTENANT - 86400
    for mid, b in (hb.get("heartbeatList") or {}).items():
        for i, x in enumerate(b):
            if x.get("status") not in (0, 2):
                continue
            t0 = utc(x.get("time"))
            t1 = utc(b[i + 1].get("time")) if i + 1 < len(b) else MAINTENANT
            if t0 is None or t1 is None:
                continue
            st.setdefault(mid, {}).setdefault(str(x["status"]), []).append([t0, max(t0 + 1, t1)])
    inc = []
    for mid, par in list(st.items()):
        for s, l in list(par.items()):
            fondues = []
            for a, z in sorted(p for p in l if p[1] >= debut):
                if fondues and a <= fondues[-1][1] + 5:
                    fondues[-1][1] = max(fondues[-1][1], z)
                else:
                    fondues.append([a, z])
            par[s] = fondues
            n, g = noms.get(mid, ("sonde " + mid, ""))
            inc += [{"n": n, "g": g, "s": int(s), "t0": int(a), "t1": int(z)} for a, z in fondues]
        if not any(par.values()):
            del st[mid]
    return {"inc": inc}


# ---------------------------------------------------------------- sauvegarde
def sauvegarde():
    """Compte rendu ecrit par `nas-backup.sh` apres chaque copie reussie."""
    try:
        return json.loads(lire(SAUVEGARDE) or "null")
    except ValueError:
        return None


# ---------------------------------------------------------------- ecriture
def ecrire(chemin, obj):
    """Ecriture ATOMIQUE : la page relit le fichier sans cesse, elle ne doit
    jamais tomber sur un JSON a moitie ecrit."""
    tmp = chemin + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.chmod(tmp, 0o644)
    os.replace(tmp, chemin)


VERROUS = []     # ⚠️ gardes jusqu a la fin : un verrou ramasse est un verrou relache


def verrouiller(nom):
    """Verrou exclusif sans attente : si un passage tourne encore, on sort."""
    v = open(os.path.join(ETAT_DIR, nom), "w")
    try:
        fcntl.flock(v, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        v.close()
        return None
    VERROUS.append(v)
    return v


def main():
    if not ESSAI:
        os.makedirs(ETAT_DIR, exist_ok=True)
    # ⚠️ LA MESURE DE NUIT A SON PROPRE VERROU ET NE FAIT QUE CELA. Parcourir
    # des teraoctets prend des minutes : sous le verrou commun, elle aurait
    # bloque tous les passages de la minute, et la page serait restee figee.
    if NUIT_DEMANDEE:
        v = verrouiller("verrou-nuit") if not ESSAI else True
        if v:
            mesure_nuit()
        return
    if not ESSAI and not verrouiller("verrou"):
        return                            # un passage tourne encore
    etat = charger_etat()
    out = {"t": int(MAINTENANT)}
    for cle, f in (("mem", lambda: memoire(etat)), ("fans", ventilateurs), ("lan", lien),
                   ("wan", lambda: internet(etat)), ("stock", lambda: stockage(etat)),
                   ("disq", lambda: disques(etat)), ("fankarr", lambda: fankarr(etat)),
                   ("backup", sauvegarde), ("kuma", lambda: kuma(etat))):
        try:
            out[cle] = f()
        except Exception as e:            # une section en panne n emporte pas les autres
            note("%s : %s" % (cle, e))
    try:
        out["secu"], out["acces"] = securite_acces(etat)
    except Exception as e:
        note("securite : %s" % e)
    out["problemes"] = PROBLEMES
    if ESSAI:
        print(json.dumps(out, ensure_ascii=False, indent=1)[:20000])
        return
    ecrire(SORTIE, out)
    ecrire(ETAT, etat)


if __name__ == "__main__":
    main()
