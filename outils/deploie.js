/* Deploiement du front vers le NAS.
 *
 *   node outils/deploie.js              compare et n envoie rien
 *   node outils/deploie.js --envoie     depose les fichiers dans /tmp du NAS
 *
 * ⚠️ LISTE BLANCHE, PAS LISTE D EXCLUSIONS. `www/` contient a la fois le front
 * et les fixtures generees, et ces dernieres portent EXACTEMENT les noms des
 * fichiers que les collecteurs ecrivent en production : `data.json`,
 * `history.json`, `live.json`… Un script qui se contenterait d exclure ce qu il
 * connait laisserait passer la fixture ajoutee six mois plus tard et
 * remplacerait de vraies mesures par des donnees inventees. Ici, ce qui n est
 * pas nomme ne part pas.
 *
 * ⚠️ `fixtures/scenarios.json` NE DOIT JAMAIS ARRIVER SUR LE NAS : sa seule
 * presence active le mode demonstration. Verifie une seconde fois cote NAS,
 * avant que quoi que ce soit ne bouge.
 *
 * ⚠️ LE SCRIPT N INSTALLE PAS LUI-MEME. `www/` appartient a root : il depose
 * dans /tmp et rend une commande `sudo` a lancer.
 */

"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const RACINE = path.resolve(__dirname, "..", "www");
const CIBLE = "/volume1/docker/homelab/www";
const DEPOT = "/tmp/deploiement";
const HOTE = "nas";
const ENVOIE = process.argv.includes("--envoie");

/* La liste blanche. Un fichier absent d ici ne sera jamais deploye. */
const FRONT = ["index.html", "app.js", "style.css", "fond.css"];
const DOSSIERS = ["icons"];

/* Noms interdits, verifies malgre la liste blanche : deux garde-fous valent
   mieux qu un quand l erreur consiste a ecraser des mesures irremplacables. */
const INTERDITS = /^(data|live|history|history-min|containers|containers-hist|smart|updates|ratios)\.json$|^fixtures\//;

/* ⚠️ LE CHEMIN DE `ssh` EST EXPLICITE SOUS WINDOWS. Git Bash embarque son
   propre `ssh`, qui ne sait PAS parler a l agent de Windows : la cle vit dans
   Vaultwarden et c est l agent de Bitwarden qui la presente, sur le tube
   \\.\pipe\openssh-ssh-agent que seul l OpenSSH de Windows interroge. Lance
   depuis Git Bash sans cette precaution, le script annonce « NAS injoignable »
   alors que la connexion marche parfaitement depuis PowerShell. Vecu deux fois
   le 01/09/2026. */
const WIN = process.platform === "win32";
const bin = (n) => {
  const p = "C:\\Windows\\System32\\OpenSSH\\" + n + ".exe";
  return (WIN && fs.existsSync(p)) ? p : n;
};
const SSH = bin("ssh"), SCP = bin("scp");

