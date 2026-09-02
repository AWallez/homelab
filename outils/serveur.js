/* Serveur statique de developpement.
 *
 *   node outils/serveur.js            puis http://localhost:4173
 *
 * Le depot porte aussi un `compose.yml` qui reproduit le nginx de production ;
 * ce serveur existe parce que Docker n est pas installe partout, alors que Node
 * l est des qu on veut regenerer les fixtures. Les deux servent le meme dossier
 * `www/` sans aucune reecriture d URL : ce qu on voit en local est ce que
 * GitHub Pages affichera.
 *
 * ⚠️ `no-cache` sur tout ce qui est texte, comme en production. Sans ca la page
 * ne verrait jamais une fixture regeneree, et on chercherait pendant une heure
 * un bogue qui n existe pas.
 */

"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const RACINE = path.resolve(__dirname, "..", "www");
const PORT = Number(process.env.PORT) || 4173;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".webp": "image/webp",
  ".ico":  "image/x-icon"
};

const serveur = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split("?")[0]);
  if (url.endsWith("/")) url += "index.html";

  /* ⚠️ Garde-fou contre la remontee d arborescence. On resout le chemin, PUIS
     on verifie qu il reste sous la racine : un serveur de developpement finit
     toujours par etre lance depuis un endroit qu on n avait pas prevu. */
  const cible = path.resolve(RACINE, "." + url);
  if (cible !== RACINE && !cible.startsWith(RACINE + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("interdit");
    console.log("  403  " + url);
    return;
  }

  fs.readFile(cible, (err, contenu) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("introuvable : " + url);
      console.log("  404  " + url);
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(cible).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(contenu);
  });
});

serveur.on("error", (e) => {
  console.error(e.code === "EADDRINUSE"
    ? "  Le port " + PORT + " est deja pris. Relancer avec : PORT=4174 node outils/serveur.js"
    : "  " + e.message);
  process.exit(1);
});

serveur.listen(PORT, () => {
  console.log("Tableau de bord — serveur local");
  console.log("  racine  : " + RACINE);
  console.log("  adresse : http://localhost:" + PORT);
  console.log("");
  console.log("  Le selecteur de scenario apparait en bas a gauche.");
  console.log("  Lien direct : http://localhost:" + PORT + "/?demo=tout-ko");
  console.log("");
});
