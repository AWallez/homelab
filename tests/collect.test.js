/* collect.sh, le collecteur principal (data.json et history.csv), SANS LE NAS.
 *
 *   node --test tests/*.test.js
 *
 * Toutes ses sources sont bouchonnees : `curl`, `nc`, `openssl`, `docker` et
 * `sqlite3` echouent, comme sur un NAS dont tous les services seraient arretes.
 * Ce que ca prouve : « une donnee manquante n est pas une panne » (README). Le
 * script va au bout, ecrit un data.json strict et de la forme de la
 * demonstration, nomme les services muets, et sa ligne d historique laisse
 * VIDES les mesures absentes. Ce que ca ne prouve pas : les filtres jq face aux
 * vraies reponses des API, qu il faudrait enregistrer sur le NAS.
 *
 * ⚠️ /proc et /sys sont ceux de la machine de test : processeur et memoire y
 * sont reels mais sans interet, seules la forme et la conduite sont jugees.
 * ⚠️ Le port du VPN est sonde par `/dev/tcp`, sans outil a bouchonner, mais
 * seulement si docker rend l IP du tunnel : les bouchons n en rendent jamais.
 *
 * Le contrat de history.csv (ordre des colonnes, noms publies) est verifie a
 * part, en lisant les trois scripts : voir la fin du fichier. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { avecBanc, demo, genre, RACINE } = require("./aide/banc.js");
const { charge } = require("./aide/charge.js");

const outilsPresents = ["bash", "jq", "awk", "flock"].every((o) =>
  spawnSync("sh", ["-c", "command -v " + o]).status === 0);
const SAUF = outilsPresents ? false : "bash, jq, awk ou flock absent";

// les outils par lesquels collect.sh joint ses sources : leurs bouchons les recoivent
const SOURCES = ["curl", "nc", "openssl"];

/** Un banc pret pour collect.sh, toutes sources muettes. */
function bancCollecte(t) {
  const b = avecBanc(t, SOURCES);
  b.ecrit("tools/homepage.env", "");
  b.ecrit("nvme-slots.sh", "#!/bin/sh\nexit 0\n");
  fs.chmodSync(b.chemin("nvme-slots.sh"), 0o755);
  // conteneurs, base du CRM, tunnel du VPN, base de cross-seed : muets
  b.bouchon("docker", "exit 1");
  b.bouchon("sqlite3", "exit 1");
  return b;
}

/* ---- le contrat de history.csv, lu dans les trois scripts --------------- */

const source = (f) => fs.readFileSync(path.join(RACINE, "collecteurs", f), "utf8");

/** Les variables de la ligne d historique de collect.sh, dans l ordre des colonnes. */
function colonnesCollecte(texte = source("collect.sh")) {
  const m = texte.match(/printf '((?:%s,)*%s)\\n' ([^>]*?)\s*>> "\$ICI\/history\.csv"/);
  assert.ok(m, "ligne d historique introuvable dans collect.sh");
  const vars = [...m[2].matchAll(/"\$([A-Z0-9_]+)"/g)].map((x) => x[1]);
  assert.equal(vars.length, m[1].split(",").length, "collect.sh : autant de %s que de variables");
  return vars;
}

/** Les colonnes que lit un script et le nom sous lequel il les publie : [[n, nom]]. */
function paires(cols, noms, qui) {
  const c = cols.trim().split(/ +/).map(Number), n = noms.trim().split(/ +/);
  assert.equal(c.length, n.length, qui + " : autant de colonnes que de noms");
  return c.map((x, i) => [x, n[i]]);
}
function lecteurs(build = source("history-build.sh"), min = source("history-min.sh")) {
  const j = build.match(/nj = split\("([\d ]+)", J, " "\)\s*split\("([a-z0-9 ]+)", NJ, " "\)/);
  const s = build.match(/ns = split\("([\d ]+)", S, " "\)\s*split\("([a-z0-9 ]+)", NS, " "\)/);
  const c = min.match(/NB=split\("([\d ]+)", C, " "\)/);
  const n = min.match(/\\"champs\\":\[((?:\\"[a-z0-9]+\\",?)+)\]/);
  assert.ok(j && s, "colonnes introuvables dans history-build.sh");
  assert.ok(c && n, "colonnes introuvables dans history-min.sh");
  const nomsMin = [...n[1].matchAll(/\\"([a-z0-9]+)\\"/g)].map((x) => x[1]);
  assert.equal(nomsMin.shift(), "t");
  return {
    "history-build.sh (24 h)": paires(j[1], j[2], "history-build.sh"),
    "history-build.sh (7 j)": paires(s[1], s[2], "history-build.sh"),
    "history-min.sh": paires(c[1], nomsMin.join(" "), "history-min.sh"),
  };
}

