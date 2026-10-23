/* Generateur des fixtures d historique du tableau de bord.
 *
 *   node outils/genere-fixtures.js
 *
 * POURQUOI UN GENERATEUR ET NON DES FICHIERS ECRITS A LA MAIN : il faut 1440
 * points a la minute, 145 au pas de dix minutes et 169 a l heure, sur vingt-
 * quatre colonnes. Ecrits a la main ils seraient plats, et une courbe plate fait
 * passer tout le tableau de bord pour une maquette morte.
 *
 * ⚠️ TIRAGE DETERMINISTE. La meme graine rend exactement les memes courbes :
 * regenerer ne fait pas bouger la demonstration, les captures restent valables,
 * et une difference dans un fichier signale un vrai changement de code.
 *
 * ⚠️ LES HORODATAGES SONT ABSOLUS ICI, et c est assume : la page les REBASE a
 * l affichage, en decalant toute la serie pour que son dernier point tombe sur
 * maintenant. Sans ca, une demo publiee en mars afficherait six mois plus tard
 * des courbes vieilles d autant, avec une echelle horaire fausse.
 */

"use strict";
const fs = require("fs");
const path = require("path");

/* ⚠️ LA SORTIE VA DANS `www/`, PAS DANS `fixtures/`. C est `www/` que servent
   aussi bien Node en local que GitHub Pages, et aucun des deux ne sait
   reecrire une URL : les fichiers doivent donc porter les noms que la page
   demande. `fixtures/` ne garde que les sources ECRITES A LA MAIN, base.json
   et les calques, que ce script recopie au bon endroit. */
const SRC = path.join(__dirname, "..", "fixtures");
const OUT = path.join(__dirname, "..", "www");
const ecrit = (nom, obj) => {
  const p = path.join(OUT, nom);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj));
  console.log("  " + nom.padEnd(26) + String(fs.statSync(p).size).padStart(8) + " o");
};
const copie = (de, vers) => {
  const p = path.join(OUT, vers);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.copyFileSync(path.join(SRC, de), p);
  console.log("  " + vers.padEnd(26) + String(fs.statSync(p).size).padStart(8) + " o   <- " + de);
};

