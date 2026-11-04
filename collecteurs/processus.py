#!/usr/bin/python3
"""QUI CONSOMMAIT QUOI, A LA MINUTE, SUR 7 JOURS (04/11/2026, demande).

Le 04/11, le processeur est monte a 99 % et 84 °C pendant une douzaine de minutes,
et personne n a pu dire apres coup quel processus en etait la cause : l historique
du portail ne garde que les totaux.

    processus.py                          un releve (cron, chaque minute, en root)
    processus.py --voir 11:30-11:45       qui consommait sur cette plage, aujourd hui
    processus.py --voir 11:30-11:45 2026-11-04

⚠️ TOUT EST LU, SEUL CE QUI A AGI EST ECRIT. Un releve coute environ 270 ms de processeur
pour 620 processus (mesure le 04/11), soit 0,04 % de la machine a raison d un par
minute. Les ecrire tous ferait 150 Mo par semaine pour des lignes a zero : on garde
ceux qui ont consomme, et les plus gros en memoire, environ 2 Mo par jour.

⚠️ LES NOMS SEULS, JAMAIS LA LIGNE DE COMMANDE : elle peut porter des mots de passe.

⚠️ LE SUIVI SE FAIT PAR NUMERO ET DATE DE DEPART, PAS PAR NOM : les `kworker` changent
de nom selon leur travail, et un numero peut resservir. Les processus de moins d une
minute echappent a ce suivi : les SERVICES (cgroups) les comptent quand meme, dans
leur total, meme une fois termines.
"""
import gzip
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import date, timedelta

DOSSIER = os.environ.get("PROCESSUS_DOSSIER", "/volume1/docker/homelab/processus")
# en memoire (/run) : rien a user sur le SSD pour un fichier reecrit chaque minute
ETAT = os.environ.get("PROCESSUS_ETAT", "/run/homelab-processus.json")
GARDE_JOURS = 7
SEUIL_CPU = 0.5   # % d un coeur sur la minute
SEUIL_IO = 1.0    # Mo sur la minute
SEUIL_SERVICE = 1.0
NB_RAM = 5        # les plus gros en memoire, meme inactifs
NB_MAX = 30
TICK = os.sysconf("SC_CLK_TCK")
PAGE = os.sysconf("SC_PAGE_SIZE")
MO = 1048576
# ⚠️ Seuls ces noms sont compresses ou purges : ce script ne possede que son dossier.
NOM_JOUR = re.compile(r"^(\d{4}-\d{2}-\d{2})\.jsonl(\.gz)?$")


def lire(chemin):
    with open(chemin, "rb") as f:
        return f.read().decode("utf-8", "replace")


def processus():
    """numero -> (nom, depart, ticks de processeur, memoire, octets lus, octets ecrits)"""
    l = {}
    for e in os.scandir("/proc"):
        if not e.name.isdigit():
            continue
        try:
            s = lire("/proc/%s/stat" % e.name)
            a, b = s.index("("), s.rindex(")")
            c = s[b + 2:].split()    # c[0] est le champ 3 de stat : champ n = c[n - 3]
            lu = ecrit = 0
            try:
                for ligne in lire("/proc/%s/io" % e.name).splitlines():
                    if ligne.startswith("read_bytes:"):
                        lu = int(ligne.split()[1])
                    elif ligne.startswith("write_bytes:"):
                        ecrit = int(ligne.split()[1])
            except OSError:
                pass                 # sans droits : le compteur reste a zero
            l[e.name] = (s[a + 1:b], int(c[19]), int(c[11]) + int(c[12]), int(c[21]) * PAGE, lu, ecrit)
        except (OSError, ValueError, IndexError):
            continue                 # parti entre-temps
    return l


def nom_lisible(nom):
    # « kworker/u48:10-btrfs-endio » : le travail dit quelque chose, le numero rien.
    # Le premier separateur seulement : « + » si le travail est en cours (« kworker/u48:14+flush-8:16 »).
    if nom.startswith("kworker/"):
        m = re.split(r"[-+]", nom, maxsplit=1)
        return "kworker " + m[1] if len(m) > 1 else "kworker"
    return nom