/* Chaque variable de la ligne et le nom sous lequel la page la lit. C est le
   contrat que les commentaires de collect.sh imposent : une colonne AJOUTEE EN
   FIN, publiee par history-build.sh et history-min.sh, jamais deplacee. */
const NOMS = {
  CPU: "cpu", RAM: "ram", NET: "reseau", TEMP: "temp", SWP: "swap", NVT: "nvme",
  NV0: "nvme0", NV1: "nvme1", ETH: "eth0", NV2: "nvme2", NV3: "nvme3", H_SMS: "site",
  SUP: "siteup", H_QDL: "qbdl", H_QUL: "qbul", VUP: "vpnup", KUP: "kumaup", NV4: "nvme4",
};
// toujours ecrites, plus publiees depuis le 08/10/2026 : personne ne les lisait
const NON_PUBLIEES = new Set(["DPC", "LOAD1", "DR", "DW", "LOAD5", "LOAD15"]);

/** Les manquements au contrat, pour les textes des trois scripts (ceux du depot par defaut). */
function ecartsDuContrat({ collect, build, min } = {}) {
  const cols = colonnesCollecte(collect), l = lecteurs(build, min), ecarts = [];
  if (cols[0] !== "NOWS") ecarts.push("la premiere colonne n est pas l heure du passage");
  for (const [qui, ps] of Object.entries(l))
    for (const [n, nom] of ps) {
      const v = cols[n - 1];
      if (!v) ecarts.push(qui + " lit la colonne " + n + ", que collect.sh n ecrit pas");
      else if (NOMS[v] !== nom) ecarts.push(qui + " publie la colonne " + n + " ($" + v + ") sous « " + nom + " »");
    }
  const publiees = new Set(Object.values(l).flatMap((ps) => ps.map(([n]) => cols[n - 1])));
  for (const v of cols.slice(1))
    if (!publiees.has(v) && !NON_PUBLIEES.has(v)) ecarts.push("$" + v + " est ecrite dans history.csv mais publiee nulle part");
  return ecarts;
}

test("history.csv : chaque colonne de collect.sh publiee sous son nom, ou volontairement pas", () => {
  assert.deepEqual(ecartsDuContrat(), []);
});

test("le contrat lui-meme : colonnes echangees, colonne oubliee, nom change", () => {
  const remplace = (texte, a, b) => {
    assert.equal(texte.split(a).length, 2, "motif absent ou repete : " + a);
    return texte.replace(a, b);
  };
  const collect = source("collect.sh"), build = source("history-build.sh");
  // deux disques echanges dans la ligne : leurs courbes changeraient de disque sans bruit
  assert.ok(ecartsDuContrat({ collect: remplace(collect, '"$NV0" "$NV1"', '"$NV1" "$NV0"') })
    .some((e) => e.includes("($NV1) sous « nvme0 »")));
  // une colonne ajoutee en fin, mais ni a history-build.sh ni a history-min.sh
  const ajout = remplace(remplace(collect, "%s\\n' \"$NOWS\" \"$CPU\"", "%s,%s\\n' \"$NOWS\" \"$CPU\""),
    '"$KUP" "$NV4" \\', '"$KUP" "$NV4" "$NOUV" \\');
  assert.deepEqual(ecartsDuContrat({ collect: ajout }), ["$NOUV est ecrite dans history.csv mais publiee nulle part"]);
  // un lecteur qui renomme une colonne
  assert.ok(ecartsDuContrat({ build: remplace(build, "nvme nvme0 nvme1 eth0", "nvme nvme1 nvme0 eth0") }).length > 0);
});

/* ---- un passage, toutes sources muettes ---------------------------------- */

