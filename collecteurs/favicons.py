#!/usr/bin/env python3
"""Rapatrie sur le NAS les favicons des raccourcis (22/08/2026).

Les icônes étaient chargées depuis les sites eux-mêmes, ce qui produit des
requêtes tierces : le bouclier de Brave en bloque une partie
(ERR_BLOCKED_BY_CLIENT) et certains domaines les refusent carrément
(ERR_BLOCKED_BY_RESPONSE.NotSameSite). Servies depuis le NAS, elles n'ont plus
aucune raison d'être bloquées, et la liste des sites visités ne part plus chez
un tiers.

Deux tentatives par hôte : /favicon.ico, puis les <link rel="icon"> de la page
d'accueil (le plus grand format d'abord). Le résultat est décrit dans
icons/index.json, que la page consulte pour connaître le nom de fichier exact.

Révision du 24/08/2026, trois corrections :

0. ÉCRITURE ATOMIQUE, et c'était le vrai bogue. Le veilleur tourne sous le compte de l utilisateur
   (crontab utilisateur) tandis qu'un lancement à la main se fait en root :
   le dossier appartenait à root, si bien que ce compte pouvait réécrire les icônes
   existantes mais jamais en CRÉER une. Tout raccourci ajouté après coup
   échouait donc en PermissionError, toutes les 5 minutes, pendant qu'un
   lancement en root réussissait sans rien laisser voir. Cf. `ecrit()`.

1. REDIMENSIONNEMENT. anime-sama.to déclare son apple-touch-icon en 180x180
   mais sert un PNG de 1718x1536 pesant 382 Ko, affiché dans une tuile de
   52 px : à lui seul, 80 % du poids de toutes les icônes. L'attribut `sizes`
   n'étant donc pas fiable, on mesure l'image réelle et on la ramène à 128 px.

2. PURGE NON DESTRUCTIVE. Le nettoyage gardait `index.values()`, c'est-à-dire
   les seules réussites DU PASSAGE EN COURS : un site momentanément
   injoignable — Cloudflare sert parfois une page de défi — faisait effacer
   une icône parfaitement valide obtenue la veille. Désormais on ne supprime
   que ce qui ne correspond plus à aucun raccourci, et l'index précédent sert
   de base, si bien qu'un échec passager ne retire jamais un acquis.

Usage : favicons.py [-v]     (cron quotidien, et à la main après un ajout)
"""
import fcntl
import io
import json
import os
import re
import subprocess
import sys
from urllib.parse import urljoin, urlparse

SRC = "/volume1/docker/homelab/www/data/shortcuts.json"
# ⚠️ Sous-dossier DÉDIÉ. La première version écrivait dans www/icons/, qui
# contient aussi les logos des cartes : le nettoyage de fin les a tous
# supprimés le 22/08 (restaurés depuis restic). Le script ne doit posséder que
# ce qu'il a écrit lui-même.
DEST = "/volume1/docker/homelab/www/icons/sites"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0.0.0 Safari/537.36")
BAVARD = "-v" in sys.argv

# Côté maximal conservé. La tuile fait 52 px ; 128 px couvre les écrans à
# 2x avec de la marge, et tient en quelques kilo-octets.
CIBLE = 128
# En dessous de cette taille on ne retouche rien, même si l'image dépasse un
# peu CIBLE : recompresser un .ico de 6 Ko n'apporterait rien.
SEUIL_OCTETS = 16 * 1024

# On identifie le format par ses octets de tête : l'extension annoncée par le
# site est souvent fausse (un .ico qui est un PNG, par exemple).
SIGNATURES = [
    (b"\x00\x00\x01\x00", "ico"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"GIF8", "gif"),
    (b"\xff\xd8\xff", "jpg"),
]


def dit(*a):
    if BAVARD:
        print(*a)


def ecrit(chemin, data, mode=0o644):
    """Écriture atomique : fichier temporaire, puis `os.replace`.

    Le cron du veilleur tourne sous le compte de l utilisateur alors qu'un lancement à la main se
    fait en root : les fichiers finissent avec des propriétaires mêlés, et un
    simple open(…, "wb") sur un fichier appartenant à l'autre échoue en
    PermissionError. C'est exactement ce qui s'est produit le 23/08 : toute
    nouvelle icône était refusée, toutes les 5 minutes, pendant qu'un
    lancement en root réussissait sans rien montrer d'anormal.

    `os.replace` ne réclame que le droit d'écriture sur le DOSSIER, jamais sur
    le fichier visé : il fonctionne donc dans les deux sens. Effet de bord
    bienvenu, nginx ne peut plus servir un fichier à moitié écrit."""
    tmp = chemin + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    # Le umask de root donne 600 : nginx ne pourrait pas les servir.
    os.chmod(tmp, mode)
    os.replace(tmp, chemin)


