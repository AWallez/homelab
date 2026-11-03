/* Les fonctions pures de `www/rangement.js`, chargees telles quelles (node:vm).
 *
 *   node --test tests/*.test.js
 *
 * Deux sortes d essais : des valeurs exactes sur les petites fonctions (grille,
 * ordre, tuiles), et des PROPRIETES sur les rangements (aucune carte hors du
 * groupe, aucun chevauchement, un groupe « plein » sans case vide, des rangees
 * qui couvrent toute la largeur). Les proprietes ne figent pas les choix du
 * rangement : elles restent vraies quand ses couts changent. Les cartes viennent
 * de `www/cartes.js` (GROUPS, tailleDe), celles que la page range vraiment. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { charge, nu } = require("./aide/charge.js");

const { lire } = charge(["site.js", "cartes.js", "rangement.js"]);
const R = lire("RANGEMENT"), GROUPS = lire("GROUPS"), tailleDe = lire("tailleDe");

/** Les groupes de la page, comme `bento()` (app.js) les donne au rangement. */
const groupesDeLaPage = (alerte = () => false) => GROUPS.map((g, i) => ({
  id: i, cartes: g.s.map((s) => ({ id: s.n, s, t: tailleDe(s), niveau: s.niveau, alerte: alerte(s) })),
}));

/** Verifie un groupe range sur `w` colonnes et `H` demi-rangees. */
function verifieGroupe(places, w, H, ids, plein, quoi) {
  assert.deepEqual([...places.map((p) => p.id)].sort(), [...ids].sort(), quoi + " : chaque carte une fois");
  const occ = new Map();
  for (const p of places) {
    assert.ok(p.w >= 1 && p.h >= 1, quoi + " : " + p.id + " a une taille");
    assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= w && p.y + p.h <= H,
      quoi + " : " + p.id + " sort du groupe (" + JSON.stringify(p) + ", " + w + "x" + H + ")");
    for (let y = p.y; y < p.y + p.h; y++)
      for (let x = p.x; x < p.x + p.w; x++) {
        const k = x + "," + y;
        assert.ok(!occ.has(k), quoi + " : " + p.id + " chevauche " + occ.get(k));
        occ.set(k, p.id);
      }
  }
  if (plein) assert.equal(occ.size, w * H, quoi + " : case vide dans un groupe annonce plein");
}

test("les verifications elles-memes : chevauchement, debordement, case vide", () => {
  const p = (id, x, y, w, h) => ({ id, x, y, w, h });
  assert.doesNotThrow(() => verifieGroupe([p("a", 0, 0, 2, 2), p("b", 2, 0, 2, 2)], 4, 2, ["a", "b"], true, "bon"));
  assert.throws(() => verifieGroupe([p("a", 0, 0, 3, 2), p("b", 2, 0, 2, 2)], 4, 2, ["a", "b"], false, "x"), /chevauche/);
  assert.throws(() => verifieGroupe([p("a", 0, 0, 2, 2), p("b", 3, 0, 2, 2)], 4, 2, ["a", "b"], false, "x"), /sort du groupe/);
  assert.throws(() => verifieGroupe([p("a", 0, 0, 2, 2)], 4, 2, ["a"], true, "x"), /case vide/);
  assert.throws(() => verifieGroupe([p("a", 0, 0, 2, 2)], 4, 2, ["a", "b"], false, "x"), /chaque carte/);
});

/* ---- grille, largeur, hauteur --------------------------------------------- */

test("grille : un multiple de 4 modules, de 4 a 24, d au moins 80 px", () => {
  for (let W = 200; W <= 4000; W += 37) {
    const { P, m } = R.grille(W);
    assert.equal(P % 4, 0, "W=" + W);
    assert.ok(P >= 4 && P <= 24, "W=" + W);
    // les modules et leurs espaces font exactement la largeur
    assert.ok(Math.abs(P * m + (P - 1) * R.ESPACE - W) < 1e-9, "W=" + W);
    // au-dela du telephone (4 modules imposes), jamais sous 80 px
    if (P > 4) assert.ok(m >= 80, "W=" + W + " : module de " + m);
  }
});

