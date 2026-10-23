#!/usr/bin/env python3
"""Rapatrie sur le NAS les favicons des raccourcis (22/08/2026).

Les icônes étaient chargées depuis les sites eux-mêmes, ce qui produit des
requêtes tierces : le bouclier de Brave en bloque une partie
(ERR_BLOCKED_BY_CLIENT) et certains domaines les refusent carrément
(ERR_BLOCKED_BY_RESPONSE.NotSameSite). Servies depuis le NAS, elles n'ont plus
aucune raison d'être bloquées, et la liste des sites visités ne part plus chez
un tiers.

Le résultat est décrit dans icons/sites/index.json, que la page consulte pour
connaître le nom de fichier exact.

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

Révision du 23/10/2026 : LA MEILLEURE ICÔNE, ET NON LA PREMIÈRE. Le script
prenait /favicon.ico dès qu'il répondait, et ne lisait la page qu'à défaut :
neuf icônes sur quatorze faisaient 16 à 48 px, floues dans la tuile (28 px,
soit 56 à 84 px réels sur un écran 2x ou 3x). RSI servait un carré gris de
16 px alors que son site déclare un logo transparent de 180 px. Désormais :
- on recense TOUT ce que le site propose (`candidates`) : les <link> de la
  page, son manifeste, et les adresses d'usage (/apple-touch-icon.png,
  /favicon.ico), et on mesure chaque image ;
- un SVG l'emporte, puis une image transparente d'au moins `NET` px, puis la
  plus grande (`choisit`) ;
- une icône à FOND PLEIN (les icônes d'application en ont un : carré violet
  de Twitch, blanc de la Bbox) est DÉTOURÉE, son fond retiré, sinon arrondie
  (`normalise`) ; dans la tuile de verre, un carré plein jurait ;
- chaque logo prend la même SURFACE dans la tuile, un logo large jusqu'à 40 px
  de large (`gabarit`) : RSI, 2,4 fois plus large que haut, n'y faisait que
  28 x 12 px ;
- une image ressort en trois PNG (`DENSITES`), chacun à la taille EXACTE où
  il s'affiche (PC, écran 2x, iPhone 3x) : c'était le navigateur qui
  floutait, en réduisant d'un coup une image de 128 px à 28. Un SVG reste
  tel quel. L'index donne, par site, le fichier, sa taille d'affichage et
  ses versions 2x et 3x.
Vectoriser les images n'aurait rien rendu : un tracé devine des formes à
partir des pixels, il perd les dégradés et les détails sans en ajouter.

Une IMAGE IMPORTÉE à la main dans la fenêtre d'un raccourci (champ `image` de
shortcuts.json) passe avant l'icône du site, avec le même traitement, dans
des fichiers à part : l'index la range sous `m`, et l'icône du site reste
prête pour quand on la retire (`icone_importee`).

Usage : favicons.py [-v]     (cron quotidien, et à la main après un ajout)
"""
import base64
import fcntl
import io
import json
import os
import re
import subprocess
import sys
from urllib.parse import urljoin, urlparse

# Les deux chemins se changent par l'environnement pour la DÉMO PUBLIQUE : sa
# publication (.github/workflows/pages.yml) fabrique ainsi les icônes de ses
# raccourcis, sans qu'aucune ne soit versionnée (23/10/2026).
SRC = os.environ.get("FAVICONS_SRC", "/volume1/docker/homelab/www/data/shortcuts.json")
# ⚠️ Sous-dossier DÉDIÉ. La première version écrivait dans www/icons/, qui
# contient aussi les logos des cartes : le nettoyage de fin les a tous
# supprimés le 22/08 (restaurés depuis restic). Le script ne doit posséder que
# ce qu'il a écrit lui-même.
DEST = os.environ.get("FAVICONS_DEST", "/volume1/docker/homelab/www/icons/sites")
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0.0.0 Safari/537.36")
BAVARD = "-v" in sys.argv