def services():
    """service -> microsecondes de processeur, enfants termines compris"""
    r = {}
    for racine, dossiers, fichiers in os.walk("/sys/fs/cgroup"):
        if dossiers or "cpu.stat" not in fichiers:
            continue                 # les feuilles seules : un parent compte aussi ses enfants
        try:
            m = re.search(r"^usage_usec (\d+)", lire(racine + "/cpu.stat"), re.M)
        except OSError:
            continue
        if not m:
            continue
        nom = os.path.relpath(racine, "/sys/fs/cgroup").split("/")
        # une tache de copie porte un identifiant : « cpmv/edd71509-… » devient « cpmv »
        n = nom[-1] if not re.fullmatch(r"[0-9a-f-]{32,}", nom[-1]) else nom[-2]
        n = re.sub(r"^docker-([0-9a-f]{12})[0-9a-f]*\.scope$", r"docker-\1", n)
        r[n] = r.get(n, 0) + int(m.group(1))
    return r


def totaux():
    c = [int(x) for x in lire("/proc/stat").splitlines()[0].split()[1:9]]
    return {"tout": sum(c), "attente": c[4], "repos": c[3] + c[4]}


def pression(nom):
    try:
        return float(re.search(r"avg60=([\d.]+)", lire("/proc/pressure/" + nom)).group(1))
    except (OSError, AttributeError):
        return None


def temperature():
    try:
        for e in os.scandir("/sys/class/thermal"):
            if e.name.startswith("thermal_zone") and lire(e.path + "/type").strip() == "x86_pkg_temp":
                return int(lire(e.path + "/temp")) // 1000
    except (OSError, ValueError):
        pass
    return None


def memoire():
    m = {}
    for ligne in lire("/proc/meminfo").splitlines():
        k, v = ligne.split(":", 1)
        m[k] = int(v.split()[0])
    return m.get("MemAvailable", 0) // 1024, (m.get("SwapTotal", 0) - m.get("SwapFree", 0)) // 1024


def ranger(aujourd_hui):
    """Une fois par jour : compresse les jours passes, retire ceux de plus de 7 jours."""
    limite = (aujourd_hui - timedelta(days=GARDE_JOURS)).isoformat()
    for e in os.scandir(DOSSIER):
        m = NOM_JOUR.match(e.name)
        if not m:
            continue
        if m.group(1) < limite:
            os.remove(e.path)
        elif not m.group(2) and m.group(1) != aujourd_hui.isoformat():
            with open(e.path, "rb") as src, gzip.open(e.path + ".tmp", "wb") as dst:
                shutil.copyfileobj(src, dst)
            os.replace(e.path + ".tmp", e.path + ".gz")
            os.remove(e.path)