test("grille : les paliers annonces (telephone, tablette, portable, grand ecran)", () => {
  assert.equal(R.grille(360).P, 4);
  assert.equal(R.grille(768).P, 8);
  assert.equal(R.grille(1160).P, 12);
  assert.equal(R.grille(2560).P, 24);
  assert.equal(R.grille(10000).P, 24);   // jamais plus de 24
});

test("largeur et hauteur : modules et demi-rangees, espaces compris", () => {
  assert.equal(R.largeur(1, 80), 80);
  assert.equal(R.largeur(3, 80), 3 * 80 + 2 * 12);
  // les valeurs du commentaire de cartes.js : 2 font 100 px, 4 font 212, 6 font 324, 8 font 436
  assert.deepEqual([2, 4, 6, 8].map(R.hauteur), [100, 212, 324, 436]);
});

/* ---- options : les formes d une carte -------------------------------------- */

test("options : triees par cout, dans le groupe, hors formes ecartees", () => {
  const s = GROUPS[0].s[0];
  const c = { id: s.n, t: tailleDe(s), niveau: s.niveau };
  const o = nu(R.options(c, 12, 86));
  assert.ok(o.length > 0);
  for (let i = 1; i < o.length; i++) assert.ok(o[i - 1].cout <= o[i].cout);
  for (const f of o) assert.ok(f.w >= 1 && f.w <= 12);
  const ex = new Set([o[0].w + "x" + o[0].h]);
  const o2 = nu(R.options({ ...c, exclues: ex }, 12, 86));
  assert.ok(!o2.some((f) => f.w + "x" + f.h === [...ex][0]), "la forme ecartee revient");
});

test("options : une carte en alerte coute plus a deformer qu une secondaire", () => {
  const t = tailleDe({ taille: "moyenne" });
  const cout = (c) => Math.max(...R.options(c, 12, 86).map((f) => f.cout));
  assert.ok(cout({ id: "a", t, niveau: "secondaire", alerte: true }) > cout({ id: "b", t, niveau: "secondaire" }));
});

test("options : rien ne tient (ecran trop etroit), toute la largeur", () => {
  const t = tailleDe({ taille: "large" });   // 560 px au moins
  const o = nu(R.options({ id: "x", t, niveau: "normale" }, 2, 80));
  assert.ok(o.length >= 1);
  assert.ok(o.every((f) => f.w <= 2));
});

/* ---- l ordre dans un groupe ----------------------------------------------- */

test("ordonne : alerte, puis niveau, puis usage par paliers de 3, puis ordre declare", () => {
  const c = (id, niveau, alerte) => ({ id, niveau, alerte });
  const cartes = [c("a", "secondaire"), c("b", "normale"), c("c", "essentielle"),
                  c("d", "normale"), c("e", "secondaire", true), c("f", "normale")];
  const ids = (u) => nu(R.ordonne(cartes, u)).map((x) => x.id).join("");
  assert.equal(ids({}), "ecbdfa");
  // 2 ouvertures ne passent pas le palier de 3 : rien ne bouge
  assert.equal(ids({ f: 2 }), "ecbdfa");
  // 3 ouvertures : f passe devant les autres normales, pas devant l essentielle
  assert.equal(ids({ f: 3 }), "ecfbda");
  // l usage ne fait jamais passer une secondaire devant une normale
  assert.equal(ids({ a: 99 }), "ecbdfa");
  // un niveau inconnu compte comme « normale »
  assert.equal(nu(R.ordonne([c("x", "secondaire"), c("y", "?"), c("z", "normale")], {})).map((x) => x.id).join(""), "yzx");
});

test("ordonne : ne modifie pas le tableau recu", () => {
  const cartes = [{ id: "a", niveau: "secondaire" }, { id: "b", niveau: "essentielle" }];
  R.ordonne(cartes, {});
  assert.deepEqual(cartes.map((x) => x.id), ["a", "b"]);
});

