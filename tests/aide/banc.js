/* Banc des collecteurs pour `node --test`, SANS LE NAS.
 *
 * Meme principe que `outils/teste-collecteurs.sh` : le script est copie dans
 * un dossier temporaire, ses chemins du NAS rediriges, et les outils qu il
 * appelle remplaces par des bouchons places EN TETE du PATH.
 *
 * ⚠️ AUCUN SCRIPT NE DOIT POUVOIR JOINDRE LE NAS NI LE RESEAU. `ssh`, `scp`,
 * `curl`, `wget`, `nc`, `ping` et `openssl` (dont `s_client` ouvre une
 * connexion) sont toujours bouchonnes : par defaut ils echouent et NOTENT
 * l appel dans `reseau.log`, que chaque essai peut relire. Un essai qui veut un
 * `curl` qui repond le remplace par le sien. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const RACINE = path.join(__dirname, "..", "..");
const COLLECTEURS = path.join(RACINE, "collecteurs");
const WWW = path.join(RACINE, "www");
const RESEAU = ["ssh", "scp", "curl", "wget", "nc", "ping", "openssl"];

function banc() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), "banc-collecteurs-"));
  const H = path.join(T, "h"), B = path.join(T, "bin"), JOURNAL = path.join(T, "reseau.log");
  fs.mkdirSync(path.join(H, "www", "data"), { recursive: true });
  fs.mkdirSync(path.join(H, "tools"), { recursive: true });
  fs.mkdirSync(B);
  fs.writeFileSync(JOURNAL, "");

  /** Un bouchon : un script bash nomme `nom`, de corps `corps`. */
  const bouchon = (nom, corps) => {
    const p = path.join(B, nom);
    fs.writeFileSync(p, "#!/bin/bash\n" + corps + "\n");
    fs.chmodSync(p, 0o755);
  };
  for (const n of RESEAU) bouchon(n, `echo "${n} $*" >> "${JOURNAL}"; exit 7`);

  /** Copie `collecteurs/<nom>`, chemins du NAS rediriges vers `H`. */
  const prepare = (nom) => {
    const src = fs.readFileSync(path.join(COLLECTEURS, nom), "utf8")
      .replaceAll("/volume1/docker/homelab", H)
      .replaceAll("/volume1/docker/tools", path.join(H, "tools"))
      .replaceAll("/var/lib/", T + "/")
      .replaceAll("/var/lock/", T + "/")
      .replaceAll("/var/log/", T + "/")
      .replaceAll("/tmp/collect-essai", T + "/collect-essai")   // `collect.sh --essai`
      .replace(/^export PATH=.*$/m, `export PATH="${B}:$PATH"`);
    const p = path.join(T, nom);
    fs.writeFileSync(p, src);
    fs.chmodSync(p, 0o755);
    return p;
  };

  /** Lance un collecteur prepare ; rend `{ rc, sortie, erreurs }`. */
  const lance = (nom, env = {}, args = []) => {
    const r = spawnSync("bash", [prepare(nom), ...args], {
      encoding: "utf8", timeout: 20000, cwd: T,
      env: { PATH: B + ":" + process.env.PATH, HOME: T, LANG: "C.UTF-8", ...env },
    });
    if (r.error) throw r.error;
    return { rc: r.status, sortie: r.stdout, erreurs: r.stderr };
  };

  const chemin = (rel) => path.join(H, rel);
  const lit = (rel) => fs.readFileSync(chemin(rel), "utf8");
  const json = (rel) => JSON.parse(lit(rel));
  const ecrit = (rel, txt) => { fs.mkdirSync(path.dirname(chemin(rel)), { recursive: true }); fs.writeFileSync(chemin(rel), txt); };
  const reseau = () => fs.readFileSync(JOURNAL, "utf8");
  const range = () => fs.rmSync(T, { recursive: true, force: true });

  return { T, H, B, bouchon, prepare, lance, chemin, lit, json, ecrit, reseau, range };
}

/** Un banc range a la fin de l essai `t`, sous GARDE RESEAU : l essai echoue
 *  si un outil reseau a ete appele, hors de ceux que `permis` attend (et que
 *  leurs bouchons ont donc recus a la place du vrai). */
function avecBanc(t, permis = []) {
  const b = banc();
  t.after(() => {
    const appels = b.reseau().split("\n").filter(Boolean)
      .filter((l) => !permis.some((p) => l.startsWith(p + " ")));
    b.range();
    assert.deepEqual(appels, [], "un outil reseau a ete appele");
  });
  return b;
}

/* Les donnees de la DEMONSTRATION, telles que Pages les publie : `www/*.json`,
   produites par `outils/genere-fixtures.js` a partir de `fixtures/base.json`.
   C est ce que la page lit, donc ce a quoi un collecteur doit ressembler.
   `fixtures/` ne garde que les sources ecrites a la main (README). */
const demo = (nom) => JSON.parse(fs.readFileSync(path.join(WWW, nom), "utf8"));
/** Le type JSON d une valeur, pour comparer des formes et non des valeurs. */
const genre = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

module.exports = { banc, avecBanc, demo, genre, RACINE };
