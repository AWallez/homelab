/* Les collecteurs du NAS face aux donnees de la DEMONSTRATION, avec des
 * bouchons a la place de docker, smartctl et ntfy.
 *
 *   node --test tests/*.test.js
 *
 * Ce que ca prouve : nourri de mesures plausibles, un collecteur ecrit un
 * fichier de la meme forme que celui que la demonstration publie (memes cles,
 * memes types, memes noms de colonnes), donc un fichier que la page sait lire.
 * Ce que ca ne prouve pas : le comportement sur le vrai materiel, sous cron,
 * avec les versions d outils du NAS. `outils/teste-collecteurs.sh` couvre, lui,
 * les pannes (source muette, sortie tronquee) : ces essais ne le remplacent pas.
 *
 * ⚠️ LA REFERENCE EST `www/`, PAS `fixtures/` : la page ne lit que `www/`, que
 * `outils/genere-fixtures.js` produit a partir de `fixtures/base.json`.
 *
 * ⚠️ AUCUN ACCES AU NAS : voir `aide/banc.js`. Chaque essai verifie a la fin
 * qu aucun outil reseau n a ete appele. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { banc, demo, genre, RACINE } = require("./aide/banc.js");
const { fonction } = require("./aide/charge.js");

/* La fusion de la page (`fusionSysteme`, www/app.js) : elle range dans
   smart.json les grappes, les emplacements et les roles que systeme.py publie
   sous `stock`, et sur chaque conteneur l `anon` de `mem`. La demonstration
   passe par elle depuis le 03/11/2026, comme la production : ses smart.json et
   containers.json ont donc la forme exacte de ceux des collecteurs. */
const fusionSysteme = fonction("app.js", "fusionSysteme");

const outilsPresents = ["bash", "jq", "awk", "flock"].every((o) =>
  require("node:child_process").spawnSync("sh", ["-c", "command -v " + o]).status === 0);
const SAUF = outilsPresents ? false : "bash, jq, awk ou flock absent";

/** La forme d un objet : ses cles, chacune avec son type JSON. */
const forme = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, genre(o[k])]));

/** Un banc, range a la fin de l essai, avec la garde reseau. */
function avecBanc(t, reseauPermis = []) {
  const b = banc();
  t.after(() => {
    const appels = b.reseau().split("\n").filter(Boolean)
      .filter((l) => !reseauPermis.some((p) => l.startsWith(p + " ")));
    b.range();
    assert.deepEqual(appels, [], "un outil reseau a ete appele");
  });
  return b;
}

/* ---- smart.sh ------------------------------------------------------------- */

test("smart.sh : la forme exacte de www/smart.json, valeurs converties", { skip: SAUF }, (t) => {
  const b = avecBanc(t);
  const dm = demo("smart.json");
  // un releve smartctl par disque de la demonstration, dans les unites de smartctl
  const releves = dm.d.map((d) => ({
    model_name: d.modele,
    user_capacity: { bytes: d.go * 1e9 + 123456 },
    smart_status: { passed: d.ok },
    temperature: { current: d.temp },
    nvme_smart_health_information_log: {
      percentage_used: d.usure, available_spare: d.spare, power_on_hours: d.heures,
      power_cycles: d.cycles, unsafe_shutdowns: d.brutaux, media_errors: d.erreurs,
      // `ecrit` en To a deux decimales : unites de 512 000 octets
      data_units_written: Math.ceil(d.ecrit * 1e12 / 512000),
    },
  }));
  b.ecrit("releves.json", releves.map((r) => JSON.stringify(r)).join("\n") + "\n");
  // les emplacements des disques de la demonstration (`nvme1` : slot 1) ;
  // `/dev/null` existe partout, il tient lieu de controleur
  b.ecrit("nvme-slots.sh", "#!/bin/sh\n" + dm.d.map((d) => `echo "${d.n.slice(4)} null"`).join("\n") + "\n");
  fs.chmodSync(b.chemin("nvme-slots.sh"), 0o755);
  // smartctl rend les releves l un apres l autre
  b.bouchon("smartctl", `n=$(cat "${b.T}/n" 2>/dev/null || echo 1); echo $((n + 1)) > "${b.T}/n"
sed -n "\${n}p" "${b.chemin("releves.json")}"`);

  const r = b.lance("smart.sh");
  assert.equal(r.rc, 0, r.erreurs);
  const smart = b.json("www/smart.json");
  assert.deepEqual(forme(smart), forme(dm));
  assert.equal(smart.d.length, dm.d.length);
  smart.d.forEach((d, i) => {
    assert.deepEqual(forme(d), forme(dm.d[i]), "disque " + i);
    // memes valeurs que la demonstration, une fois les unites de smartctl converties
    assert.deepEqual(d, dm.d[i]);
  });
});