/* ---- un groupe ------------------------------------------------------------- */

test("rangerGroupe : chaque groupe de la page, sans chevauchement, plein s il le dit", () => {
  for (const g of groupesDeLaPage())
    for (const C of [4, 8, 12, 16]) {
      const r = nu(R.rangerGroupe(g.cartes, C, 86));
      verifieGroupe(r.places, C, r.H, g.cartes.map((c) => c.id), !r.trous, GROUPS[g.id].n + " sur " + C);
    }
});

test("rangerGroupe : sans rangement plein possible, le secours garde toutes les cartes", () => {
  // trois cartes de 3 modules minimum dans 4 colonnes : jamais pleines a cote
  const t = tailleDe({ taille: "petite", ajuste: { formes: { 4: [250, 300] } } });
  const cartes = ["a", "b", "c"].map((id) => ({ id, t, niveau: "essentielle" }));
  const r = nu(R.rangerGroupe(cartes, 4, 86));
  verifieGroupe(r.places, 4, r.H, ["a", "b", "c"], !r.trous, "secours");
});

/* ---- la page -------------------------------------------------------------- */

function verifiePage(p, groupes, W, quoi) {
  assert.equal(p.P, R.grille(W).P, quoi);
  const vus = [];
  for (const r of p.rangees) {
    let x = 0;
    for (const g of r.groupes) {
      assert.equal(g.x, x, quoi + " : groupes contigus");
      assert.equal(g.H, r.H, quoi + " : meme hauteur dans une rangee");
      x += g.w;
      if (g.id === "tete") { assert.ok(r.coins); continue; }
      vus.push(g.id);
      const cartes = groupes.find((x) => x.id === g.id).cartes;
      verifieGroupe(g.places, g.w, g.H, cartes.map((c) => c.id), !g.trous, quoi + ", groupe " + g.id);
    }
    assert.equal(x, p.P, quoi + " : une rangee couvre toute la largeur");
    assert.ok(r.groupes.length >= 1 && r.groupes.length <= 3, quoi);
  }
  assert.deepEqual(vus, nu(groupes.map((g) => g.id)), quoi + " : tous les groupes, dans leur ordre");
}

for (const W of [360, 768, 1160, 1600, 2560])
  test("rangerPage a " + W + " px : la page entiere tient", () => {
    const groupes = groupesDeLaPage();
    verifiePage(nu(R.rangerPage(groupes, W)), groupes, W, W + " px");
  });

test("rangerPage : des cartes en alerte ne cassent pas le rangement", () => {
  // une carte sur deux en alerte : les formes changent de cout, pas de validite
  let i = 0;
  const groupes = groupesDeLaPage(() => i++ % 2 === 0);
  verifiePage(nu(R.rangerPage(groupes, 1280)), groupes, 1280, "alertes");
});

test("rangerPage avec coins : l en-tete au milieu, les deux premiers groupes de part et d autre", () => {
  const groupes = groupesDeLaPage();
  const p = nu(R.rangerPage(groupes, 2560, { coins: { px: 500, Hmin: 4 } }));
  verifiePage(p, groupes, 2560, "coins");
  const r = p.rangees[0];
  assert.equal(r.coins, true);
  assert.deepEqual(r.groupes.map((g) => g.id), [0, "tete", 1]);
  assert.equal(r.groupes[0].w, r.groupes[2].w, "des coins egaux");
  assert.ok(r.H >= 4 && r.H <= 6, "a la hauteur de l en-tete, ou un peu plus");
  // l en-tete : un nombre PAIR de modules qui couvre sa largeur, au module
  // d une rangee de trois (`ENTRE` entre les groupes)
  const tete = r.groupes[1], { P } = R.grille(2560);
  const m3 = (2560 - R.ESPACE * (P - 3) - R.ENTRE * 2) / P;
  assert.equal(tete.w % 2, 0);
  assert.ok(R.largeur(tete.w, m3) >= 500, "l en-tete deborde de sa place");
  assert.ok(R.largeur(tete.w - 2, m3) < 500, "l en-tete prend plus que necessaire");
});

