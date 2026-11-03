/* `tests/` ne part NI dans la demonstration publiee NI sur le NAS.
 *
 *   node --test tests/*.test.js
 *
 * Deux chemins de sortie existent, et ce sont les seuls :
 * - GitHub Pages televerse le SEUL dossier `www/` (`.github/workflows/pages.yml`) ;
 * - le NAS ne recoit que la liste blanche de `outils/deploie.js`, prise dans `www/`.
 * Ces essais lisent les deux fichiers SANS LES EXECUTER : `deploie.js` se
 * connecte au NAS des son lancement, meme sans `--envoie`. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RACINE = path.join(__dirname, "..");
const lit = (rel) => fs.readFileSync(path.join(RACINE, rel), "utf8");

test("tests/ est hors de www/, la seule racine publiee et deployee", () => {
  const tests = fs.realpathSync(__dirname), www = fs.realpathSync(path.join(RACINE, "www"));
  assert.ok(!tests.startsWith(www + path.sep));
  assert.ok(!fs.existsSync(path.join(www, "tests")));
});

test("pages.yml : seul www/ est televerse", () => {
  const yml = lit(".github/workflows/pages.yml");
  const chemins = [...yml.matchAll(/upload-pages-artifact@[^\n]*\n\s+with:\s*\n\s+path:\s*(\S+)/g)].map((m) => m[1]);
  assert.deepEqual(chemins, ["www"]);
});

/* `tests.yml` ne repete pas shellcheck : il compte sur `pages.yml`. Si ce
   dernier cessait de le lancer, plus rien ne verifierait les scripts du NAS. */
test("pages.yml : shellcheck sur les scripts du NAS, dont tests.yml se dispense", () => {
  const yml = lit(".github/workflows/pages.yml");
  assert.match(yml, /^\s+shellcheck -S warning collecteurs\/\*\.sh outils\/\*\.sh$/m);
  assert.match(yml, /^\s+run: bash outils\/teste-collecteurs\.sh$/m);
  assert.doesNotMatch(lit(".github/workflows/tests.yml"), /^\s+(run: )?shellcheck /m);
});

test("deploie.js : la liste blanche ne vise que www/, et rien de tests/", () => {
  const src = lit("outils/deploie.js");
  assert.match(src, /const RACINE = path\.resolve\(__dirname, "\.\.", "www"\);/);
  // les tableaux litteraux, evalues seuls : aucun code du script ne tourne
  const tableau = (nom) => {
    const m = src.match(new RegExp("const " + nom + " = (\\[[^\\]]*\\]);"));
    assert.ok(m, nom + " introuvable dans deploie.js");
    return vm.runInNewContext(m[1]);
  };
  for (const f of [...tableau("FRONT"), ...tableau("DOSSIERS")]) {
    assert.ok(!/(^|\/)tests?(\/|$)/.test(f), f);
    assert.ok(!f.includes(".."), f + " sort de www/");
    assert.ok(fs.existsSync(path.join(RACINE, "www", f)), f + " absent de www/");
  }
});

test("www/ ne charge rien de tests/", () => {
  const fichiers = fs.readdirSync(path.join(RACINE, "www"), { recursive: true })
    .filter((f) => /\.(html|js|css|json)$/.test(f));
  const fautifs = fichiers.filter((f) => /["'(/]tests\//.test(fs.readFileSync(path.join(RACINE, "www", f), "utf8")));
  assert.deepEqual(fautifs, []);
});