test("collect.sh, sources muettes : va au bout, data.json strict", { skip: SAUF }, (t) => {
  const b = bancCollecte(t);
  const r = b.lance("collect.sh");
  assert.equal(r.rc, 0, r.erreurs);
  assert.doesNotMatch(r.erreurs, /NON remplace/);
  // JSON.parse refuse NaN et Infinity, comme le navigateur
  const d = b.json("www/data.json");
  assert.ok(Math.abs(d.t - Date.now() / 1000) < 120, "l heure du passage");
});

/* La demonstration ecrit ses horodatages en DECALAGES (« @-13h »), resolus a
   l affichage (`RELATIF`, www/app.js) : un decalage vaut un nombre de la production. */
const RELATIF = /^@-(\d+(?:\.\d+)?)(min|h|j)$/;
const genreDemo = (v) => (typeof v === "string" && RELATIF.test(v) ? "number" : genre(v));

/** Les chemins de `prod` absents de `dm`, ou d un autre type. Un `null` (valeur
 *  absente) s accorde a tout ; d un tableau, on compare le premier element. */
function ecartsDeForme(prod, dm, chemin = "") {
  if (genre(prod) === "array")
    return prod.length && genre(dm) === "array" && dm.length ? ecartsDeForme(prod[0], dm[0], chemin + "[0]") : [];
  if (genre(prod) !== "object") return [];
  const ecarts = [];
  for (const [k, v] of Object.entries(prod)) {
    const c = chemin + "." + k;
    if (genre(dm) !== "object" || !(k in dm)) { ecarts.push(c + " : absent de la demonstration"); continue; }
    const a = genre(v), e = genreDemo(dm[k]);
    if (a !== "null" && e !== "null" && a !== e) ecarts.push(c + " : " + a + " en production, " + e + " dans la demonstration");
    else ecarts.push(...ecartsDeForme(v, dm[k], c));
  }
  return ecarts;
}

test("collect.sh, sources muettes : tout ce qu il ecrit, la demonstration le connait", { skip: SAUF }, (t) => {
  const b = bancCollecte(t);
  b.lance("collect.sh");
  assert.deepEqual(ecartsDeForme(b.json("www/data.json"), demo("data.json")), []);
});

test("ecartsDeForme : une cle inconnue ou un type change est vu", () => {
  assert.deepEqual(ecartsDeForme({ a: 1, b: { c: "x" } }, { a: "@-3h", b: { c: "y" } }), []);
  assert.deepEqual(ecartsDeForme({ a: 1, z: 2 }, { a: 1 }), [".z : absent de la demonstration"]);
  assert.deepEqual(ecartsDeForme({ a: [{ b: 1 }] }, { a: [{ b: "texte" }] }),
    [".a[0].b : number en production, string dans la demonstration"]);
});

test("collect.sh, sources muettes : chaque service muet a sa carte, chaque carte son service", { skip: SAUF }, (t) => {
  const b = bancCollecte(t);
  b.lance("collect.sh");
  const ko = b.json("www/data.json").ko;
  assert.ok(Array.isArray(ko) && ko.every((n) => typeof n === "string"));
  assert.equal(new Set(ko).size, ko.length, "un service nomme deux fois");
  // la carte d un service porte son nom dans `ko` (`muet`, www/app.js)
  const { lire } = charge(["site.js", "cartes.js"]);
  const cartes = [...new Set([...lire("GROUPS")].flatMap((g) => [...g.s]).filter((s) => s.ko).map((s) => s.ko))];
  assert.deepEqual([...ko].sort(), cartes.sort());
});

test("collect.sh, sources muettes : une ligne d historique, mesures absentes VIDES", { skip: SAUF }, (t) => {
  const b = bancCollecte(t);
  b.lance("collect.sh");
  const cols = colonnesCollecte();
  const lignes = b.lit("history.csv").split("\n").filter(Boolean);
  assert.equal(lignes.length, 1);
  const c = lignes[0].split(",");
  assert.equal(c.length, cols.length);
  assert.equal(+c[0], b.json("www/data.json").t, "meme passage que data.json");
  for (const [i, v] of c.entries())
    if (v !== "") assert.match(v, /^-?\d+(\.\d+)?$/, "colonne " + (i + 1) + " ($" + cols[i] + ") : " + v);
  const col = (v) => c[cols.indexOf(v)];
  // le site et qBittorrent n ont pas repondu : VIDE, hors des moyennes (un 0 y compterait)
  for (const v of ["H_SMS", "H_QDL", "H_QUL"]) assert.equal(col(v), "", "$" + v);
  // les rubans : 2 = injoignable (site, VPN), 0 = aucune mesure (Kuma muet)
  assert.equal(col("SUP"), "2");
  assert.equal(col("VUP"), "2");
  assert.equal(col("KUP"), "0");
});