test("rangerPage avec coins impossibles : le rangement ordinaire", () => {
  const groupes = groupesDeLaPage();
  // un en-tete plus large que l ecran ne laisse aucun coin
  const p = nu(R.rangerPage(groupes, 1280, { coins: { px: 5000, Hmin: 4 } }));
  assert.ok(!p.rangees.some((r) => r.coins));
  verifiePage(p, groupes, 1280, "coins impossibles");
});

/* ---- le mode Compact ------------------------------------------------------ */

test("rangerTuiles : chaque groupe a la place de ses tuiles, rangees de meme hauteur", () => {
  const groupes = GROUPS.map((g, i) => ({ id: i, n: g.s.length, kmin: 2 }));
  for (const W of [360, 768, 1280, 2560]) {
    const { Cmax, rangs } = nu(R.rangerTuiles(groupes, W));
    assert.deepEqual(rangs.flatMap((r) => r.groupes.map((g) => g.id)), nu(groupes.map((g) => g.id)), W + " px");
    for (const r of rangs) {
      assert.ok(r.C <= Cmax, W + " px : pas plus de colonnes que la largeur n en admet");
      assert.equal(r.groupes.reduce((s, g) => s + g.k, 0), r.C, W + " px");
      for (const g of r.groupes) {
        assert.ok(g.k * r.L >= groupes[g.id].n, W + " px : le groupe " + g.id + " a assez de cases");
        assert.ok(g.k >= Math.min(Cmax, 2), W + " px : kmin respecte");
      }
    }
  }
});

test("rangerTuiles : les groupes vides sont ignores, une page vide ne plante pas", () => {
  assert.deepEqual(nu(R.rangerTuiles([{ id: "a", n: 0 }], 1000)).rangs, []);
  const r = nu(R.rangerTuiles([{ id: "a", n: 0 }, { id: "b", n: 3 }], 1000));
  assert.deepEqual(r.rangs.flatMap((x) => x.groupes.map((g) => g.id)), ["b"]);
});

test("rangerTuiles : `court` seulement quand on le demande", () => {
  const g = [{ id: "a", n: 1 }];
  assert.ok(!nu(R.rangerTuiles(g, 2000)).rangs[0].court);
  assert.ok(nu(R.rangerTuiles(g, 2000, { court: true })).rangs[0].court);
});

/* ---- l usage, avec un stockage simule ------------------------------------- */

test("noter et usage : compte par carte, stockage refuse sans erreur", () => {
  const memoire = new Map();
  const localStorage = {
    getItem: (k) => (memoire.has(k) ? memoire.get(k) : null),
    setItem: (k, v) => memoire.set(k, String(v)),
  };
  const { lire: l } = charge(["rangement.js"], { localStorage });
  const U = l("RANGEMENT");
  U.noter("Jellyfin"); U.noter("Jellyfin"); U.noter("Sonarr");
  assert.deepEqual(nu(U.usage()), { Jellyfin: 2, Sonarr: 1 });
  // le score est fige pour la semaine : une ouverture de plus ne change rien
  U.noter("Sonarr");
  assert.deepEqual(nu(U.usage()), { Jellyfin: 2, Sonarr: 1 });

  const refuse = { getItem() { throw new Error("refuse"); }, setItem() { throw new Error("refuse"); } };
  const { lire: l2 } = charge(["rangement.js"], { localStorage: refuse });
  assert.doesNotThrow(() => l2("RANGEMENT").noter("x"));
  assert.deepEqual(nu(l2("RANGEMENT").usage()), {});
});

test("VERSION : une date, qui entre dans les cles des rangements gardes", () => {
  assert.match(R.VERSION, /^\d{4}-\d{2}-\d{2}$/);
});
