/* Les courbes de niveau du fond : calculees une fois (carres marchants sur un bruit), puis
   redessinees seulement quand la taille ou l etat du homelab change. Rien ne tourne en continu. */
(() => {
  "use strict";
  const cv = document.getElementById("iso"), ctx = cv && cv.getContext("2d");
  if (!ctx) return;
  // un bruit de valeurs, le meme a chaque ouverture
  const P = new Float32Array(4096);
  let s = 41;
  for (let i = 0; i < 4096; i++) { s = (s * 1664525 + 1013904223) >>> 0; P[i] = s / 4294967296; }
  const lisse = (t) => t * t * (3 - 2 * t);
  const v = (x, y) => P[((x & 63) * 64 + (y & 63)) & 4095];
  const bruit = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), u = lisse(x - xi), w = lisse(y - yi);
    return (v(xi, yi) * (1 - u) + v(xi + 1, yi) * u) * (1 - w) + (v(xi, yi + 1) * (1 - u) + v(xi + 1, yi + 1) * u) * w;
  };
  const champ = (x, y) => bruit(x, y) * .62 + bruit(x * 2.1 + 9, y * 2.1 + 4) * .28 + bruit(x * 4.3 + 3, y * 4.3 + 7) * .1;
  const NIVEAUX = 26, PAS = 7, ECHELLE = 1 / 460;
  function dessine() {
    const l = cv.clientWidth, h = cv.clientHeight, d = Math.min(devicePixelRatio || 1, 2);
    if (!l || !h) return;
    cv.width = l * d; cv.height = h * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, l, h);
    const sante = document.body.dataset.sante;
    const coul = sante === "crit" ? "255,170,160" : sante === "warn" ? "255,214,160" : "176,196,255";
    const nx = Math.ceil(l / PAS) + 1, ny = Math.ceil(h / PAS) + 1;
    const g = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g[j * nx + i] = champ(i * PAS * ECHELLE, j * PAS * ECHELLE);
    for (let n = 1; n < NIVEAUX; n++) {
      const seuil = .12 + n * (.76 / NIVEAUX), maitre = n % 5 === 0;
      ctx.beginPath();
      for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = g[j * nx + i], b = g[j * nx + i + 1], c = g[(j + 1) * nx + i + 1], e = g[(j + 1) * nx + i];
        const k = (a > seuil ? 8 : 0) | (b > seuil ? 4 : 0) | (c > seuil ? 2 : 0) | (e > seuil ? 1 : 0);
        if (k === 0 || k === 15) continue;
        const x = i * PAS, y = j * PAS;
        const H = [x + PAS * (seuil - a) / (b - a), y], D = [x + PAS, y + PAS * (seuil - b) / (c - b)];
        const B = [x + PAS * (seuil - e) / (c - e), y + PAS], G = [x, y + PAS * (seuil - a) / (e - a)];
        const trait = (p, q) => { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); };
        switch (k) {
          case 1: case 14: trait(G, B); break;
          case 2: case 13: trait(B, D); break;
          case 3: case 12: trait(G, D); break;
          case 4: case 11: trait(H, D); break;
          case 6: case 9: trait(H, B); break;
          case 7: case 8: trait(G, H); break;
          case 5: trait(G, H); trait(B, D); break;
          case 10: trait(G, B); trait(H, D); break;
        }
      }
      ctx.strokeStyle = "rgba(" + coul + "," + (maitre ? .3 : .15) + ")";
      ctx.lineWidth = maitre ? 1.1 : .8;
      ctx.stroke();
    }
  }
  let attente = 0, largeur = 0;
  addEventListener("resize", () => {
    // sur iPhone, la barre de Safari change la hauteur au defilement : seule la largeur compte
    if (innerWidth === largeur) return;
    largeur = innerWidth;
    clearTimeout(attente);
    attente = setTimeout(dessine, 200);
  });
  new MutationObserver(dessine).observe(document.body, { attributes: true, attributeFilter: ["data-sante"] });
  largeur = innerWidth;
  dessine();
})();
