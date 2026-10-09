/* Icones de l ecran d accueil (iPhone, installation), tirees du favicon :
 *
 *   node outils/icones-app.js
 *
 * Ecrit www/icons/app-180.png (apple-touch-icon), app-192.png et app-512.png
 * (manifeste). Les deux barres du favicon sur fond plein : iOS arrondit les
 * coins lui-meme et peint en noir toute transparence, d ou un fond qui va
 * jusqu aux bords.
 * ⚠️ Les barres tiennent dans le cercle central de 80 % : l icone sert aussi de
 * « maskable » (Android la decoupe en cercle ou en goutte) sans rien perdre.
 * PNG ecrit a la main (zlib de Node), sans dependance ; sur-echantillonnage
 * 4 x 4 pour des bords lisses. */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const FOND = [0x07, 0x08, 0x0c];
/* En unites du favicon (viewBox 32) : x, y, largeur, hauteur, rayon, couleur. */
const BARRES = [[7, 8, 18, 6, 2, [0x0e, 0x8c, 0x8a]], [7, 18, 18, 6, 2, [0x26, 0x70, 0xd6]]];

const dans = (px, py, [x, y, w, h, r]) => {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r), cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
};

function png(n) {
  const S = 4, k = 32 / n, lignes = [];
  for (let j = 0; j < n; j++) {
    const l = Buffer.alloc(1 + n * 3);
    for (let i = 0; i < n; i++) {
      const acc = [0, 0, 0];
      for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) {
        const px = (i + (a + .5) / S) * k, py = (j + (b + .5) / S) * k;
        const bar = BARRES.find(z => dans(px, py, z));
        const c = bar ? bar[5] : FOND;
        for (let q = 0; q < 3; q++) acc[q] += c[q];
      }
      for (let q = 0; q < 3; q++) l[1 + i * 3 + q] = Math.round(acc[q] / (S * S));
    }
    lignes.push(l);
  }
  const bloc = (type, data) => {
    const t = Buffer.from(type), lg = Buffer.alloc(4); lg.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])));
    return Buffer.concat([lg, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc("IHDR", ihdr),
    bloc("IDAT", zlib.deflateSync(Buffer.concat(lignes), { level: 9 })), bloc("IEND", Buffer.alloc(0))]);
}

const OUT = path.join(__dirname, "..", "www", "icons");
for (const n of [180, 192, 512]) {
  const p = path.join(OUT, "app-" + n + ".png");
  fs.writeFileSync(p, png(n));
  console.log("  " + path.basename(p).padEnd(14) + String(fs.statSync(p).size).padStart(7) + " o");
}