# La tuile (52 px) montre l'icône dans un carré de `COTE` px CSS ; un logo
# large y prend la même surface, jusqu'à `LARGE` px de large (`gabarit`).
COTE = 28
LARGE = 40
# Une image par densité d'écran, à sa taille exacte : 1 pour le PC, 2 pour
# un écran 2x, 3 pour l'iPhone. Le navigateur choisit (`srcset`, app.js).
DENSITES = (1, 2, 3)
# Taille de travail : le détourage parcourt les pixels un à un.
TRAVAIL = 384
# Une image transparente de ce côté au moins reste nette dans la tuile ; en
# dessous, on lui préfère une plus grande, même à fond plein (détourée).
NET = 64
# Mais un logo sans fond de ce côté au moins passe avant une icône à fond
# coloré (`choisit`) : net sur un PC, où la tuile l'affiche en 28 px.
PETIT = 32
# Inutile de chercher plus grand : la plus grande version écrite (3x, 40 px
# de large) en fait 120.
ASSEZ = 3 * LARGE
# Images téléchargées au plus par site : la page en déclare parfois quinze.
ESSAIS = 8
# Écart (par canal, sur 255) sous lequel un pixel est de la couleur du fond.
PROCHE = 20
# Un fond plus coloré que ça (écart entre canaux) fait partie de la marque :
# le carré bleu de Facebook, violet de Twitch. On le garde, arrondi.
TEINTE = 40
# La tuile de verre, sombre, et le contraste (WCAG) qu'un logo détouré doit
# garder avec elle : un logo foncé sur fond blanc (Wikipédia, ameli) y
# disparaissait ; il garde alors son fond blanc.
TUILE = (44, 50, 64)
CONTRASTE = 2.0

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
    """Le contenu, et l'adresse où il a été trouvé après les redirections :
    c'est elle qui sert de base aux liens relatifs (ovh.com renvoie sur
    ovhcloud.com, dont la page déclare `icon.svg`).

    ⚠️ L ADRESSE VIENT D UN FICHIER QUE LA PAGE ECRIT (08/10/2026) : http(s)
    seulement, y compris apres une redirection, sans quoi `file://` ou
    `gopher://` faisaient lire au script ce qu il ne doit pas ; et taille
    bornee, la reponse passant entiere en memoire sur un NAS qui n en a pas.
    `--compressed` : la Bbox sert son manifeste compressé même sans qu'on le
    demande."""
    try:
        r = subprocess.run(["curl", "-sL", "--compressed", "--max-time", "10",
                            "--proto", "=http,https", "--proto-redir", "=http,https",
                            "--max-filesize", "2000000", "-A", UA,
                            "-w", "%{stderr}%{url_effective}", url],
                           capture_output=True, timeout=25)
        if r.returncode != 0:
            return b"", url
        return r.stdout, r.stderr.decode("utf-8", "replace").strip() or url
    except Exception:
        return b"", url


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


def taille_declaree(texte, url):
    """Le plus grand côté annoncé (`sizes="180x180"`, ou plusieurs) ; un SVG
    passe devant tout. Ce n'est qu'un ORDRE d'essai : la taille retenue est
    toujours mesurée sur l'image (cf. anime-sama, plus haut)."""
    if "svg" in texte.lower() or urlparse(url).path.lower().endswith(".svg"):
        return 10 ** 6
    tailles = [int(x) for x in re.findall(r"(\d+)\s*x\s*\d+", texte or "")]
    return max(tailles) if tailles else 0


def attribut(balise, nom):
    """La valeur d'un attribut HTML, entre guillemets doubles, simples, ou SANS
    guillemets : kubernetes.io écrit `href=/icons/favicon-64.png`, et seuls
    les guillemets étaient lus, si bien que ses icônes (jusqu'à 256 px)
    passaient inaperçues (23/10/2026). None s'il manque."""
    m = re.search(r'(?<![\w-])%s\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s"\'>]+))' % nom, balise, re.I)
    return next((g for g in m.groups() if g is not None), None) if m else None