test("collect.sh puis history-build.sh et history-min.sh : la ligne se lit", { skip: SAUF }, (t) => {
  const b = bancCollecte(t);
  b.lance("collect.sh");
  const c = b.lit("history.csv").trim().split(",");
  for (const s of ["history-build.sh", "history-min.sh"]) {
    const r = b.lance(s);
    assert.equal(r.rc, 0, s + " : " + r.erreurs);
  }
  const h = b.json("www/history.json"), m = b.json("www/history-min.json");
  const cols = colonnesCollecte();
  for (const [nom, v] of [["cpu", "CPU"], ["ram", "RAM"]]) {
    const x = +c[cols.indexOf(v)];
    assert.equal(h.j.at(-1)[h.champs.indexOf(nom)], x, "history.json, " + nom);
    assert.equal(m.m.at(-1)[m.champs.indexOf(nom)], x, "history-min.json, " + nom);
  }
});

/** L empreinte des fichiers du banc, hors de ce que le mode essai a le droit d ecrire. */
function empreinte(T) {
  const o = {};
  for (const f of fs.readdirSync(T, { recursive: true }).map(String).sort()) {
    const p = path.join(T, f);
    if (!fs.statSync(p).isFile() || /^(bin\/|collect-essai)|^reseau\.log$/.test(f)) continue;
    o[f] = crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");
  }
  return o;
}

test("collect.sh --essai : n ecrit que collect-essai.json, ni historique ni etats", { skip: SAUF }, (t) => {
  const b = bancCollecte(t);
  b.lance("collect.sh");                       // un passage normal d abord : etats, historique
  const avant = empreinte(b.T);
  const r = b.lance("collect.sh", {}, ["--essai"]);
  assert.equal(r.rc, 0, r.erreurs);
  assert.deepEqual(empreinte(b.T), avant, "le mode essai a modifie un fichier");
  const essai = JSON.parse(fs.readFileSync(path.join(b.T, "collect-essai.json"), "utf8"));
  assert.deepEqual(Object.keys(essai), Object.keys(b.json("www/data.json")));
});

/* ---- les certificats, lus par un openssl bouchonne qui repond ----------- */

test("collect.sh : certificat lu (bouchon openssl), jours restants et duree de vie", { skip: SAUF }, (t) => {
  const b = bancCollecte(t);
  // valable encore 60 jours (et une heure de marge), emis pour 90 jours
  const fin = Date.now() + 60 * 86400e3 + 3600e3, debut = fin - 90 * 86400e3;
  const date = (ms) => new Date(ms).toUTCString();   // « Tue, 05 Jan 2027 22:00:00 GMT », lu par `date -d`
  b.bouchon("openssl", `echo "openssl $*" >> "${b.T}/reseau.log"
[ "$1" = x509 ] || exit 0
for a in "$@"; do case "$a" in
  -startdate) echo "notBefore=${date(debut)}" ;;
  -enddate) echo "notAfter=${date(fin)}" ;;
esac; done`);
  const r = b.lance("collect.sh");
  assert.equal(r.rc, 0, r.erreurs);
  const d = b.json("www/data.json");
  assert.deepEqual(d.certs, [{ h: "example.com", j: 60, v: 90 }]);
  assert.equal(d.site.cert, 60);
  assert.deepEqual(ecartsDeForme(d.certs, demo("data.json").certs), []);
});

/* ---- les vraies reponses des API, enregistrees sur le NAS --------------- */
/* `outils/enregistre-api.sh`, lance sur le NAS, fait tourner collect.sh en
   `--essai` derriere un curl ENREGISTREUR : un fichier par requete reussie,
   nomme par sa fonction `cle`, nettoye de ses secrets. Ici, un curl de REJEU
   reprend cette meme fonction et rend ces fichiers a collect.sh. Le mecanisme
   est eprouve a chaque fois sur des reponses fabriquees ; les vraies, elles,
   sont personnelles et n entrent jamais dans le depot :
     HOMELAB_REPONSES=~/homelab-reponses node --test tests/*.test.js */

