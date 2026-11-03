/* Charge des scripts de `www/` SANS LES MODIFIER. Ce sont des scripts de page
   (des `const` au niveau du fichier, aucun `export`) : `require` ne les lit pas.
   On les execute donc dans un contexte `node:vm` partage, comme le navigateur
   les execute l un apres l autre dans la meme page, puis on lit les noms voulus.
   Le contexte n a ni `window` ni `document` : un script qui en aurait besoin des
   son chargement echouerait ici, et ce serait le signe d un test mal choisi. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const WWW = path.join(__dirname, "..", "..", "www");

/** Execute `fichiers` (relatifs a `www/`) dans un meme contexte et rend
 *  `{ ctx, lire(nom) }`. `globaux` : ce que le contexte doit offrir en plus. */
function charge(fichiers, globaux = {}) {
  const ctx = vm.createContext({ console, ...globaux });
  for (const f of fichiers)
    vm.runInContext(fs.readFileSync(path.join(WWW, f), "utf8"), ctx, { filename: "www/" + f });
  // un `const` de script n est pas une propriete du global : on l evalue par son nom
  return { ctx, lire: (nom) => vm.runInContext(nom, ctx) };
}

/* Les objets nes dans le contexte ont leurs propres `Object` et `Array` :
   `assert.deepStrictEqual` les jugerait differents d objets identiques crees
   ici. On les fait passer par JSON avant de comparer. */
const nu = (v) => JSON.parse(JSON.stringify(v));

module.exports = { charge, nu, WWW };
