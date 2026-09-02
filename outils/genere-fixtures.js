/* Generateur des fixtures d historique du tableau de bord.
 *
 *   node outils/genere-fixtures.js
 *
 * POURQUOI UN GENERATEUR ET NON DES FICHIERS ECRITS A LA MAIN. Il faut 1440
 * points a la minute, 145 au pas de dix minutes et 169 a l heure, sur vingt-
 * quatre colonnes. Ecrits a la main ils seraient plats, et une courbe plate
 * fait passer tout le tableau de bord pour une maquette morte. Ecrits par un
 * generateur, ils ont un rythme jour/nuit, du bruit, et de vrais incidents.
 *
 * ⚠️ TIRAGE DETERMINISTE. La meme graine rend exactement les memes courbes :
 * regenerer ne fait pas bouger la demonstration, les captures d ecran restent
 * valables, et une difference dans un fichier signale un vrai changement de
 * code plutot qu un caprice du hasard.
 *
 * ⚠️ LES HORODATAGES SONT ABSOLUS ICI, et c est assume : la page les REBASE a
 * l affichage en mode demonstration, en decalant toute la serie pour que son
 * dernier point tombe sur maintenant. Sans ca, une demo publiee en mars
 * afficherait des courbes vieilles de six mois avec une echelle horaire fausse.
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
    disque:   63,
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
    kumaup:   enPanne("kumaup", t) ? 2 : 1
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
const s = [];
for (let k = 0; k < N_S; k++) {
  const t = FIN - (N_S - 1 - k) * PAS_S;
  /* Le remplissage du disque monte lentement sur la semaine : c est la seule
     serie dont la tendance se lit a cette echelle. */
  const av = (N_S - 1 - k) / N_S;
  const m = mesure(t);
  m.disque = Math.round((63 - av * 2.4) * 100) / 100;
  s.push([t].concat(CHAMPS.slice(1).map(c =>
    Number.isInteger(m[c]) ? m[c] : Math.round(m[c] * 100) / 100)));
}

ecrit("history.json", { j, s, champs: CHAMPS });

/* ---- SMART -------------------------------------------------------------- */
ecrit("smart.json", {
  ts: FIN,
  d: [
    { n: "nvme0", modele: "SSD systeme 128 Go", go: 128, ok: true, temp: 39,
      usure: 2, spare: 100, heures: 6180, cycles: 41, brutaux: 3, erreurs: 0, ecrit: 1.62 },
    { n: "nvme1", modele: "SSD donnees 8 To", go: 8001, ok: true, temp: 46,
      usure: 1, spare: 100, heures: 6180, cycles: 39, brutaux: 2, erreurs: 0, ecrit: 26.4 }
  ]
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
ecrit("containers.json", {
  t: FIN,
  c: conteneurs.sort((a, b) => (b.mem + b.swap) - (a.mem + a.swap)),
  /* Un redemarrage automatique dans les 24 h : la carte a de quoi montrer son
     bandeau de notification, qui resterait invisible autrement. */
  ev: [{ n: "veille-images", t: FIN - 5.4 * 3600 }]
});

const PAS_H = 1800, N_H = 337;                        // 7 jours au pas de 30 min
const hist = {};
for (const c of conteneurs) {
  const v = [];
  for (let k = 0; k < N_H; k++)
    v.push(Math.round(c.mem24 * (0.82 + 0.36 * rythme(FIN - (N_H - 1 - k) * PAS_H)) + bruit(6)));
  hist[c.n] = v;
}
ecrit("containers-hist.json", { pas: PAS_H, n: N_H, c: hist });

/* ---- petits fichiers ---------------------------------------------------- */
const der = minutes[minutes.length - 1];
ecrit("live.json", {
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

/* ---- updates.json, que la fenetre des mises a jour lit EN DIRECT -----------
   ⚠️ Elle ne se contente pas de la copie presente dans data.json : sans ce
   fichier, la liste resterait perimee. Meme piege que celui documente le
   16/08 cote NAS. */
const base = JSON.parse(fs.readFileSync(path.join(SRC, "base.json"), "utf8"));
ecrit("updates.json", base.updates);

/* ---- les sources ecrites a la main, recopiees telles quelles -------------- */
copie("base.json", "data.json");
copie("scenarios.json", "fixtures/scenarios.json");
for (const f of fs.readdirSync(path.join(SRC, "scenarios")))
  copie(path.join("scenarios", f), "fixtures/scenarios/" + f);

/* Raccourcis : la page retombe sur sa liste par defaut si le fichier manque,
   mais autant montrer une barre remplie. */
ecrit("data/shortcuts.json", [
  { name: "Documentation", url: "https://developer.mozilla.org/fr/" },
  { name: "Forge",         url: "https://github.com/" },
  { name: "Conteneurs",    url: "https://hub.docker.com/" },
  { name: "Veille",        url: "https://news.ycombinator.com/" }
]);

console.log("\n  fenetre : " + new Date(DEBUT * 1000).toLocaleString("fr-FR")
  + "  ->  " + new Date(FIN * 1000).toLocaleString("fr-FR"));
console.log("  incidents places : " + INCIDENTS.map(i =>
  i.col + " a -" + (-i.debut / 3600).toFixed(1) + " h pendant " + (i.duree / 60) + " min").join(", "));