const ENREGISTREUR = path.join(RACINE, "outils", "enregistre-api.sh");
const CLE = fs.readFileSync(ENREGISTREUR, "utf8").match(/^cle\(\) \{[\s\S]*?^\}/m)[0];

/** Un curl qui rend les reponses de `dossier`, et reste muet pour les autres. */
function rejoue(b, dossier) {
  b.bouchon("curl", `echo "curl $*" >> "${b.T}/reseau.log"
${CLE}
url=""; for a in "$@"; do case "$a" in http://*|https://*) url=$a ;; esac; done
[ -n "$url" ] && f=${JSON.stringify(dossier)}/$(cle "$url") && [ -f "$f" ] && { cat "$f"; exit 0; }
exit 7`);
}

/** Un banc pour rejouer : une page de statut Kuma et un site Umami configures. */
function bancRejeu(t) {
  const b = bancCollecte(t);
  b.ecrit("tools/homepage.env", "HOMEPAGE_VAR_KUMA_SLUG=essai\n");
  b.ecrit("collect.conf", "UMAMI_SITE_ID=12345678-aaaa-bbbb-cccc-1234567890ab\n");
  return b;
}

const gitPresent = spawnSync("sh", ["-c", "command -v git"]).status === 0;

test("enregistre-api.sh, sans le NAS : enregistre, masque les secrets, et collect.sh rejoue", { skip: SAUF }, (t) => {
  const b = bancRejeu(t);
  const reponses = path.join(b.T, "reponses");
  // le « vrai » curl : des reponses fabriquees, avec des secrets a masquer. Une
  // passkey dans le CHEMIN de l URL d annonce, une autre dans la requete d une
  // URL cachee au milieu d un texte.
  const PK = "https://tk.vega.example/PASSKEY-SECRET/announce";
  const maindata = JSON.stringify({
    server_state: { dl_info_speed: 10, up_info_speed: 20, connection_status: "connected" },
    torrents: { h1: { name: "t", state: "uploading", tracker: PK, magnet_uri: "magnet:?xt=urn:btih:h1&tr=" + PK,
                      comment: "fiche : https://tk.vega.example/t/9?passkey=PASSKEY-SECRET merci" } },
    trackers: { [PK]: ["h1"] },
  });
  b.bouchon("curl", `echo "curl $*" >> "${b.T}/reseau.log"
case "$*" in
  *:7878/api/v3/wanted/missing*) echo '{"totalRecords":3,"records":[]}' ;;
  *:8989/api/v3/wanted/missing*) echo '{"totalRecords":5,"records":[]}' ;;
  *:3002/api/auth/login*) echo '{"token":"JETON-SECRET","user":{"username":"essai"}}' ;;
  *:3002/api/websites/*/stats*) echo '{"visitors":7,"pageviews":30,"visits":9}' ;;
  *:3001/api/status-page/heartbeat/essai*) echo '{"heartbeatList":{},"uptimeList":{}}' ;;
  *:8080/api/v2/sync/maindata*) echo '${maindata}' ;;
  *) exit 7 ;;
esac`);
  const r = spawnSync("bash", [ENREGISTREUR, b.prepare("collect.sh"), reponses], {
    encoding: "utf8", timeout: 30000, cwd: b.T,
    env: { PATH: b.B + ":" + process.env.PATH, HOME: b.T, LANG: "C.UTF-8" },
  });
  assert.equal(r.status, 0, r.stderr);
  const fichiers = fs.readdirSync(reponses).sort();
  // nommes sans l hote, slug Kuma, UUID Umami et instants remplaces
  for (const f of ["7878_api_v3_wanted_missing", "8080_api_v2_sync_maindata", "3001_api_status-page_heartbeat_SLUG",
                   "3002_api_websites_ID_stats_startAt_N_endAt_N"])
    assert.ok(fichiers.includes(f), f + " absent de " + fichiers.join(", "));
  // les requetes en echec ne sont pas enregistrees : le rejeu les retrouve muettes
  assert.ok(!fichiers.some((f) => f.startsWith("9696_")), "prowlarr n a pas repondu");
  const tout = fichiers.map((f) => fs.readFileSync(path.join(reponses, f), "utf8")).join("\n");
  assert.doesNotMatch(tout, /PASSKEY-SECRET|JETON-SECRET/);
  const md = JSON.parse(fs.readFileSync(path.join(reponses, "8080_api_v2_sync_maindata"), "utf8"));
  assert.equal(md.torrents.h1.tracker, "https://tk.vega.example/", "l hote reste : collect.sh en tire le nom du tracker");
  assert.ok(!("magnet_uri" in md.torrents.h1));
  assert.equal(md.torrents.h1.comment, "fiche : https://tk.vega.example/ merci");
  assert.deepEqual(Object.keys(md.trackers), ["https://tk.vega.example/"]);
  // le mode essai : rien d ecrit hors de son fichier
  assert.ok(!fs.existsSync(b.chemin("www/data.json")) && !fs.existsSync(b.chemin("history.csv")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(b.T, "collect-essai.json"), "utf8")).radarr.mis, 3);

  // puis le rejeu, en passage normal, avec la fonction `cle` de l enregistreur
  rejoue(b, reponses);
  const r2 = b.lance("collect.sh");
  assert.equal(r2.rc, 0, r2.erreurs);
  const d = b.json("www/data.json");
  assert.equal(d.radarr.mis, 3);
  assert.equal(d.sonarr.mis, 5);
  assert.equal(d.umami.visitors, 7);
  assert.equal(d.qbit.nb, 1);
  for (const s of ["radarr", "sonarr", "umami"]) assert.ok(!d.ko.includes(s), s + " rejoue mais declare muet");
  assert.ok(d.ko.includes("prowlarr"), "prowlarr, jamais enregistre, reste muet");
});