def candidates(hote):
    """Les adresses de toutes les icônes que le site propose, dans l'ordre où
    les essayer : celles de la page et du manifeste, de la plus grande annoncée
    à la plus petite, puis les adresses d'usage que beaucoup de sites servent
    sans les déclarer (Twitch : /apple-touch-icon.png, 180 px), et enfin les
    icônes `maskable` du manifeste (fond plein et larges marges, faites pour
    être rognées par le téléphone)."""
    racine = "https://" + hote + "/"
    html, base = recupere(racine)
    html = html.decode("utf-8", "replace")
    liens, masques, manifestes = [], [], []
    for m in re.finditer(r"<link[^>]+>", html, re.I):
        balise = m.group(0)
        rel, href = attribut(balise, "rel"), attribut(balise, "href")
        if not rel or not href:
            continue
        rel, url = rel.lower(), urljoin(base, href.replace("&amp;", "&"))
        if "manifest" in rel:
            manifestes.append(url)
        # `mask-icon` : la silhouette d'onglet épinglé de Safari, d'une seule couleur
        elif "icon" in rel and "mask" not in rel:
            liens.append((taille_declaree(balise, url), url))
    for adresse in manifestes[:1] + [racine + "manifest.json", racine + "site.webmanifest"]:
        data, base_m = recupere(adresse)
        try:
            icones = json.loads(data.decode("utf-8", "replace")).get("icons", [])
        except Exception:
            continue
        for ic in icones if isinstance(icones, list) else []:
            src = isinstance(ic, dict) and ic.get("src")
            if not isinstance(src, str):
                continue
            url, buts = urljoin(base_m, src), str(ic.get("purpose", "any")).split()
            if "any" in buts:
                liens.append((taille_declaree(str(ic.get("sizes", "")) + str(ic.get("type", "")), url), url))
            # `monochrome` : une silhouette d'une seule couleur, comme `mask-icon`
            elif "maskable" in buts:
                masques.append(url)
        break
    liens.sort(key=lambda x: -x[0])
    ordre, vus = [], set()
    for url in [u for _, u in liens] + [racine + "apple-touch-icon.png", racine + "favicon.ico"] + masques:
        if url not in vus:
            vus.add(url)
            ordre.append(url)
    return ordre