const md5 = (p) => crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex");
const ssh = (cmd) => execFileSync(SSH, ["-o", "ConnectTimeout=10", HOTE, cmd],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/* ---- inventaire local --------------------------------------------------- */
const fichiers = [];
for (const f of FRONT) {
  const p = path.join(RACINE, f);
  if (!fs.existsSync(p)) { console.log("  ABSENT en local : " + f); process.exit(1); }
  fichiers.push(f);
}
for (const d of DOSSIERS)
  for (const f of fs.readdirSync(path.join(RACINE, d), { withFileTypes: true }))
    if (f.isFile()) fichiers.push(d + "/" + f.name);

const fautifs = fichiers.filter(f => INTERDITS.test(f));
if (fautifs.length) {
  console.log("  ARRET : la liste blanche laisse passer un fichier interdit :");
  fautifs.forEach(f => console.log("    " + f));
  process.exit(1);
}

/* ⚠️ `services.js` EST VOLONTAIREMENT ABSENT DE LA LISTE BLANCHE. Il porte la
   configuration du site — adresse, ports, noms de services, liens — et la copie
   du depot est ANONYMISEE : la deployer ecraserait la vraie configuration du
   NAS par des donnees fictives. Il se copie donc une seule fois, a la main.
   Mais `app.js` en depend : sans lui, `GROUPS` est indefini et la page reste
   blanche. On refuse donc de deployer tant que le NAS ne l a pas. */
function verifieServices() {
  try {
    const r = ssh("test -f " + CIBLE + "/services.js && echo present || echo absent");
    if (r.trim() === "present") return;
  } catch (e) { return; }   // NAS injoignable : le message viendra plus bas
  console.log("  ARRET : le NAS n a pas `services.js`, dont `app.js` depend.");
  console.log("  A copier UNE FOIS, depuis le poste :");
  console.log("      scp -O www/services.js nas:/tmp/ && ssh nas \\");
  console.log("        \"sudo install -o root -g root -m 644 /tmp/services.js " + CIBLE + "/\"");
  process.exit(1);
}

/* ---- comparaison avec le NAS -------------------------------------------- */
console.log("Deploiement du front vers " + HOTE + ":" + CIBLE);
console.log("  " + fichiers.length + " fichiers dans la liste blanche\n");

let distant = {};
try {
  const sortie = ssh("cd " + CIBLE + " && md5sum " + fichiers.map(f => "'" + f + "'").join(" ") + " 2>/dev/null");
  for (const l of sortie.split("\n")) {
    const m = /^([0-9a-f]{32})\s+(.+)$/.exec(l.trim());
    if (m) distant[m[2]] = m[1];
  }
} catch (e) {
  console.log("  Le NAS est injoignable. Coffre Bitwarden verrouille ?");
  process.exit(1);
}

verifieServices();

const change = [], neufs = [], egaux = [];
for (const f of fichiers) {
  const local = md5(path.join(RACINE, f));
  if (!distant[f]) neufs.push(f);
  else if (distant[f] !== local) change.push(f);
  else egaux.push(f);
}

console.log("  identiques : " + egaux.length);
if (neufs.length) { console.log("  nouveaux   : " + neufs.length); neufs.forEach(f => console.log("      + " + f)); }
if (change.length) { console.log("  modifies   : " + change.length); change.forEach(f => console.log("      ~ " + f)); }

const aEnvoyer = neufs.concat(change);
if (!aEnvoyer.length) { console.log("\n  Le NAS est deja a jour."); process.exit(0); }

if (!ENVOIE) {
  console.log("\n(comparaison seule — ajouter --envoie pour deposer sur le NAS)");
  process.exit(0);
}

/* ---- depot dans /tmp ---------------------------------------------------- */
console.log("\n  depot dans " + HOTE + ":" + DEPOT);
ssh("rm -rf " + DEPOT + " && mkdir -p " + DEPOT + "/icons");
for (const f of aEnvoyer) {
  execFileSync(SCP, ["-O", "-q", path.join(RACINE, f), HOTE + ":" + DEPOT + "/" + f],
    { stdio: ["ignore", "pipe", "pipe"] });
  console.log("      -> " + f);
}

/* Le script d installation part avec les fichiers : il refait les controles
   COTE NAS, la ou ils comptent vraiment. */
const installe = `#!/bin/bash
# Installe les fichiers deposes par outils/deploie.js. A lancer en root.
set -uo pipefail
DEPOT=${DEPOT}
CIBLE=${CIBLE}
SAUVE=/tmp/deploiement-sauvegarde-$(date +%Y%m%d-%H%M%S)

# ⚠️ SECOND CONTROLE, cote NAS. Le premier a eu lieu sur le poste ; celui-ci
# protege contre un depot fabrique autrement que par le script.
if find "$DEPOT" -name 'scenarios.json' -o -name 'data.json' -o -name 'history*.json' \\
        -o -name 'live.json' -o -name 'containers*.json' -o -name 'smart.json' \\
        -o -name 'updates.json' -o -name 'ratios.json' | grep -q .; then
  echo "ARRET : le depot contient une fixture. Rien n a ete installe." >&2
  exit 1
fi

mkdir -p "$SAUVE"
n=0
while IFS= read -r -d '' f; do
  rel=\${f#$DEPOT/}
  [ -f "$CIBLE/$rel" ] && { mkdir -p "$SAUVE/$(dirname "$rel")"; cp -p "$CIBLE/$rel" "$SAUVE/$rel"; }
  install -D -o root -g root -m 644 "$f" "$CIBLE/$rel"
  echo "  installe : $rel"
  n=$((n+1))
done < <(find "$DEPOT" -type f ! -name 'installe.sh' -print0)

echo
echo "  $n fichier(s) installe(s), proprietaire root:root, droits 644"
echo "  sauvegarde des versions precedentes : $SAUVE"
echo "  ⚠️ Cette sauvegarde est dans /tmp, PAS dans www/ : c est deliberé,"
echo "     l accumulation de .avant-* dans www/ avait fini par y laisser 96 fichiers."
`;

fs.writeFileSync(path.join(__dirname, ".installe.tmp"), installe);
execFileSync(SCP, ["-O", "-q", path.join(__dirname, ".installe.tmp"), HOTE + ":" + DEPOT + "/installe.sh"],
  { stdio: ["ignore", "pipe", "pipe"] });
fs.unlinkSync(path.join(__dirname, ".installe.tmp"));
ssh("chmod 755 " + DEPOT + "/installe.sh");

console.log("\n  " + aEnvoyer.length + " fichier(s) deposes. Pour installer, sur le NAS :\n");
console.log("      sudo " + DEPOT + "/installe.sh\n");