/* ---- hasard reproductible (mulberry32) --------------------------------- */
function graine(n) {
  let a = n >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = graine(20260901);
const bruit = (a) => (R() - 0.5) * 2 * a;
const borne = (v, min, max) => Math.max(min, Math.min(max, v));
const arr2 = (v) => Math.round(v * 100) / 100;

/* Rythme d une journee : creux vers 4 h, pic vers 21 h. C est ce qui donne aux
   courbes une allure de machine reellement utilisee plutot que de bruit blanc. */
function rythme(t) {
  const d = new Date(t * 1000);
  const h = d.getHours() + d.getMinutes() / 60;
  return 0.32 + 0.68 * (0.5 - 0.5 * Math.cos(((h - 4) / 24) * 2 * Math.PI));
}

/* Rafale : la plupart du temps rien, parfois beaucoup. Un debit reseau moyenne
   en permanence ne ressemble a rien de reel. */
function rafale(r, plafond) {
  if (R() > 0.12 + 0.25 * r) return Math.round(R() * plafond * 0.02);
  return Math.round(plafond * (0.25 + R() * 0.75) * r);
}

/* Second tirage, reserve aux colonnes ajoutees le 05/10/2026 : le debit
   Internet de la box. ⚠️ UN GENERATEUR A PART. Puiser dans `R` decalerait toute
   la suite et redessinerait chaque courbe existante, ce qui ferait passer un
   simple ajout pour un changement de tout le tableau de bord. */
const R2 = graine(20261005);
function debitBox(r, plafond) {
  if (R2() > 0.18 + 0.3 * r) return Math.round(plafond * 0.01 * (0.5 + R2()));
  return Math.round(plafond * (0.15 + R2() * 0.85) * r * r);
}

const MIN = 60;
const N_MIN = 1440;                                   // 24 h a la minute
const FIN = Math.floor(Date.now() / 1000 / MIN) * MIN;  // maintenant, en SECONDES
const DEBUT = FIN - (N_MIN - 1) * MIN;

/* ⚠️ INCIDENTS CORRELES. Une panne reelle se voit sur plusieurs sondes a la
   fois : quand le port du tunnel tombe, la sonde Kuma correspondante tombe
   aussi, avec un peu de retard. Des incidents independants donneraient des
   rubans qui se contredisent, ce qui saute aux yeux. */
const INCIDENTS = [
  { col: "vpnup",  debut: -19.0 * 3600, duree: 35 * 60 },
  { col: "kumaup", debut: -18.9 * 3600, duree: 48 * 60 },
  { col: "vpnup",  debut:  -6.4 * 3600, duree: 11 * 60 },
  { col: "siteup", debut: -11.2 * 3600, duree: 19 * 60 }
];
const enPanne = (col, t) => INCIDENTS.some(i =>
  i.col === col && t >= FIN + i.debut && t < FIN + i.debut + i.duree);

/* ---- une mesure complete pour un instant donne -------------------------- */
function mesure(t) {
  const r = rythme(t);
  const pic = R() < 0.02 ? 35 + R() * 45 : 0;         // bouffee de processeur
  const cpu  = borne(6 + 17 * r + bruit(4) + pic, 1, 99);
  const nv1  = borne(42 + 7 * r + bruit(1.4), 34, 58);

  const siteKo = enPanne("siteup", t);
  return {
    cpu,
    ram:      borne(51 + 7 * r + bruit(1.6), 40, 96),
    disque:   75.7,                                   // = volume de smart.json
    reseau:   rafale(r, 9_500_000),
    charge:   arr2(borne(cpu / 100 * 8 * 0.85 + bruit(0.15), 0.05, 9)),
    temp:     borne(53 + 13 * r + cpu * 0.06 + bruit(1.2), 45, 92),
    lecture:  rafale(r, 42_000_000),
    ecriture: rafale(r, 68_000_000),
    charge5:  arr2(borne(cpu / 100 * 8 * 0.8 + bruit(0.1), 0.05, 8)),
    charge15: arr2(borne(cpu / 100 * 8 * 0.75 + bruit(0.08), 0.05, 7)),
    swap:     borne(16 + 6 * r + bruit(1.1), 8, 78),
    nvme:     nv1,                                    // le plus chaud des deux
    nvme0:    borne(36 + 4 * r + bruit(0.9), 30, 52),
    nvme1:    nv1,
    eth0:     borne(70 + 2.4 * r + bruit(0.7), 64, 79),
    nvme2:    0,                                      // emplacements M.2 libres
    nvme3:    0,
    site:     siteKo ? 0 : Math.round(58 + 22 * r + bruit(9)),
    siteup:   siteKo ? 2 : 1,
    qbdl:     rafale(r, 5_600_000),
    qbul:     rafale(r, 2_400_000),
    vpnup:    enPanne("vpnup", t)  ? 2 : 1,
    kumaup:   enPanne("kumaup", t) ? 2 : 1,
    /* Debits de la box : PAS dans l historique, comme en production, ou
       `systeme.py` les range dans `wan.h` (voir plus bas). */
    wanrx:    debitBox(r, 30_000_000),
    wantx:    debitBox(r, 4_000_000)
  };
}

const CHAMPS = ["t", "cpu", "ram", "disque", "reseau", "charge", "temp", "lecture",
  "ecriture", "charge5", "charge15", "swap", "nvme", "nvme0", "nvme1", "eth0",
  "nvme2", "nvme3", "site", "siteup", "qbdl", "qbul", "vpnup", "kumaup"];
const CHAMPS_MIN = ["t", "cpu", "ram", "temp", "swap", "nvme0", "nvme1", "eth0",
  "nvme2", "nvme3", "qbdl", "qbul"];

console.log("Fixtures d historique");
console.log("  graine 20260901, " + N_MIN + " points a la minute\n");

/* ---- la minute : source de verite unique -------------------------------- */
const minutes = [];
for (let i = 0; i < N_MIN; i++) {
  const t = DEBUT + i * MIN;
  minutes.push(Object.assign({ t }, mesure(t)));
}

const ligne = (m, champs) => champs.map(c =>
  c === "t" ? m.t : (Number.isInteger(m[c]) ? m[c] : Math.round(m[c] * 100) / 100));

ecrit("history-min.json", {
  m: minutes.map(m => ligne(m, CHAMPS_MIN)),
  champs: CHAMPS_MIN
});

/* ---- 24 h au pas de dix minutes, MOYENNEES depuis la minute -------------
   ⚠️ On moyenne au lieu de re-tirer : les deux series doivent decrire la meme
   journee, sinon la courbe et l infobulle se contrediraient sous le pointeur. */
const PAS_J = 600, N_J = 145;
const j = [];
for (let k = 0; k < N_J; k++) {
  const t = FIN - (N_J - 1 - k) * PAS_J;
  const lot = minutes.filter(m => m.t >= t && m.t < t + PAS_J);
  const src = lot.length ? lot : [minutes[minutes.length - 1]];
  const moy = {};
  for (const c of CHAMPS) if (c !== "t")
    moy[c] = Math.round((src.reduce((a, m) => a + m[c], 0) / src.length) * 100) / 100;
  j.push([t].concat(CHAMPS.slice(1).map(c => moy[c])));
}

/* ---- 7 jours au pas d une heure ---------------------------------------- */
const PAS_S = 3600, N_S = 169;
const s = [], wanH7 = [];
for (let k = 0; k < N_S; k++) {
  const t = FIN - (N_S - 1 - k) * PAS_S;
  /* Le remplissage du disque monte lentement sur la semaine : c est la seule
     serie dont la tendance se lit a cette echelle. */
  const av = (N_S - 1 - k) / N_S;
  const m = mesure(t);
  /* ⚠️ LES HEURES COUVERTES PAR LA MINUTE EN SONT LA MOYENNE (09/10/2026),
     comme en production. Avec le bouton « 7 j », le dernier jour se lit dans
     les deux vues : tire a part, il aurait dessine une autre journee. Le
     tirage `mesure(t)` est fait quand meme, pour ne pas decaler la suite. */
  const lot = minutes.filter(x => x.t >= t && x.t < t + PAS_S);
  if (lot.length) for (const c of CHAMPS.concat(["wanrx", "wantx"])) if (c !== "t")
    m[c] = lot.reduce((a, x) => a + x[c], 0) / lot.length;
  m.disque = Math.round((75.7 - av * 2.4) * 100) / 100;
  s.push([t].concat(CHAMPS.slice(1).map(c =>
    Number.isInteger(m[c]) ? m[c] : Math.round(m[c] * 100) / 100)));
  /* `wan.h7` : le debit de la box par heure close, comme `systeme.py`. */
  if (t < FIN) wanH7.push([t, Math.round(m.wanrx), Math.round(m.wantx)]);
}

ecrit("history.json", { j, s, champs: CHAMPS });

/* ---- SMART -------------------------------------------------------------- */
/* Detail de l espace dossier par dossier, pour la fenetre du volume
   (06/10/2026). Les postes de la carte en sont DERIVES : ecrits a part, la
   carte et sa fenetre se contrediraient. `p` : ce qu un dossier partage en
   liens physiques avec un dossier deja compte, comme torrents avec Films. */
const Go = (v) => Math.round(v * 1e9);
const dossier = (n, enf) => {
  const l = enf.map(([m, o, p]) => Object.assign({ n: m, o: Go(o) }, p ? { p: Go(p) } : {}));
  return { n, o: l.reduce((a, x) => a + x.o, 0), l };
};
const DET = {
  medias:   [dossier("Mediatheque", [["Films", 900], ["Series", 520], ["Animes", 110], ["torrents", 28, 1180],
                                     ["#recycle", 8], ["cross-seed", 4, 260]])],
  partages: [dossier("Famille", [["Photos", 310], ["Documents", 70], ["Videos", 38], ["#recycle", 2]]),
             dossier("@home", [["alice", 120], ["bob", 40]]),
             dossier("Commun", [["Logiciels", 60], ["Archives", 25]])],
  cameras:  [dossier("Surveillance", [["entree", 210], ["jardin", 130]]), dossier("@cameramgr", [["flux", 18]])],
  iscsi:    [dossier("@iscsi", [["LUN", 3298.5]])],
  docker:   [dossier("@docker", [["overlay2", 11.8], ["volumes", 1.9], ["image", 0.5]]),
             dossier("docker", [["arr", 2.2], ["portfolio", 1.1], ["supervision", 0.8]])],
  applis:   [dossier("@appstore", [["apps", 8.4]]), dossier("@thumbnail", [["cache", 5.8]]),
             dossier("@aiconsole", [["modeles", 3]])]
};
for (const k in DET) DET[k].sort((a, b) => b.o - a.o);
const PARTS = Object.fromEntries(Object.entries(DET).map(([k, l]) => [k, l.reduce((a, x) => a + x.o, 0)]));
PARTS.autres = Go(120);
const OCCUPE = Object.values(PARTS).reduce((a, o) => a + o, 0);
/* « Autres » decompose comme le fait le collecteur d apres btrfs : la somme
   retombe sur le poste. */
const AUTRES = { meta: Go(9.1), reserve: Go(0.5), cow: Go(104), snap: 0, nc: [] };
AUTRES.depuis = PARTS.autres - AUTRES.meta - AUTRES.reserve - AUTRES.cow;
/* Disque systeme : chaque partition, et le fichier d echange compte en swap. */
const SYS = {
  systeme: [dossier("/overlay", [["upper", 1.52], ["work", 0.01]]), dossier("/rootfs", [["usr", 1.1], ["lib", 0.24]]),
            dossier("/boot", [["noyau", 0.15]])],
  applis:  [dossier("/ugreen", [["@appstore", 1.6], ["data", 0.6], ["static", 0.3], ["language", 0.1]])],
  swap:    [{ n: "partition nvme0n1p5", o: 2147483648 }, { n: "fichier /overlay/.swapfile", o: 4294967296 }]
};
for (const k in SYS) SYS[k].sort((a, b) => b.o - a.o);
const SYSP = Object.fromEntries(Object.entries(SYS).map(([k, l]) => [k, l.reduce((a, x) => a + x.o, 0)]));

ecrit("smart.json", {
  ts: FIN,
  d: [
    { n: "nvme0", modele: "PCIe SSD 128GB", go: 128, ok: true, temp: 39,
      usure: 2, spare: 100, heures: 6180, cycles: 41, brutaux: 3, erreurs: 0, ecrit: 1.62,
      role: "systeme" },
    { n: "nvme1", modele: "NVMe Pro 8000GB", go: 8001, ok: true, temp: 46,
      usure: 1, spare: 100, heures: 6180, cycles: 39, brutaux: 2, erreurs: 0, ecrit: 26.4,
      role: "donnees" }
  ],
  /* L organisation, comme sur la machine reelle : un RAID 1 monte pour UN seul
     disque, donc sans miroir, et le disque systeme hors grappe. La place par
     poste est celle du VOLUME, en octets. */
  grappes: [
    { nom: "Volume 1", raid: "raid1", fs: "btrfs", n: 1, att: 1, err: 0, disques: ["nvme1"],
      esp: { tot: 7984990126080, used: OCCUPE, parts: PARTS, det: DET, mesure: "@-19h", autres: AUTRES,
             /* Le disque iSCSI vu de l interieur (09/10/2026) : ce que Windows y
                occupe, lu dans sa table NTFS par systeme.py. */
             iscsi: [{ id: "0f3c9a21", type: "thick", tot: 3298534883328, alloc: 3298534883328,
                       nom: "Jeux", fs: 3298516004864, used: 1211889528832 }] } },
    { nom: "Système", sys: true, disques: ["nvme0"],
      esp: { tot: 128035676160, parts: SYSP, det: SYS, mesure: "@-19h" } }
  ],
  /* Quatre emplacements M.2 pour les donnees, le disque systeme ayant le sien a
     part : un seul est occupe. */
  slots: { tot: 4, libres: 3 }
});

/* ---- conteneurs --------------------------------------------------------- */
const PILES = {
  "arr-": ["films", "series", "indexeurs", "soustitres", "demandes",
           "client", "tunnel", "resolveur", "croisement"],
  "umami": ["", "-base"],
  "portfolio-": ["web", "api", "admin", "base", "proxy", "notifs"],
  "": ["serveur-media", "supervision", "tableaux", "coffre-fort", "dns-filtrant",
       "vpn-acces", "veille-images", "sauvegarde", "jeux-serveur"]
};
const NOMS = [];
for (const [p, l] of Object.entries(PILES)) for (const n of l) NOMS.push(p + n);

const conteneurs = NOMS.map((n, i) => {
  const gros = /serveur-media|jeux-serveur|base|supervision/.test(n);
  const mem = Math.round((gros ? 180 + R() * 260 : 24 + R() * 110));
  return {
    n,
    cpu: arr2(R() * (gros ? 5.5 : 1.4)),
    mem,
    swap: Math.round(R() < 0.45 ? R() * (gros ? 190 : 40) : 0),
    age: Math.round(120000 + R() * 1900000),
    rs: n === "veille-images" ? 1 : 0,
    cpu24: arr2(R() * (gros ? 4.8 : 1.2)),
    mem24: Math.round(mem * (0.85 + R() * 0.3))
  };
});
/* ⚠️ `mem` EST UN POURCENTAGE DE LA MEMOIRE TOTALE, comme le `MemPerc` de
   `docker stats` que lit `containers.sh` ; la page le reconvertit en Mo avec
   `nas.ramt`. Le generateur tirait des Mo et les ecrivait tels quels : la carte
   annoncait 34 484 Mo pour un conteneur de 433 Mo (corrige le 05/10/2026). On
   tire toujours en Mo, pour ne pas toucher a la suite aleatoire, et on convertit
   a l ecriture seulement. */
const BASE = JSON.parse(fs.readFileSync(path.join(SRC, "base.json"), "utf8"));
const RAM_MO = BASE.nas.ramt / 1024;
const enPct = (mo) => Math.round(mo / RAM_MO * 10000) / 100;
/* `anon` : la memoire que le conteneur occupe VRAIMENT, sans le cache, en Mo —
   la mesure de la carte et de la fenetre « Memoire ». Repartie au prorata pour
   que la somme retombe exactement sur le groupe « conteneurs » de base.json. */
const ANON_TOT = ((BASE.mem && BASE.mem.g) || []).find(x => x.k === "conteneurs") || { mo: 0 };
const MEM_TOT = conteneurs.reduce((a, c) => a + c.mem, 0) || 1;
ecrit("containers.json", {
  t: FIN,
  c: conteneurs.slice().sort((a, b) => (b.mem + b.swap) - (a.mem + a.swap))
    .map(c => Object.assign({}, c, { mem: enPct(c.mem), mem24: enPct(c.mem24),
                                      anon: Math.round(c.mem / MEM_TOT * ANON_TOT.mo) })),
  /* Un redemarrage automatique dans les 24 h : la carte a de quoi montrer son
     bandeau de notification, qui resterait invisible autrement. */
  ev: [{ n: "veille-images", t: FIN - 5.4 * 3600 }]
});

/* `containers-hist.json` n est plus produit (08/10/2026) : la page ne le lit
   plus depuis le 05/10, et `containers.sh` a cesse de l ecrire. */

/* ---- petits fichiers ---------------------------------------------------- */
const der = minutes[minutes.length - 1];
ecrit("live.json", {
  t: "@-0.1min",
  cpu: Math.round(der.cpu), ram: Math.round(der.ram), net: der.reseau,
  qbit: { dl: der.qbdl, ul: der.qbul }, jnow: ""
});

ecrit("ratios.json", {
  maj: FIN - 42 * 60,
  Orion:  { r: 1.92, inf: false, min: null, up: null, down: null, ts: FIN - 42 * 60 },
  Vega:   { r: 2.61, inf: false, min: 0.8,
            up: 251255255040, down: 96223625216, ts: FIN - 42 * 60 },
  Altair: { r: null, inf: true, min: null,
            up: 412316860416, down: 0, ts: FIN - 42 * 60 }
});

/* ---- maj.json, que la fenetre des mises a jour lit EN DIRECT ---------------
   C est l etat de compose-auto-update (github.com/AWallez/compose-auto-update),
   qui a remplace le 25/09/2026 `updates.json` et le script qui l ecrivait.

   ⚠️ LA TUILE « MISES A JOUR » DE data.json EST DERIVEE DE CE FICHIER, avec la
   meme regle que collect.sh en production. Ecrites a la main, les deux sources
   avaient diverge : la tuile citait « indexeurs » la ou l inventaire disait
   « arr-indexeurs ». Derivee, elle ne le peut plus. */
const base = JSON.parse(fs.readFileSync(path.join(SRC, "base.json"), "utf8"));
const maj = JSON.parse(fs.readFileSync(path.join(SRC, "maj.json"), "utf8"));
copie("maj.json", "maj.json");
const suivis = Object.entries(maj.conteneurs);
const attend = (s) => s.disponible != null || s.blocage != null;
const fin = maj.derniere_passe.fin;
base.updates = {
  total: suivis.filter(([, s]) => attend(s)).length,
  verifies: suivis.length,
  maj: `${fin.slice(8, 10)}/${fin.slice(5, 7)} ${fin.slice(11, 16)}`,
  age: base.updates.age,
  items: suivis.map(([n, s]) => ({ n, upd: attend(s) }))
};
/* ⚠️ ON REMPLACE LE SEUL BLOC `updates`, DANS LE TEXTE. base.json est mis en
   forme a la main, valeurs groupees par ligne : le reecrire avec JSON.stringify
   detruisait cette mise en forme et changeait 280 lignes pour en modifier dix.
   On repere donc l objet par comptage d accolades, en sautant les chaines, et
   tout le reste du fichier sort identique a l octet. */
function remplaceCle(texte, cle, valeur) {
  const debut = texte.indexOf(`"${cle}"`);
  const ouvre = texte.indexOf("{", debut);
  if (debut < 0 || ouvre < 0) throw new Error(`cle ${cle} introuvable`);
  let profondeur = 0, dansChaine = false;
  for (let i = ouvre; i < texte.length; i++) {
    const c = texte[i];
    if (dansChaine) { if (c === "\\") i++; else if (c === '"') dansChaine = false; continue; }
    if (c === '"') dansChaine = true;
    else if (c === "{") profondeur++;
    else if (c === "}" && --profondeur === 0)
      return texte.slice(0, ouvre) + JSON.stringify(valeur) + texte.slice(i + 1);
  }
  throw new Error(`cle ${cle} : objet non referme`);
}
/* `acces` : les connexions des 24 h, DERIVEES D UN EMPLOI DU TEMPS comme le
   collecteur les derive des journaux : la liste complete pour la fenetre de la
   carte, les huit regroupements de la carte, le total et ce qui vient
   d Internet. Ecrits a la main, la carte et sa fenetre se contredisaient vite.
   Chaque ligne : [debut, fin] en minutes avant maintenant, nombre de
   connexions reparties entre les deux, puis service, compte, machine, methode,
   reussie. Tirage a part (`R3`), pour la meme raison que `R2`. */
const R3 = graine(20261006);
const PLAN_ACCES = [
  [48,   6,    15, "SSH", "admin", "Poste",     "clé",          1],
  [52,   52,   1,  "Web", "admin", "Poste",     "mot de passe", 1],
  [185,  180,  2,  "SSH", "admin", "Telephone", "clé",          1],
  [300,  262,  9,  "SSH", "admin", "Poste",     "clé",          1],
  [365,  365,  1,  "Web", "admin", "Telephone", "biométrie",    1],
  [570,  480,  18, "SSH", "admin", "Poste",     "clé",          1],
  [600,  600,  1,  "Web", "admin", "Poste",     "mot de passe", 1],
  [838,  838,  1,  "SSH", "admin", "Portable",  "clé",          1],
  [842,  840,  3,  "SSH", "root",  "Portable",  "refusée",      0],
  [1200, 1140, 10, "SSH", "admin", "Poste",     "clé",          1],
  [1380, 1380, 1,  "Web", "admin", "Poste",     "mot de passe", 1]
];
const ev = [];
for (const [deb, fin, nb, ...e] of PLAN_ACCES)
  for (let k = 0; k < nb; k++) {
    const pas = nb > 1 ? (deb - fin) / (nb - 1) : 0;
    const bruit = k && k < nb - 1 ? (R3() - 0.5) * pas * 0.6 : 0;
    ev.push([Math.round((deb - k * pas + bruit) * 10) / 10, ...e, 0]);
  }
ev.sort((a, b) => a[0] - b[0]);
/* Les regroupements de la carte, avec la regle du collecteur : identiques ET
   consecutives, sans limite d ecart. */
const log = [];
for (const [m, s, u, n, r, ok] of ev) {
  const p = log[log.length - 1];
  if (p && p.s === s && p.u === u && p.n === n && p.r === r && p.ok === !!ok) p.c++;
  else log.push({ t: "@-" + m + "min", s, u, n, r, ok: !!ok, x: false, c: 1 });
}
const acces = Object.assign({}, base.acces, {
  ev: ev.map(([m, ...e]) => ["@-" + m + "min", ...e]),
  log: log.slice(0, 8), n: ev.length, ext: 0
});
delete acces._;

const pData = path.join(OUT, "data.json");
fs.writeFileSync(pData, remplaceCle(remplaceCle(fs.readFileSync(path.join(SRC, "base.json"), "utf8"),
                                    "updates", base.updates), "acces", acces));
JSON.parse(fs.readFileSync(pData, "utf8"));      // le resultat doit rester du JSON valide
console.log("  " + "data.json".padEnd(26) + String(fs.statSync(pData).size).padStart(8)
            + " o   <- base.json + maj.json + " + ev.length + " connexions");

/* ---- les sources ecrites a la main, recopiees telles quelles -------------- */
copie("scenarios.json", "fixtures/scenarios.json");
for (const f of fs.readdirSync(path.join(SRC, "scenarios")))
  copie(path.join("scenarios", f), "fixtures/scenarios/" + f);

/* Raccourcis : la page retombe sur sa liste par defaut si le fichier manque,
   mais autant montrer une barre remplie. */
/* `systeme.json` : ce que ne donne pas `data.json`. Ici seulement les periodes
   de panne de chaque sonde Kuma, CALEES sur l incident `kumaup` simule plus
   haut, pour que l infobulle du ruban nomme des sondes la ou il est rouge.
   Horodatages RELATIFS, resolus a l affichage comme ceux de base.json. */
const ik = INCIDENTS.find(i => i.col === "kumaup");
const rel = (s) => "@-" + Math.round(-s / 60) + "min";
/* `disq` : le detail de chaque SSD pour sa fenetre (05/10/2026), aux memes
   valeurs que smart.json. Le disque systeme tourne en x2 sur un emplacement
   qui en accepte x4, comme sur le vrai NAS : la fenetre doit le dire. */
const H = (o) => ({ cw: 0, spare: 100, spare_min: 10, err_journal: 0, t_alerte: 0, t_crit: 0, ...o });
/* `wan.h` : les debits de la box, une ligne par creneau de 10 min CLOS sur 24 h,
   [debut, recu, envoye] en octets par seconde, exactement comme `systeme.py`.
   ⚠️ Les colonnes `wanrx`/`wantx` de l historique, que la demonstration
   inventait, n existaient pas en production : la courbe Internet s affichait
   ici et jamais sur le NAS (09/10/2026). Moyennees depuis la minute, comme
   l historique, pour decrire la meme journee. */
const wanH = [];
for (let k = 0; k < 144; k++) {
  const t0 = FIN - (144 - k) * 600;
  const lot = minutes.filter(m => m.t >= t0 && m.t < t0 + 600);
  if (!lot.length) continue;
  const moy = (c) => Math.round(lot.reduce((x, m) => x + m[c], 0) / lot.length);
  wanH.push([t0, moy("wanrx"), moy("wantx")]);
}
ecrit("systeme.json", {
  /* Heure du passage et sections en echec (08/10/2026) : la page les lit pour
     dire quand ses donnees sont figees. */
  t: "@-0.4min", problemes: [],
  /* Le journal des 7 jours (09/10/2026), comme `journal()` de systeme.py.
     Les coupures du site, du VPN et de la sonde sont CELLES DE L HISTORIQUE
     (`INCIDENTS`) : le journal et les rubans racontent la meme semaine. */
  journal: [
    ["@-2.2h", "maj", "Passe des mises à jour : 1 mise(s) à jour, 0 erreur(s), 0 en attente, 0 nouveau(x)", "in"],
    ["@-2.2h", "maj", "serveur-media mis à jour (10.9.10 → 10.9.11)", "ok"],
    ["@-6.2h", "vpn", "Le port du VPN est de nouveau joignable", "ok"],
    ["@-6.4h", "vpn", "Le port du VPN est injoignable", "cr"],
    ["@-10.9h", "site", "Le site répond de nouveau", "ok"],
    ["@-11.2h", "site", "Le site ne répond plus", "cr"],
    [rel(ik.debut), "sonde", "Sonde « serveur-media » hors ligne pendant " + Math.round(ik.duree / 60) + " min", "wn"],
    ["@-18.4h", "vpn", "Le port du VPN est de nouveau joignable", "ok"],
    ["@-19h", "vpn", "Le port du VPN est injoignable", "cr"],
    ["@-22h", "sauvegarde", "Sauvegarde : 912 Mo ajoutés en 31 s", "ok"],
    ["@-1.9j", "maj", "indexeurs mis à jour (2.6.4 → 2.6.5)", "ok"],
    ["@-2.1j", "conteneur", "client-torrent a redémarré après un arrêt", "wn"],
    ["@-2.9j", "sauvegarde", "Sauvegarde : 1,2 Go ajoutés en 48 s", "ok"],
    ["@-3j", "sauvegarde", "Vérification des sauvegardes : réussie", "ok"],
    ["@-3.4j", "reseau", "La box a redémarré", "wn"],
    ["@-4.2j", "nas", "Le NAS a démarré", "wn"],
    ["@-5j", "maj", "coffre-fort mis à jour (1.37.3 → 1.37.4)", "ok"],
    ["@-6j", "memoire", "Processus tué faute de mémoire : indexation", "wn"]
  ],
  wan: Object.assign({}, BASE.wan, { h: wanH, h7: wanH7 }),
  /* Ce que FanKarr a telecharge (06/10/2026), lu en production dans ses fichiers
     de suivi : episodes importes, place, telechargements en cours. */
  fankarr: { ep: 147, o: 354619441774, absents: 0, series: ["Série Kaï"], cours: 1, dernier: "@-14j" },
  kuma: { inc: [
  { n: "serveur-media", s: 0, t0: rel(ik.debut), t1: rel(ik.debut + ik.duree) },
  { n: "indexeurs", s: 2, t0: rel(ik.debut + 4 * 60), t1: rel(ik.debut + 19 * 60) },
  { n: "indexeurs", s: 0, t0: rel(ik.debut + 19 * 60), t1: rel(ik.debut + 31 * 60) }
] }, disq: {
  nvme0: { ctrl: "nvme0", fw: "SBFMJ1.3", ok: true, lien: ["8.0 GT/s PCIe", "2", "8.0 GT/s PCIe", "4"],
           seuils: [85, 95], capt: [["Composite", 39], ["Sensor 1", 51]],
           h: H({ usure: 2, ecrit: 1.62e12, lu: 3.9e12, occupe: 512, cycles: 41, heures: 6180, brutaux: 3 }),
           rythme: { j1: 5.1e9, j7: 6.4e9 },
           parts: [{ n: "nvme0n1p1", o: 268435456, fs: "vfat", m: "/boot", sur: [] },
                   { n: "nvme0n1p4", o: 2147483648, fs: "ext4", m: "/rootfs", sur: [] },
                   { n: "nvme0n1p5", o: 2147483648, fs: "swap", m: "[SWAP]", sur: [] },
                   { n: "nvme0n1p6", o: 4294967296, fs: "ext4", m: "/ugreen", sur: [] },
                   { n: "nvme0n1p7", o: 117018271232, fs: "ext4", m: "/overlay", sur: [] }] },
  nvme1: { ctrl: "nvme1", fw: "731100WD", ok: true, lien: ["16.0 GT/s PCIe", "4", "16.0 GT/s PCIe", "4"],
           seuils: [90, 94], capt: [["Composite", 46], ["Sensor 1", 57], ["Sensor 2", 45]],
           h: H({ usure: 1, ecrit: 26.4e12, lu: 61.8e12, occupe: 2210, cycles: 39, heures: 6180, brutaux: 2, err_journal: 14 }),
           rythme: { j1: 118e9, j7: 96e9 },
           parts: [{ n: "nvme1n1p1", o: 16382951424, fs: null, m: null, sur: [] },
                   { n: "nvme1n1p2", o: 7985178869760, fs: "linux_raid_member", m: null,
                     sur: [{ n: "md1", t: "raid1", fs: null, m: null },
                           { n: "pool1-volume1", t: "lvm", fs: "btrfs", m: "/volume1" }] }] }
} });

/* De vrais sites (23/10/2026, demande), qui parlent a tout le monde, aux
   recruteurs et aux developpeurs ou administrateurs DevOps. Leurs icones sont
   fabriquees a la publication (`favicons.py`, voir pages.yml). Ansible : la
   documentation, ansible.com montrant le chapeau de Red Hat. */
const RACCOURCIS = [
  { name: "YouTube",        url: "https://www.youtube.com/" },
  { name: "Netflix",        url: "https://www.netflix.com/" },
  { name: "Spotify",        url: "https://open.spotify.com/" },
  { name: "Wikipédia",      url: "https://fr.wikipedia.org/" },
  { name: "LinkedIn",       url: "https://www.linkedin.com/" },
  { name: "GitHub",         url: "https://github.com/" },
  { name: "Docker Hub",     url: "https://hub.docker.com/" },
  { name: "Kubernetes",     url: "https://kubernetes.io/" },
  { name: "Ansible",        url: "https://docs.ansible.com/" },
  { name: "Proxmox",        url: "https://www.proxmox.com/" },
  { name: "Grafana",        url: "https://grafana.com/" },
  { name: "Cloudflare",     url: "https://www.cloudflare.com/" },
  { name: "Stack Overflow", url: "https://stackoverflow.com/" },
  { name: "React",          url: "https://react.dev/" },
  { name: "Node.js",        url: "https://nodejs.org/" },
  { name: "Deno",           url: "https://deno.com/" },
  { name: "Portfolio",      url: "https://alexiswallez.fr/" }
];
ecrit("data/shortcuts.json", RACCOURCIS);

console.log("\n  fenetre : " + new Date(DEBUT * 1000).toLocaleString("fr-FR")
  + "  ->  " + new Date(FIN * 1000).toLocaleString("fr-FR"));
console.log("  incidents places : " + INCIDENTS.map(i =>
  i.col + " a -" + (-i.debut / 3600).toFixed(1) + " h pendant " + (i.duree / 60) + " min").join(", "));