/* ---- containers.sh -------------------------------------------------------- */

test("containers.sh : la forme exacte de www/containers.json", { skip: SAUF }, (t) => {
  const b = avecBanc(t);
  const dm = demo("containers.json");
  const noms = dm.c.slice(0, 3).map((c) => c.n);
  const id = (i) => "id" + i;
  // l etat precedent : le premier conteneur avait redemarre 1 fois, il en est a 2
  b.ecrit("restarts.state", noms.map((n, i) => n + ";" + (i === 0 ? 1 : 0)).join("\n") + "\n");
  b.bouchon("docker", `case "$1" in
  ps) if [ "\${2:-}" = -q ]; then ${noms.map((_, i) => `echo ${id(i)}`).join("; ")}
      else ${noms.map((n, i) => `echo "${id(i)};${n}"`).join("; ")}; fi ;;
  inspect) ${noms.map((n, i) => `echo "/${n};${i === 0 ? 2 : 0};2026-11-03T10:00:00Z"`).join("; ")} ;;
  stats) ${noms.map((n, i) => `echo "${n};${i + 1}.50%;${i + 2}.25%"`).join("; ")} ;;
  *) exit 1 ;;
esac`);

  const r = b.lance("containers.sh");
  assert.equal(r.rc, 0, r.erreurs);
  const cont = b.json("www/containers.json");
  assert.deepEqual(forme(cont), forme(dm));
  assert.deepEqual(cont.c.map((c) => c.n).sort(), [...noms].sort());
  for (const c of cont.c) {
    assert.deepEqual(forme(c), forme(dm.c[0]), c.n);
    const i = noms.indexOf(c.n);
    assert.equal(c.cpu, i + 1.5);
    // `mem` est un POURCENTAGE (`MemPerc` de docker stats), que la page
    // reconvertit en Mo (`moC`) : la demonstration aussi
    assert.equal(c.mem, i + 2.25);
    assert.equal(c.rs, i === 0 ? 2 : 0);
  }
  assert.ok(dm.c.every((c) => c.mem >= 0 && c.mem <= 100), "www/containers.json : `mem` hors d un pourcentage");
  // le redemarrage (1 -> 2) entre au journal des 24 h
  assert.deepEqual(cont.ev.map((e) => e.n), [noms[0]]);
  assert.deepEqual(forme(cont.ev[0]), forme(dm.ev[0]));
});

/* ---- systeme.json : ce que la page range dans smart.json et containers.json ---- */

test("la demonstration passe par fusionSysteme : grappes, emplacements, roles et anon", () => {
  const smart = demo("smart.json"), cont = demo("containers.json"), sy = demo("systeme.json");
  fusionSysteme({ smart, cont }, sy);
  assert.ok(sy.stock.grappes.length > 0 && cont.c.length > 0, "une demonstration sans grappe ni conteneur ne prouverait rien");
  assert.deepEqual(smart.grappes, sy.stock.grappes);
  assert.deepEqual(smart.slots, sy.stock.slots);
  for (const x of smart.d) assert.equal(x.role, sy.stock.roles[x.n], x.n + " : son role");
  for (const c of cont.c) assert.equal(c.anon, sy.mem.anon[c.n], c.n + " : sa memoire reelle");
});