def releve():
    # ⚠️ En root, l umask d UGOS (066) ferait naitre des fichiers illisibles par Alex.
    os.umask(0o022)
    os.makedirs(DOSSIER, exist_ok=True)
    maintenant = time.time()
    p, s, g = processus(), services(), totaux()
    try:
        av = json.loads(lire(ETAT))
    except (OSError, ValueError):
        av = None
    if av and maintenant > av["t"]:
        d = maintenant - av["t"]
        par_nom = {}
        for pid, (nom, depart, ticks, ram, lu, ecrit) in p.items():
            q = av["p"].get(pid)
            memes = q and q[0] == depart
            n = par_nom.setdefault(nom_lisible(nom), [0, 0, 0, 0, 0])
            # un processus apparu depuis le dernier releve : tout ce qu il a consomme compte
            n[0] += max(0, ticks - (q[1] if memes else 0))
            n[1] += ram
            n[2] += max(0, lu - (q[2] if memes else 0))
            n[3] += max(0, ecrit - (q[3] if memes else 0))
            n[4] += 1
        lignes = [[k, round(v[0] / TICK / d * 100, 1), v[1] // MO, round(v[2] / MO, 1), round(v[3] / MO, 1), v[4]]
                  for k, v in par_nom.items()]
        actifs = [x for x in lignes if x[1] >= SEUIL_CPU or x[3] >= SEUIL_IO or x[4] >= SEUIL_IO]
        gros = sorted(lignes, key=lambda x: -x[2])[:NB_RAM]
        garde = sorted({x[0]: x for x in actifs + gros}.values(), key=lambda x: (-x[1], -x[2]))[:NB_MAX]
        sv = sorted(([k, round(max(0, v - av["s"].get(k, 0)) / 1e6 / d * 100, 1)] for k, v in s.items()), key=lambda x: -x[1])
        tout = max(1, g["tout"] - av["g"]["tout"])
        dispo, swap = memoire()
        ligne = {"t": int(maintenant), "d": round(d), "calc": round((tout - (g["repos"] - av["g"]["repos"])) / tout * 100, 1),
                 "att": round((g["attente"] - av["g"]["attente"]) / tout * 100, 1), "temp": temperature(), "dispo": dispo, "swap": swap,
                 "io": pression("io"), "mem": pression("memory"), "p": garde, "s": [x for x in sv if x[1] >= SEUIL_SERVICE][:12]}
        jour = date.fromtimestamp(maintenant)
        chemin = os.path.join(DOSSIER, jour.isoformat() + ".jsonl")
        if not os.path.exists(chemin):
            ranger(jour)
        with open(chemin, "a", encoding="utf-8") as f:
            f.write(json.dumps(ligne, ensure_ascii=False, separators=(",", ":")) + "\n")
    etat = {"t": maintenant, "g": g, "s": s, "p": {k: [v[1], v[2], v[4], v[5]] for k, v in p.items()}}
    with open(ETAT + ".tmp", "w", encoding="utf-8") as f:
        json.dump(etat, f, separators=(",", ":"))
    os.replace(ETAT + ".tmp", ETAT)


def lignes_du_jour(jour):
    for chemin, ouvrir in ((os.path.join(DOSSIER, jour + ".jsonl"), open), (os.path.join(DOSSIER, jour + ".jsonl.gz"), gzip.open)):
        if os.path.exists(chemin):
            with ouvrir(chemin, "rt", encoding="utf-8") as f:
                return [json.loads(x) for x in f if x.strip()]
    return []


def conteneurs():
    try:
        s = subprocess.run(["docker", "ps", "--no-trunc", "--format", "{{.ID}} {{.Names}}"], capture_output=True, text=True, timeout=10).stdout
        return {"docker-" + x.split()[0][:12]: x.split()[1] for x in s.splitlines() if len(x.split()) == 2}
    except (OSError, subprocess.SubprocessError):
        return {}


def voir(plage, jour):
    a, _, b = plage.partition("-")
    a, b = a.strip(), (b or a).strip()
    l = [x for x in lignes_du_jour(jour) if a <= time.strftime("%H:%M", time.localtime(x["t"])) <= b]
    if not l:
        print("Rien de garde pour", jour, plage)
        return
    duree = sum(x["d"] for x in l)
    print("%s, %s a %s : %d releves" % (jour, a, b, len(l)))
    print("calcul moyen %.0f %%, attente disque moyenne %.0f %%, temperature maxi %s C, memoire dispo mini %d Mo, swap maxi %d Mo" % (
        sum(x["calc"] * x["d"] for x in l) / duree, sum(x["att"] * x["d"] for x in l) / duree,
        max((x["temp"] or 0) for x in l), min(x["dispo"] for x in l), max(x["swap"] for x in l)))
    cumul = {}
    for x in l:
        for nom, cpu, ram, lu, ecrit, _ in x["p"]:
            c = cumul.setdefault(nom, [0, 0, 0, 0, 0])
            c[0] += cpu * x["d"]
            c[1] = max(c[1], cpu)
            c[2] = max(c[2], ram)
            c[3] += lu
            c[4] += ecrit
    print("\n%-34s %8s %8s %9s %9s %9s" % ("processus", "% moyen", "% maxi", "RAM maxi", "lu", "ecrit"))
    for nom, c in sorted(cumul.items(), key=lambda kv: -kv[1][0])[:14]:
        print("%-34s %8.1f %8.1f %6d Mo %6d Mo %6d Mo" % (nom[:34], c[0] / duree, c[1], c[2], c[3], c[4]))
    sv, noms = {}, conteneurs()
    for x in l:
        for nom, cpu in x["s"]:
            sv[nom] = sv.get(nom, 0) + cpu * x["d"]
    print("\nservices, enfants termines compris (100 % = un coeur)")
    for nom, v in sorted(sv.items(), key=lambda kv: -kv[1])[:10]:
        print("  %-40s %6.1f %%" % (noms.get(nom, nom)[:40], v / duree))


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--voir":
        voir(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else date.today().isoformat())
    else:
        releve()