def examine(data):
    """Ce qu'il faut savoir d'une image pour choisir : son format, son côté
    réel (infini pour un SVG), et si elle a un fond plein (quatre coins
    opaques). None si ce n'est pas une image lisible."""
    ext = format_de(data)
    if not ext:
        return None
    if ext == "svg":
        return {"ext": "svg", "cote": float("inf"), "plein": False, "data": data}
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data))
        # un .ico en contient plusieurs : le plus grand
        if im.format == "ICO":
            im = im.ico.getimage(max(im.ico.sizes()))
        im = im.convert("RGBA")
    except Exception as e:
        dit("      illisible (%s)" % e)
        return None
    w, h = im.size
    coins = [im.getpixel(p)[3] for p in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
    return {"ext": ext, "cote": min(w, h), "plein": min(coins) >= 250, "im": im}


def fond_colore(t):
    """Vrai si l'image a un fond plein, uni et COLORÉ : `normalise` le
    gardera (le carré violet de Twitch), au lieu de le retirer."""
    if not t["plein"]:
        return False
    im = t["im"]
    w, h = im.size
    coins = [im.getpixel(p)[:3] for p in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
    fond = coins[0]
    return (all(max(abs(a - b) for a, b in zip(c, fond)) <= PROCHE for c in coins)
            and max(fond) - min(fond) > TEINTE)


def choisit(trouvees):
    """Un SVG d'abord ; sinon la plus grande image transparente si elle est
    assez nette (`NET`) ; sinon la plus grande de toutes. À égalité, la
    première trouvée, donc la mieux placée par `candidates`.
    ⚠️ SAUF UN FOND COLORÉ (23/10/2026, demande) : si la plus grande est une
    icône d'application à fond coloré, que la tuile montrerait en carré, et
    que le site fournit aussi son logo SANS FOND d'au moins `PETIT` px, c'est
    ce logo : le vrai visage du site (Twitch, son glitch lavande, au lieu du
    carré violet). Un fond blanc ou noir, lui, est retiré (`detoure`) : la
    grande donne alors le même logo sans fond, en plus net."""
    svg = [t for t in trouvees if t["ext"] == "svg"]
    if svg:
        return svg[0]
    nettes = [t for t in trouvees if not t["plein"] and t["cote"] >= NET]
    if nettes:
        return max(nettes, key=lambda t: t["cote"])
    grande = max(trouvees, key=lambda t: t["cote"])
    sans_fond = [t for t in trouvees if not t["plein"] and t["cote"] >= PETIT]
    if fond_colore(grande) and sans_fond:
        return max(sans_fond, key=lambda t: t["cote"])
    return grande


def reduit(im, cote):
    """Ramène l'image à `cote` px au plus, en alpha prémultiplié : sans lui,
    la couleur des pixels transparents (souvent du noir) bave sur les bords."""
    from PIL import Image
    if max(im.size) <= cote:
        return im
    k = cote / max(im.size)
    taille = (max(1, round(im.size[0] * k)), max(1, round(im.size[1] * k)))
    return im.convert("RGBa").resize(taille, Image.Resampling.LANCZOS).convert("RGBA")


def sans_fond(p, fond):
    """Le pixel `p` vu comme un mélange de `fond` et d'une couleur inconnue :
    la plus petite opacité qui l'explique, et cette couleur (la « couleur vers
    transparence » de GIMP). Un bord adouci du logo garde sa nuance au lieu
    d'un liseré de l'ancien fond ; un pixel franc du logo reste opaque."""
    r, g, b, a = p
    al = 0.0
    for c, f in zip((r, g, b), fond):
        if c > f:
            al = max(al, (c - f) / (255 - f))
        elif c < f:
            al = max(al, (f - c) / f)
    if al <= 0.004:
        return (0, 0, 0, 0)
    al = min(1.0, al)
    rgb = tuple(max(0, min(255, round((c - (1 - al) * f) / al))) for c, f in zip((r, g, b), fond))
    return rgb + (round(a * al),)


def lumiere(rgb):
    """Luminance relative (WCAG) d'une couleur."""
    def lin(c):
        c /= 255
        return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb[:3])
    return .2126 * r + .7152 * g + .0722 * b


def detoure(im):
    """Retire un fond UNI et NEUTRE (blanc, noir, gris) : les pixels de la
    couleur des quatre coins reliés au bord deviennent transparents, et leurs
    deux rangs de voisins sont démêlés (`sans_fond`). Ce qui est enclos dans le
    logo garde sa couleur. Puis l'image est rognée au logo : les icônes
    d'application l'entourent de marges.
    None (et `arrondit` reprend l'image intacte, d'où la copie) si le fond
    n'est pas uni, s'il est coloré (`TEINTE`), s'il ne reste rien, ou si le
    logo restant serait illisible sur la tuile (`CONTRASTE`)."""
    im = im.copy()
    w, h = im.size
    px = im.load()
    coins = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    fond = coins[0][:3]

    def ecart(p):
        return max(abs(p[0] - fond[0]), abs(p[1] - fond[1]), abs(p[2] - fond[2]))

    if any(ecart(c) > PROCHE for c in coins) or max(fond) - min(fond) > TEINTE:
        return None
    vide = bytearray(w * h)
    bord = set()
    pile = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    while pile:
        x, y = pile.pop()
        if vide[y * w + x]:
            continue
        if ecart(px[x, y]) > PROCHE:
            bord.add((x, y))
            continue
        vide[y * w + x] = 1
        px[x, y] = (0, 0, 0, 0)
        for v in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= v[0] < w and 0 <= v[1] < h:
                pile.append(v)
    # le second rang : l'adoucissement d'un logo agrandi s'étale sur deux pixels
    second = set()
    for x, y in bord:
        for v in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= v[0] < w and 0 <= v[1] < h and not vide[v[1] * w + v[0]] and v not in bord:
                second.add(v)
    for x, y in bord | second:
        px[x, y] = sans_fond(px[x, y], fond)
    boite = im.getchannel("A").getbbox()
    if not boite:
        return None
    # La part du logo (pondérée par l'opacité) trop peu contrastée avec la
    # tuile : au-delà de la moitié, il y serait illisible. Pas une moyenne :
    # les blancs enclos du logo d'ameli la tiraient vers le clair. Un logo a
    # peu de couleurs : chacune n'est jugée qu'une fois.
    T = lumiere(TUILE)
    poids = terne = 0.0
    vues = {}
    for y in range(boite[1], boite[3]):
        for x in range(boite[0], boite[2]):
            p = px[x, y]
            if p[3]:
                if p[:3] not in vues:
                    L = lumiere(p)
                    vues[p[:3]] = (max(L, T) + .05) / (min(L, T) + .05) < CONTRASTE
                poids += p[3]
                terne += p[3] * vues[p[:3]]
    if terne > poids / 2:
        return None
    return im.crop(boite)


def arrondit(im):
    """Un fond plein mais pas uni (dégradé, photo) : coins arrondis, comme une
    icône d'application, plutôt qu'un carré dur dans la tuile."""
    from PIL import Image, ImageChops, ImageDraw
    w, h = im.size
    masque = Image.new("L", (w * 4, h * 4), 0)
    ImageDraw.Draw(masque).rounded_rectangle((0, 0, w * 4 - 1, h * 4 - 1),
                                             radius=round(min(w, h) * 4 * .22), fill=255)
    masque = masque.resize((w, h), Image.Resampling.LANCZOS)
    im.putalpha(ImageChops.multiply(im.getchannel("A"), masque))
    return im


def gabarit(w, h):
    """La taille d'affichage, en px CSS entiers, d'un logo de w x h : la
    surface d'un carré de `COTE`, sans dépasser `COTE` de haut ni `LARGE` de
    large. Un carré garde ses 28 x 28 ; RSI (2,4 fois plus large que haut)
    passe de 28 x 12 à 40 x 17."""
    a = w / h
    l, H = COTE * a ** .5, COTE / a ** .5
    if H > COTE:
        l, H = COTE * a, COTE
    if l > LARGE:
        l, H = LARGE, LARGE / a
    return max(1, round(l)), max(1, round(H))


def pair(n):
    """`n` arrondi au pair supérieur. La tuile fait 52 px : un logo de taille
    impaire, centré, y tombait ENTRE deux pixels (RSI à 17,5 px du haut,
    YouTube à 9,5 du bord), et le navigateur l'étalait sur deux rangées de
    pixels, ce qui le floutait."""
    return n + n % 2


def proportions_svg(data):
    """Largeur et hauteur d'un SVG : son `viewBox`, sinon ses attributs
    `width` et `height`, carré à défaut. Un SVG ne se rogne pas (il faudrait
    le dessiner) : ses marges restent les siennes."""
    m = re.search(r"<svg[^>]*>", data[:3000].decode("utf-8", "replace"), re.I)
    balise = m.group(0) if m else ""
    vb = re.search(r'viewBox\s*=\s*["\']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)', balise, re.I)
    if vb:
        w, h = float(vb.group(1)), float(vb.group(2))
    else:
        # `\s` devant : `stroke-width` n'est pas une largeur
        w = re.search(r'\swidth\s*=\s*["\']\s*([\d.]+)\s*(?:px)?\s*["\']', balise)
        h = re.search(r'\sheight\s*=\s*["\']\s*([\d.]+)\s*(?:px)?\s*["\']', balise)
        w, h = (float(w.group(1)), float(h.group(1))) if w and h else (1, 1)
    return (w, h) if w > 0 and h > 0 else (1, 1)


def normalise(t, cle):
    """L'icône retenue, prête pour la tuile : les fichiers à écrire, et son
    entrée dans l'index (`f` le fichier, `l` x `h` sa taille d'affichage en px
    CSS, `x` ses versions 2x et 3x).
    - Un SVG tel quel, à la taille que donnent ses proportions.
    - Une image ramenée à `TRAVAIL` px, détourée ou arrondie si elle a un fond
      plein, ROGNÉE à son contenu (des marges vides faisaient paraître un logo
      plus petit que son voisin), puis écrite à la taille EXACTE de chaque
      densité d'écran : réduite si la source est plus grande, agrandie
      (bicubique, sans les franges de Lanczos) si elle est plus petite.
    La place réservée a toujours des côtés PAIRS (`pair`) : un logo impair y
    est posé avec un pixel de marge."""
    if t["ext"] == "svg":
        l, h = gabarit(*proportions_svg(t["data"]))
        return [(cle + ".svg", t["data"])], {"f": cle + ".svg", "l": pair(l), "h": pair(h)}
    from PIL import Image
    im = reduit(t["im"], TRAVAIL)
    if t["plein"]:
        im = detoure(im) or arrondit(im)
    # le contenu : ce qui n'est pas presque transparent (une lueur à 3 %
    # n'élargit pas le logo)
    boite = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    if boite:
        im = im.crop(boite)
    l, h = gabarit(*im.size)
    L, H = pair(l), pair(h)
    fichiers = []
    for k in DENSITES:
        nom = cle + (".png" if k == 1 else "@%dx.png" % k)
        filtre = Image.Resampling.LANCZOS if im.size[0] >= l * k else Image.Resampling.BICUBIC
        logo = im.convert("RGBa").resize((l * k, h * k), filtre).convert("RGBA")
        toile = Image.new("RGBA", (L * k, H * k), (0, 0, 0, 0))
        toile.paste(logo, ((L - l) * k // 2, (H - h) * k // 2))
        buf = io.BytesIO()
        toile.save(buf, "PNG", optimize=True)
        fichiers.append((nom, buf.getvalue()))
    return fichiers, {"f": fichiers[0][0], "l": L, "h": H, "x": [n for n, _ in fichiers[1:]]}


def icone_de(cle, hotes):
    """`hotes` : le domaine du raccourci, puis sa variante avec ou sans www.
    Rend les fichiers de l'icône et son entrée d'index (`normalise`).

    La page identifie un raccourci par son domaine SANS `www.` : elle demandait
    donc linkedin.com/favicon.ico, qui ne répond pas, là où www.linkedin.com
    répond très bien. On essaie les deux.

    On s'arrête avant `ESSAIS` dès qu'on tient le meilleur possible : un SVG,
    ou une image transparente d'au moins `ASSEZ` px."""
    for hote in hotes:
        trouvees = []
        for url in candidates(hote)[:ESSAIS]:
            t = examine(recupere(url)[0])
            if not t:
                continue
            dit("   %-5s %-4s %s%s" % (t["ext"], "svg" if t["ext"] == "svg" else t["cote"], url[:100],
                                       "  (fond plein)" if t["plein"] else ""))
            trouvees.append(t)
            if t["ext"] == "svg" or (not t["plein"] and t["cote"] >= ASSEZ):
                break
        if trouvees:
            t = choisit(trouvees)
            try:
                return normalise(t, cle)
            except Exception as e:
                dit("   mise en forme impossible (%s)" % e)
    return None, None


def fichiers_de(v):
    """Les fichiers d'une entrée de l'index : un nom seul (index d'avant le
    23/10/2026), ou l'image et ses versions 2x et 3x, et celles de l'image
    importée à la main (`m`). Vide si l'entrée est illisible : elle sera
    refaite."""
    if isinstance(v, str):
        return [v]
    fichiers = []
    for e in (v, v.get("m")) if isinstance(v, dict) else ():
        if isinstance(e, dict) and isinstance(e.get("f"), str):
            fichiers += [e["f"]] + [x for x in e.get("x", []) if isinstance(x, str)]
    return fichiers


# L'image importée dans la fenêtre d'un raccourci : une adresse `data:` que la
# page a déjà ramenée à 256 px en PNG (`imageImportee`, app.js). Jamais de SVG,
# qui peut porter du script.
IMPORTEE = re.compile(r"data:image/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$")


def empreinte(texte):
    """Empreinte courte (djb2, 32 bits) de l'image importée, calculée de la
    même façon par la page (`empreinteImage`, app.js) : elle sait ainsi si l'icône
    traitée correspond encore à l'image du raccourci, ou à une précédente."""
    h = 5381
    for c in texte:
        h = (h * 33 + ord(c)) & 0xFFFFFFFF
    return "%08x" % h


def icone_importee(cle, texte):
    """L'image importée à la main, traitée comme une icône trouvée sur le
    site : mêmes tailles exactes, même rognage, même fond retiré ou arrondi.
    Dans des fichiers À PART (`<site>.perso.png`) : l'icône du site reste, et
    la page y revient aussitôt quand on retire l'image (23/10/2026)."""
    m = IMPORTEE.match(texte.strip()) if isinstance(texte, str) else None
    if not m:
        return None, None
    try:
        t = examine(base64.b64decode(m.group(2)))
    except Exception:
        return None, None
    if not t or t["ext"] == "svg":
        return None, None
    fichiers, entree = normalise(t, cle + ".perso")
    entree["v"] = empreinte(texte.strip())
    return fichiers, entree


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
    images = {}
    for s in raccourcis:
        h = urlparse(s.get("url", "")).hostname
        if not h:
            continue
        cle = re.sub(r"^www\.", "", h)
        variantes = [h] + ([cle] if cle != h else ["www." + h])
        if cle not in [c for c, _ in hotes]:
            hotes.append((cle, variantes))
        # l'image importée : la première, si deux raccourcis du site en ont une
        if isinstance(s.get("image"), str) and cle not in images:
            images[cle] = s["image"]
    cles = set(c for c, _ in hotes)

    # On repart de l'index précédent, restreint aux raccourcis encore présents :
    # une icône déjà obtenue continue d'être servie même si le site est
    # aujourd'hui injoignable. Sans ça, un échec passager la faisait disparaître.
    try:
        ancien = json.load(open(idx, encoding="utf-8"))
    except Exception:
        ancien = {}
    index = {k: v for k, v in ancien.items() if k in cles and fichiers_de(v)
             and all(os.path.exists(os.path.join(DEST, f)) for f in fichiers_de(v))}
    repris = set(index)

    echecs = []
    for cle, variantes in hotes:
        dit(cle)
        # l'icône du site : celle du passage, sinon celle d'un passage précédent
        precedente = index.get(cle)
        entree = ({k: v for k, v in precedente.items() if k != "m"} if isinstance(precedente, dict)
                  else {"f": precedente} if isinstance(precedente, str) else {})
        fichiers, auto = icone_de(cle, variantes)
        if fichiers:
            # les images d'abord, l'index ensuite : la page ne voit jamais une
            # entrée dont un fichier manque
            for nom, data in fichiers:
                ecrit(os.path.join(DEST, nom), data)
            entree = auto
            repris.discard(cle)
        else:
            echecs.append(cle)
        # l'image importée à la main, à côté (`m`) : la page la préfère
        if cle in images:
            fichiers, m = icone_importee(cle, images[cle])
            if fichiers:
                for nom, data in fichiers:
                    ecrit(os.path.join(DEST, nom), data)
                entree["m"] = m
                dit("   image importée, %d x %d" % (m["l"], m["h"]))
            else:
                print("image importée illisible, ignorée : " + cle)
        if fichiers_de(entree):
            index[cle] = entree
        else:
            index.pop(cle, None)

    # Les icônes des raccourcis supprimés n'ont plus lieu d'encombrer le dossier.
    # On se fie au NOM D'HÔTE et non aux réussites du passage : un site en panne
    # ne doit pas coûter son icône. Ceinture et bretelles : si DEST venait à
    # pointer ailleurs, on ne purge rien.
    if os.path.basename(DEST.rstrip("/")) != "sites":
        print("DEST inattendu (%s) : nettoyage annulé" % DEST)
        return 1
    gardes = {f for v in index.values() for f in fichiers_de(v)} | {"index.json"}
    retires = []
    for f in os.listdir(DEST):
        if f in gardes:
            continue
        # `site.com@2x.png` est encore une icône de `site.com`
        base = re.sub(r"@\dx$", "", f.rsplit(".", 1)[0])
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