def recupere(url):
    """⚠️ L ADRESSE VIENT D UN FICHIER QUE LA PAGE ECRIT (08/10/2026) : http(s)
    seulement, y compris apres une redirection, sans quoi `file://` ou
    `gopher://` faisaient lire au script ce qu il ne doit pas ; et taille
    bornee, la reponse passant entiere en memoire sur un NAS qui n en a pas."""
    try:
        r = subprocess.run(["curl", "-sL", "--max-time", "10", "--proto", "=http,https",
                            "--proto-redir", "=http,https", "--max-filesize", "2000000",
                            "-A", UA, url],
                           capture_output=True, timeout=25)
        return r.stdout if r.returncode == 0 else b""
    except Exception:
        return b""


def format_de(data):
    if len(data) < 64:
        return None
    for sig, ext in SIGNATURES:
        if data.startswith(sig):
            return ext
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    tete = data[:300].lstrip().lower()
    if tete.startswith(b"<svg") or (tete.startswith(b"<?xml") and b"<svg" in data[:600].lower()):
        return "svg"
    return None


def redimensionne(data, ext):
    """Ramène l'icône à CIBLE px si l'image RÉELLE est plus grande.

    On mesure au lieu de croire la page : anime-sama.to annonce 180x180 et
    sert du 1718x1536. Un vectoriel est laissé tel quel, il est déjà léger et
    se redimensionne à l'affichage. En cas de souci, on garde l'original
    plutôt que de perdre l'icône."""
    if ext == "svg" or len(data) <= SEUIL_OCTETS:
        return data, ext
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data))
        avant = im.size
        if max(avant) <= CIBLE:
            return data, ext
        try:
            filtre = Image.Resampling.LANCZOS      # Pillow >= 9.1
        except AttributeError:
            filtre = Image.LANCZOS                 # versions antérieures
        im = im.convert("RGBA")
        im.thumbnail((CIBLE, CIBLE), filtre)
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True)
        sortie = buf.getvalue()
        if len(sortie) >= len(data):               # recompresser n'a rien gagné
            return data, ext
        dit("   redimensionnée %dx%d (%d Ko) -> %dx%d (%d Ko)"
            % (avant[0], avant[1], len(data) // 1024,
               im.size[0], im.size[1], len(sortie) // 1024))
        return sortie, "png"
    except Exception as e:
        dit("   redimensionnement impossible (%s), original conservé" % e)
        return data, ext


def declarees(html, base):
    """URLs des <link rel=...icon...>, du plus grand format au plus petit.

    L'ordre reste « le plus grand d'abord » : c'est celui qui donne la
    meilleure qualité, et le redimensionnement se charge du poids."""
    trouves = []
    for m in re.finditer(r"<link[^>]+>", html, re.I):
        balise = m.group(0)
        if not re.search(r'rel\s*=\s*["\']?[^"\'>]*icon', balise, re.I):
            continue
        href = re.search(r'href\s*=\s*["\']([^"\']+)', balise, re.I)
        if not href:
            continue
        taille = re.search(r'sizes\s*=\s*["\']?(\d+)', balise, re.I)
        trouves.append((int(taille.group(1)) if taille else 0, urljoin(base, href.group(1))))
    trouves.sort(key=lambda x: -x[0])
    return [u for _, u in trouves]


def icone_de(hotes):
    """`hotes` : le domaine du raccourci, puis sa variante avec ou sans www.

    La page identifie un raccourci par son domaine SANS `www.` : elle demandait
    donc linkedin.com/favicon.ico, qui ne répond pas, là où www.linkedin.com
    répond très bien. On essaie les deux."""
    for hote in hotes:
        racine = "https://" + hote + "/"
        data = recupere(racine + "favicon.ico")
        ext = format_de(data)
        if ext:
            dit("   %s/favicon.ico -> %s, %d octets" % (hote, ext, len(data)))
            return redimensionne(data, ext)
        html = recupere(racine).decode("utf-8", "replace")
        for url in declarees(html, racine)[:4]:
            data = recupere(url)
            ext = format_de(data)
            if ext:
                dit("   %s -> %s, %d octets" % (url, ext, len(data)))
                return redimensionne(data, ext)
    return None, None


def main():
    # ⚠️ UN SEUL PASSAGE A LA FOIS. Le veilleur inotify, le cron de chaque minute
    # et celui de 4 h 30 peuvent se chevaucher, et partagent les fichiers `.tmp`.
    # Le verrou est pris sur le script lui-meme : lisible par les deux comptes
    # qui le lancent (l utilisateur et root), sans fichier de verrou a creer.
    verrou = open(os.path.abspath(__file__), "rb")
    try:
        fcntl.flock(verrou, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        dit("un autre passage est en cours")
        return 0
    try:
        raccourcis = json.load(open(SRC, encoding="utf-8"))
    except Exception as e:
        print("shortcuts.json illisible :", e)
        return 1

    os.makedirs(DEST, exist_ok=True)
    idx = os.path.join(DEST, "index.json")
    # La clé est le domaine tel que la page le calcule (sans `www.`) ; le
    # téléchargement, lui, essaie aussi le domaine complet.
    hotes = []
    for s in raccourcis:
        h = urlparse(s.get("url", "")).hostname
        if not h:
            continue
        cle = re.sub(r"^www\.", "", h)
        variantes = [h] + ([cle] if cle != h else ["www." + h])
        if cle not in [c for c, _ in hotes]:
            hotes.append((cle, variantes))
    cles = set(c for c, _ in hotes)

    # On repart de l'index précédent, restreint aux raccourcis encore présents :
    # une icône déjà obtenue continue d'être servie même si le site est
    # aujourd'hui injoignable. Sans ça, un échec passager la faisait disparaître.
    try:
        ancien = json.load(open(idx, encoding="utf-8"))
    except Exception:
        ancien = {}
    index = {k: v for k, v in ancien.items() if k in cles
             and os.path.exists(os.path.join(DEST, v))}
    repris = set(index)

    echecs = []
    for cle, variantes in hotes:
        dit(cle)
        data, ext = icone_de(variantes)
        if not data:
            echecs.append(cle)
            continue
        nom = "%s.%s" % (cle, ext)
        ecrit(os.path.join(DEST, nom), data)
        index[cle] = nom
        repris.discard(cle)

    # Les icônes des raccourcis supprimés n'ont plus lieu d'encombrer le dossier.
    # On se fie au NOM D'HÔTE et non aux réussites du passage : un site en panne
    # ne doit pas coûter son icône. Ceinture et bretelles : si DEST venait à
    # pointer ailleurs, on ne purge rien.
    if os.path.basename(DEST.rstrip("/")) != "sites":
        print("DEST inattendu (%s) : nettoyage annulé" % DEST)
        return 1
    gardes = set(index.values()) | {"index.json"}
    retires = []
    for f in os.listdir(DEST):
        if f in gardes:
            continue
        base = f.rsplit(".", 1)[0]
        # Un fichier au nom d'un hôte connu mais absent de l'index trahit un
        # index perdu : on le garde. En revanche si l'hôte EST dans l'index
        # sous un autre nom, c'est un doublon d'extension, il part.
        if base in cles and base not in index:
            continue
        os.remove(os.path.join(DEST, f))
        retires.append(f)

    ecrit(idx, json.dumps(index, ensure_ascii=False, indent=1).encode("utf-8"))
    # Le dossier doit rester traversable par nginx. On n'échoue pas si le
    # chmod est refusé : un dossier appartenant à l'autre compte est déjà en
    # 755, et l'écriture, elle, passe désormais par `os.replace`.
    try:
        os.chmod(DEST, 0o755)
    except OSError:
        pass

    print("%d icônes récupérées sur %d hôtes" % (len(index), len(hotes)))
    if repris:
        print("conservées d'un passage précédent : " + ", ".join(sorted(repris)))
    if echecs:
        print("sans icône (les initiales resteront) : " + ", ".join(echecs))
    if retires and BAVARD:
        dit("supprimées (raccourci disparu) : " + ", ".join(retires))
    return 0


sys.exit(main())