test("enregistre-api.sh refuse un dossier dans un depot git, avant de le creer", { skip: SAUF || (!gitPresent && "git absent") }, (t) => {
  const b = bancRejeu(t);
  const dans = path.join(RACINE, "tests", "reponses-refusees");
  const r = spawnSync("bash", [ENREGISTREUR, b.prepare("collect.sh"), dans], {
    encoding: "utf8", timeout: 30000, env: { PATH: b.B + ":" + process.env.PATH, HOME: b.T, LANG: "C.UTF-8" },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /dans un depot git/);
  assert.ok(!fs.existsSync(dans), "le dossier a ete cree malgre le refus");
});

/* Le service que nomme chaque port de collect.sh (`PORT_RADARR=7878` : radarr). */
const SERVICE_DU_PORT = Object.fromEntries([...source("collect.sh").matchAll(/PORT_([A-Z]+)=(\d+)/g)]
  .map((m) => [m[2], m[1].toLowerCase()]));

const REELLES = process.env.HOMELAB_REPONSES;
test("collect.sh, reponses enregistrees sur le NAS : chaque service repond, data.json de la forme de la demo",
  { skip: SAUF || (!REELLES && "HOMELAB_REPONSES non defini : voir outils/enregistre-api.sh") }, (t) => {
    const b = bancRejeu(t);
    rejoue(b, path.resolve(REELLES));
    const r = b.lance("collect.sh");
    assert.equal(r.rc, 0, r.erreurs);
    const d = b.json("www/data.json");
    // un service dont une reponse a ete enregistree, et qu une carte suit, ne doit pas etre muet
    const { lire } = charge(["site.js", "cartes.js"]);
    const suivis = new Set([...lire("GROUPS")].flatMap((g) => [...g.s]).filter((s) => s.ko).map((s) => s.ko));
    const enregistres = new Set(fs.readdirSync(REELLES).map((f) => SERVICE_DU_PORT[f.split("_")[0]]).filter((s) => suivis.has(s)));
    assert.ok(enregistres.size > 0, "aucune reponse d un service suivi dans " + REELLES);
    for (const s of enregistres) assert.ok(!d.ko.includes(s), s + " : enregistre, mais declare muet (filtre jq ?)");
    assert.deepEqual(ecartsDeForme(d, demo("data.json")), []);
  });