/** Les cles de premier niveau du dictionnaire Python qui s ouvre a `debut`. */
function clesDict(src, debut) {
  const cles = [];
  let prof = 0, chaine = null;
  for (let k = debut; k < src.length; k++) {
    const c = src[k];
    if (chaine) { if (c === "\\") k++; else if (c === chaine) chaine = null; continue; }
    if (c === "#") { k = src.indexOf("\n", k); continue; }          // commentaire
    if (c === '"' || c === "'") {
      const m = prof === 1 && /^(["'])(\w+)\1\s*:/.exec(src.slice(k, k + 80));
      if (m) { cles.push(m[2]); k += m[0].length - 1; } else chaine = c;
      continue;
    }
    if ("{[(".includes(c)) prof++;
    else if ("}])".includes(c) && --prof === 0) return cles;
  }
  throw new Error("dictionnaire non referme");
}
/** Les cles du dictionnaire que rend `def fonction` de collecteurs/systeme.py. */
function clesRendues(fonctionPy, premiere) {
  const src = fs.readFileSync(path.join(RACINE, "collecteurs", "systeme.py"), "utf8");
  const f = src.indexOf("\ndef " + fonctionPy + "(");
  const m = f < 0 ? null : new RegExp("return \\{\\s*\"" + premiere + "\"").exec(src.slice(f));
  assert.ok(m, fonctionPy + "() introuvable dans systeme.py");
  return { src, debut: f + m.index + m[0].indexOf("{"), cles: clesDict(src, f + m.index + m[0].indexOf("{")) };
}

test("www/systeme.json : `mem` et `stock` ont les cles que rend systeme.py", () => {
  const sy = demo("systeme.json");
  const tri = (l) => [...l].sort();
  assert.deepEqual(tri(Object.keys(sy.mem)), tri(clesRendues("memoire", "tot").cles));
  const st = clesRendues("stockage", "grappes");
  assert.deepEqual(tri(Object.keys(sy.stock)), tri(st.cles));
  const slots = st.src.indexOf('"slots": {', st.debut);
  assert.ok(slots > 0, "stockage() : `slots` introuvable");
  assert.deepEqual(tri(Object.keys(sy.stock.slots)), tri(clesDict(st.src, st.src.indexOf("{", slots))));
});

test("clesDict : premier niveau seulement, commentaires et chaines compris", () => {
  const py = 'return {\n  "a": f(1, {"x": 2}),  # "faux": commentaire\n  "b": "c: d", "e": [{"y": 3}],\n}';
  assert.deepEqual(clesDict(py, py.indexOf("{")), ["a", "b", "e"]);
});

/* ---- history-build.sh et history-min.sh ------------------------------------ */

/** Un history.csv de `n` lignes a la minute, 25 colonnes comme collect.sh. */
function historique(b, n, cellules = (i) => [12, 40, 55, 1000, 0.5, 48, 0, 0, 0.4, 0.3, 10, 41, 40, 39, 71, "", "", 120, 1, 500, 20, 1, 1, ""]) {
  const NOW = Math.floor(Date.now() / 1000);
  const lignes = [];
  for (let i = n - 1; i >= 0; i--) lignes.push([NOW - i * 60, ...cellules(i)].join(","));
  b.ecrit("history.csv", lignes.join("\n") + "\n");
}

/* La page lit chaque serie PAR SON NOM : un nom que le collecteur publie et que
   la demonstration n a pas, c est une courbe qu elle ne montre jamais.
   SAUF les colonnes `nvme<N>`, une par emplacement M.2 : propres a
   l installation, la page les decouvre seule et n affiche que celles qui
   portent une valeur (`disquesHist`, www/app.js ; carte Températures,
   www/cartes.js). Le NAS en a cinq, la demonstration quatre : pas un ecart. */
const parInstallation = (n) => /^nvme\d+$/.test(n);

test("history-build.sh : history.json lisible, colonnes connues de la demonstration", { skip: SAUF }, (t) => {
  const b = avecBanc(t);
  historique(b, 90);
  const r = b.lance("history-build.sh");
  assert.equal(r.rc, 0, r.erreurs);
  const out = b.json("www/history.json");
  const dm = demo("history.json");
  for (const k of ["j", "s", "champs"]) assert.equal(genre(out[k]), genre(dm[k]), k);
  // chaque point a autant de valeurs que de noms
  for (const p of out.j) assert.equal(p.length, out.champs.length);
  for (const p of out.s) assert.equal(p.length, out.champs_s.length);
  assert.equal(out.champs[0], "t");
  // la moyenne du processeur sur les creneaux : 12, la valeur ecrite
  const cpu = out.champs.indexOf("cpu");
  assert.ok(out.j.length > 0 && out.j.every((p) => p[cpu] === 12));
  // la demonstration n a pas `champs_s` : la page lit alors la serie de 7 jours
  // avec `champs` (`Hs`, www/app.js), ou chaque nom doit donc se trouver
  const inconnus = [...out.champs, ...out.champs_s].filter((n) => !dm.champs.includes(n) && !parInstallation(n));
  assert.deepEqual([...new Set(inconnus)], [], "colonnes publiees mais absentes de www/history.json");
});

test("history-min.sh : history-min.json de la forme de www/history-min.json", { skip: SAUF }, (t) => {
  const b = avecBanc(t);
  historique(b, 30);
  const r = b.lance("history-min.sh");
  assert.equal(r.rc, 0, r.erreurs);
  const out = b.json("www/history-min.json");
  const dm = demo("history-min.json");
  assert.deepEqual(Object.keys(out).sort(), Object.keys(dm).sort());
  for (const p of out.m) assert.equal(p.length, out.champs.length);
  const inconnus = out.champs.filter((n) => !dm.champs.includes(n) && !parInstallation(n));
  assert.deepEqual(inconnus, [], "colonnes publiees mais absentes de www/history-min.json");
  // les colonnes communes sont dans le meme ordre : la page lit par nom, mais
  // un ecart d ordre signalerait un collecteur et un generateur qui divergent
  const communs = out.champs.filter((n) => dm.champs.includes(n));
  assert.deepEqual(communs, dm.champs.filter((n) => out.champs.includes(n)));
});

/* ---- alerts.sh ------------------------------------------------------------- */

/** Un banc pour alerts.sh : ntfy bouchonne par `curl`, qui note ce qu il recoit. */
function bancAlertes(t, code = 200) {
  const b = avecBanc(t, ["curl"]);
  b.ecrit("tools/homepage.env", "NAS_NTFY_TOKEN=jeton-de-test\n");
  b.ecrit("collect.conf", "NAS_NTFY_URL=http://ntfy.invalid\nPAGE_URL=https://page.invalid/\n");
  // le corps de la notification sur stdin (`-d @-`), le code HTTP en sortie
  b.bouchon("curl", `echo "curl $*" >> "${b.T}/reseau.log"
for a in "$@"; do case "$prec" in -K) cat "$a" >> "${b.T}/entetes";; esac; prec=$a; done
cat >> "${b.T}/envois"; echo >> "${b.T}/envois"; printf ${code}`);
  // les collecteurs ecrivent : aucune alerte « collecte arretee »
  for (const f of ["data.json", "live.json", "systeme.json"]) b.ecrit("www/" + f, "{}");
  const envois = () => {
    const p = b.T + "/envois";
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  const etat = () => fs.readFileSync(b.T + "/nas-alerts.state", "utf8");
  return { b, envois, etat };
}
// processeur a 95 % (colonne 2) sur les 12 dernieres minutes
const chaud = () => [95, 40, 55, 1000, 0.5, 48, 0, 0, 0.4, 0.3, 10, 41, 40, 39, 71, "", "", 120, 1, 500, 20, 1, 1, ""];

test("alerts.sh : tout est sous les seuils, aucune notification", { skip: SAUF }, (t) => {
  const { b, envois } = bancAlertes(t);
  historique(b, 12);
  const r = b.lance("alerts.sh");
  assert.equal(r.rc, 0, r.erreurs);
  assert.deepEqual(envois(), []);
});

test("alerts.sh : processeur au-dessus du seuil, une notification, puis rien avant 6 h", { skip: SAUF }, (t) => {
  const { b, envois, etat } = bancAlertes(t);
  historique(b, 12, chaud);
  let r = b.lance("alerts.sh");
  assert.equal(r.rc, 0, r.erreurs);
  const e = envois();
  assert.equal(e.length, 1);
  assert.match(e[0].title, /processeur au-dessus du seuil/);
  assert.equal(e[0].priority, 4);
  // toucher la notification ouvre la carte « Système »
  assert.equal(e[0].click, "https://page.invalid/#carte=" + encodeURIComponent("Système"));
  assert.match(etat(), /^processeur\t\d+$/m);
  // ⚠️ le jeton passe par le fichier de `curl -K`, jamais par la ligne de commande
  assert.ok(!b.reseau().includes("jeton-de-test"), "jeton visible sur la ligne de commande");
  assert.match(fs.readFileSync(b.T + "/entetes", "utf8"), /Authorization: Bearer jeton-de-test/);
  // second passage : l alerte dure, la relance n est pas due
  r = b.lance("alerts.sh");
  assert.equal(r.rc, 0, r.erreurs);
  assert.equal(envois().length, 1);
});

test("alerts.sh : ntfy refuse, l alerte sera renvoyee au passage suivant", { skip: SAUF }, (t) => {
  const { b, envois, etat } = bancAlertes(t, 500);
  historique(b, 12, chaud);
  b.lance("alerts.sh");
  assert.equal(envois().length, 1);
  assert.doesNotMatch(etat(), /^processeur\t[1-9]/m, "un envoi refuse ne doit pas compter comme fait");
  b.lance("alerts.sh");
  assert.equal(envois().length, 2);
});

test("alerts.sh : moins de trois mesures, pas de faux « revenu a la normale »", { skip: SAUF }, (t) => {
  const { b, envois, etat } = bancAlertes(t);
  historique(b, 12, chaud);
  b.lance("alerts.sh");
  assert.equal(envois().length, 1);
  // la collecte s arrete : il ne reste que deux mesures recentes
  historique(b, 2);
  b.lance("alerts.sh");
  assert.equal(envois().length, 1, "notification envoyee sans mesures");
  assert.match(etat(), /^processeur\t\d+$/m, "l alerte en cours a ete oubliee");
});

test("alerts.sh : un collecteur arrete depuis plus de 10 min est signale", { skip: SAUF }, (t) => {
  const { b, envois } = bancAlertes(t);
  historique(b, 12);
  const vieux = new Date(Date.now() - 20 * 60 * 1000);
  fs.utimesSync(b.chemin("www/live.json"), vieux, vieux);
  b.lance("alerts.sh");
  const e = envois();
  assert.equal(e.length, 1);
  assert.match(e[0].title, /mesures rapides arrêtée/);
});
