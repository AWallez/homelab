/* ============ RANGEMENT EN BENTO (17/10/2026) ============
   Range les cartes de chaque groupe en un rectangle sans trou, et les groupes
   eux-memes en rangees, a partir des formes declarees dans cartes.js
   (`tailleDe`). Du calcul pur, sauf `verifie`, qui regarde une carte deja
   affichee. Sert a la page (app.js) et a l onglet « Disposition » de l atelier.

   LA GRILLE
   - en largeur, des MODULES : un multiple de 4 (4 sur telephone, 8 sur
     tablette, 12 sur portable, 16 a 24 sur grand ecran), chacun d au moins
     80 px, 12 px d espace ;
   - en hauteur, des DEMI-RANGEES de 44 px (12 px d espace), comme `data-h`.

   L ORDRE DANS UN GROUPE (decide le 13/10/2026)
   les alertes d abord, tant qu elles durent ; puis le niveau (essentielle,
   normale, secondaire) ; puis l usage, seulement entre cartes de meme niveau ;
   puis l ordre declare. Une carte peut ensuite avancer de DEUX places au plus
   pour boucher un trou.

   LES TAILLES
   chaque carte part de sa forme ideale ; s en ecarter coute, d autant plus que
   la carte compte (essentielle ou en alerte : presque intouchable ; secondaire :
   c est elle qui s etire). Le rangement plein (aucune case vide) le moins
   couteux gagne ; s il n en existe aucun, un trou est accepte en fin de groupe.

   LA METHODE (prototype du 13/10, repris) : on remplit toujours la PREMIERE
   CASE VIDE (de gauche a droite, de haut en bas) en essayant les prochaines
   cartes et leurs formes, recherche exhaustive bornee, pour chaque hauteur de
   groupe possible. Les groupes se rangent ensuite en rangees de 1 a 3 groupes
   de meme hauteur (programmation dynamique). */
const RANGEMENT = (() => {
  const ESPACE = 12, RANGEE = 44, MODULE_MIN = 80, MODULES_MAX = 24;
  /* ⚠️ LA VERSION DU RANGEMENT : a changer a chaque modification qui change ses
     resultats. Elle entre dans les cles des rangements gardes (navigateur,
     `homelab.bento`) et prepares : sans elle, un rangement calcule par l ancien
     code revenait tel quel (17/10/2026 : des coins absents, gardes d avant). */
  const VERSION = "2026-10-18b";
  /* L ECART ENTRE DEUX GROUPES (17/10/2026, demande) : le MEME dans
     les deux sens, pour distinguer les groupes d un coup d oeil (12 px, celui
     des cartes, les fondait l un dans l autre). Entre deux rangees, le titre du
     groupe du dessous est POSE DANS cet ecart au lieu de s y ajouter : 8 px,
     le titre (25), 7 px jusqu a ses cartes = 40 (44 essaye, resserre a la
     demande). Mesure : 12, 28 ou 44 donnaient les memes rangements,
     sauf a 1 376 px (Reseau et Bureau l un sous l autre) et 1 821 px (cote a
     cote).
     ⚠️ Repris tel quel par le CSS (bento/base.css et style.css : `gap` de
     #groups, marges des groupes et des titres) : a changer partout. */
  const ENTRE = 40;
  const REF = 92;        // module des largeurs ideales (`l`, en modules de 92 px)
  const COUT = { elargie: 2, retrecie: 4, haute: 3, basse: 5, ordre: 2 };
  const POIDS = { essentielle: 4, normale: 1.5, secondaire: 0.7 };
  const PAR_RANGEE = 1.2;  // cout d une demi-rangee de page : le plus compact gagne a cout egal
  const FENETRE = 3;       // une carte peut passer devant les deux suivantes
  const BUDGET = 6000;     // essais au plus par hauteur de groupe
  /* ⚠️ La moitie des hauteurs essayees n admettent AUCUN rangement plein, et
     leur recherche epuisait tout le budget pour rien (la moitie du calcul,
     mesure le 17/10). Un rangement possible se trouve presque toujours vite :
     sans rien apres 1 500 essais, on abandonne. Et un rangement a moins d un
     point du meilleur cout imaginable (chaque carte a sa forme la moins chere)
     ne sera pas battu de beaucoup : on s arrete la. */
  const BUDGET_PREMIER = 1500;

  const largeur = (w, m) => w * m + (w - 1) * ESPACE;
  const hauteur = (h) => h * RANGEE + (h - 1) * ESPACE;
  /** Modules d une largeur de `W` px : `{ P, m }` (nombre, largeur d un module). */
  function grille(W) {
    const P = Math.min(MODULES_MAX, Math.max(4, 4 * Math.floor((W + ESPACE) / (4 * (MODULE_MIN + ESPACE)))));
    return { P, m: (W - ESPACE * (P - 1)) / P };
  }

  /* Les formes d une carte dans un groupe de `C` colonnes de `m` px, de la
     moins couteuse a la plus couteuse. Une carte : `{ id, t, niveau, alerte,
     exclues }`, `t` venant de `tailleDe`, `exclues` les formes que la page a
     vues deborder ou rester vides (« 3x5 »). */
  /* `elastique` : DERNIER RECOURS avant un trou. Si aucun rangement plein
     n existe, une carte peut s elargir AU-DELA de sa largeur maximale, a un cout
     tel que seules les secondaires (puis les normales) s y resolvent : une carte
     un peu vide vaut mieux qu un trou (revue, 17/10).
     ⚠️ COUT AU CARRE des modules en trop (18/10/2026) : au cout lineaire, une
     seule carte prenait tout l excedent d une rangee, aussi cher que de le
     partager. Bureau seul sur 24 modules (demonstration, 2 560 px) :
     WireGuard sur 16 modules, 1 553 px pour trois appareils. Au carre,
     l excedent se repartit entre les cartes. Et 30 par module au lieu de 15 :
     a 15, Bureau seul et etire (164) battait encore Bureau a cote de Reseau,
     plein (168). */
  const AU_DELA = 30;
  /* `c.minH` (Map largeur en px → demi-rangees) : la page a vu la carte
     DEBORDER a cette largeur, et de combien. A cette largeur ou moins, plus
     basse n y tient pas. Le cas du telephone (textes a 11 px) et d un contenu
     plus long que le pire prevu. */
  function options(c, C, m, elastique) {
    const t = c.t, hi = t.h[1];
    const wi = Math.max(1, Math.min(C, Math.round((largeur(t.l, REF) + ESPACE) / (m + ESPACE))));
    const k = c.alerte ? POIDS.essentielle : POIDS[c.niveau] || 1;
    const bas = (w) => {
      const l = largeur(w, m);
      let n = 0;
      if (c.minH) for (const [x, v] of c.minH) if (x >= l - 1) n = Math.max(n, v);
      return n;
    };
    const liste = (au) => {
      const l0 = [];
      for (const [hs, f] of Object.entries(t.formes)) {
        const h = +hs;
        for (let w = 1; w <= C; w++) {
          const l = largeur(w, m);
          if (l < f.min - 0.5 || h < bas(w) || (c.exclues && c.exclues.has(w + "x" + h))) continue;
          const trop = l > f.max + 0.5 ? Math.ceil((l - f.max) / (m + ESPACE)) : 0;
          if (trop && !au) continue;
          l0.push({ w, h, trop, cout: k * ((w > wi ? (w - wi) * COUT.elargie : (wi - w) * COUT.retrecie)
                                    + (h > hi ? (h - hi) * COUT.haute : (hi - h) * COUT.basse) + trop * trop * AU_DELA) });
        }
      }
      return l0;
    };
    let res = liste(elastique);
    /* ⚠️ AUCUNE LARGEUR ENTIERE ENTRE LES BORNES (18/10/2026) : a 1 280 px,
       FanKarr veut 240 a 280 px sur 3 demi-rangees, 300 a 363 sur 2 ; 2
       modules font 190 px, 3 en font 291. Elle tombait dans le secours
       ci-dessous, fait pour l ecran trop etroit, et prenait toute la largeur
       (1 201 px). Les formes au-dela du maximum, au cout du recours elastique,
       et seulement LES PLUS PROCHES (3 modules, 11 px de trop) : toutes, la
       recherche des rangements pleins les essayait une a une et le calcul de
       la page doublait. */
    if (!res.length) {
      const au = liste(true), min = Math.min(...au.map((o) => o.trop));
      res = au.filter((o) => o.trop === min);
    }
    if (!res.length) {
      // Rien ne tient dans `C` colonnes (ecran trop etroit, contenu plus long
      // que prevu) : toute la largeur, assez haute pour ce que la page a mesure.
      const [hs] = Object.entries(t.formes).sort((a, b) => a[1].min - b[1].min)[0];
      res.push({ w: C, h: Math.max(+hs, bas(C)), cout: 100 });
    }
    return res.sort((a, b) => a.cout - b.cout);
  }

  // Meilleur rangement PLEIN de `C` colonnes sur exactement `H` demi-rangees.
  function chercher(cartes, opts, C, H) {
    const N = C * H, n = cartes.length, libre = new Uint8Array(N).fill(1), pris = new Uint8Array(n);
    const aMin = opts.map((o) => Math.min(...o.map((t) => t.w * t.h)));
    const aMax = opts.map((o) => Math.max(...o.map((t) => t.w * t.h)));
    const cMin = opts.map((o) => o[0].cout);   // les formes sont triees par cout
    const ideal = cMin.reduce((s, c) => s + c, 0);   // le meilleur cout imaginable
    const places = [];
    let meilleur = null, essais = 0;
    const tient = (x, y, w, h) => {
      if (x + w > C || y + h > H) return false;
      for (let j = y; j < y + h; j++)
        for (let i = x; i < x + w; i++) if (!libre[j * C + i]) return false;
      return true;
    };
    const marquer = (x, y, w, h, v) => { for (let j = y; j < y + h; j++) libre.fill(v, j * C + x, j * C + x + w); };
    // `reste` : cartes encore a poser ; `pris[k]` : la carte k est posee
    function etape(reste, vide, cout, depuis) {
      if (++essais > BUDGET || (!meilleur && essais > BUDGET_PREMIER) || (meilleur && meilleur.cout <= ideal + 1)) return;
      if (!reste) { if (!vide) meilleur = { cout, places: places.map((p) => ({ ...p })) }; return; }
      // l aire restante doit pouvoir combler exactement les cases vides, et meme
      // a leurs formes les moins cheres, les cartes restantes ne doivent pas
      // deja couter plus que le meilleur rangement trouve
      let mn = 0, mx = 0, cm = cout;
      for (let k = 0; k < n; k++) if (!pris[k]) { mn += aMin[k]; mx += aMax[k]; cm += cMin[k]; }
      if (mn > vide || mx < vide || (meilleur && cm >= meilleur.cout)) return;
      let p = depuis;
      while (p < N && !libre[p]) p++;
      if (p >= N) return;
      const x = p % C, y = (p / C) | 0;
      for (let k = 0, r = 0; k < n && r < FENETRE; k++) {
        if (pris[k]) continue;
        for (const t of opts[k]) {
          if (!tient(x, y, t.w, t.h)) continue;
          marquer(x, y, t.w, t.h, 0);
          pris[k] = 1;
          places.push({ id: cartes[k].id, x, y, w: t.w, h: t.h });
          etape(reste - 1, vide - t.w * t.h, cout + t.cout + r * COUT.ordre, p);
          places.pop();
          pris[k] = 0;
          marquer(x, y, t.w, t.h, 1);
        }
        r++;
      }
    }
    etape(n, N, 0, 0);
    return meilleur;
  }

  // A la suite, chaque carte a sa forme la moins couteuse : le secours quand
  // aucun rangement plein n existe. Les trous restent en fin de groupe.
  function secours(cartes, opts, C) {
    const ligne = [], occ = (y) => (ligne[y] ??= new Uint8Array(C));
    const places = [];
    cartes.forEach((c, k) => {
      const { w, h } = opts[k][0];
      cherche: for (let y = 0; ; y++)
        for (let x = 0; x + w <= C; x++) {
          let ok = true;
          for (let j = y; j < y + h && ok; j++)
            for (let i = x; i < x + w; i++) if (occ(j)[i]) { ok = false; break; }
          if (!ok) continue;
          for (let j = y; j < y + h; j++) occ(j).fill(1, x, x + w);
          places.push({ id: c.id, x, y, w, h });
          break cherche;
        }
    });
    const H = Math.max(0, ...places.map((p) => p.y + p.h));
    return { cout: 1e6, places, H, C, trous: true };
  }

  /* Rangements pleins d un groupe sur `C` colonnes : Map H → { cout, places, H, C }.
     ⚠️ GARDES EN MEMOIRE d un rangement de page a l autre : quand une seule
     carte change (une alerte s allume), seul son groupe se recalcule. */
  /* ⚠️ Le module est ARRONDI A 4 PX dans la cle : pendant un redimensionnement,
     des largeurs voisines retrouvent le meme rangement au lieu d en recalculer
     un (quelques pixels d ecart par carte ; une carte qui deborderait est
     rattrapee par la verification de la page). */
  const MEMOIRE = new Map();
  const cleDe = (cartes, C, m, genre) => C + "|" + Math.round(m / 4) + "|" + genre + "|" + cartes.map((c) =>
    [c.id, c.alerte ? 1 : 0, c.niveau, c.t.h[1], JSON.stringify(c.t.formes), [...(c.exclues || [])].join(),
     [...(c.minH || [])].join()].join(":")).join("/");
  const garder = (cle, v) => {
    if (MEMOIRE.size > 400) MEMOIRE.delete(MEMOIRE.keys().next().value);
    MEMOIRE.set(cle, v);
    return v;
  };
  function parHauteur(cartes, C, m, elastique) {
    const cle = cleDe(cartes, C, m, elastique ? "e" : "");
    if (MEMOIRE.has(cle)) return MEMOIRE.get(cle);
    const opts = cartes.map((c) => options(c, C, m, elastique));
    let aMin = 0, aIdeal = 0;
    opts.forEach((o) => { aMin += Math.min(...o.map((t) => t.w * t.h)); aIdeal += o[0].w * o[0].h; });
    const res = new Map();
    const h0 = Math.ceil(aMin / C), h1 = Math.min(h0 + 10, Math.ceil(aIdeal / C) + 3);
    for (let H = h0; H <= h1; H++) {
      const r = chercher(cartes, opts, C, H);
      if (r) res.set(H, { cout: r.cout + H * PAR_RANGEE * C / 12, places: r.places, H, C });
    }
    return garder(cle, { res, opts });
  }

  /* ETIRER UN RANGEMENT PLEIN (18/10/2026). Le recours elastique essaie les
     formes des moins cheres (les etroites) aux plus cheres : pour un petit
     groupe seul sur une rangee large, il epuisait son budget dans des formes
     etroites qui ne rempliront jamais la rangee, et ne trouvait qu un rangement
     ou UNE carte prenait tout l excedent (Bureau dans la demonstration a
     2 560 px : WireGuard sur 15 modules pour trois appareils). Ici : le
     rangement PLEIN le plus large qui existe en moins de colonnes, etire d une
     colonne a la fois. Doubler une colonne elargit d un module chaque carte qui
     la couvre et decale celles de droite : le rangement reste plein. On double
     chaque fois la colonne qui coute le moins (formes ecartees comprises :
     elles coutent l infini), et l excedent se repartit entre les cartes. */
  function etirer(cartes, C, m) {
    const couts = cartes.map((c) => new Map(options(c, C, m, true).map((o) => [o.w + "x" + o.h, o.cout])));
    const rang = new Map(cartes.map((c, k) => [c.id, k]));
    const cout = (p, w) => couts[rang.get(p.id)].get(w + "x" + p.h) ?? Infinity;
    for (let Cp = C - 1; Cp >= Math.max(1, C - 12); Cp--) {
      const res = new Map();
      for (const r of parHauteur(cartes, Cp, m).res.values()) {
        const places = r.places.map((p) => ({ ...p }));
        let ok = true;
        for (let n = Cp; n < C && ok; n++) {
          let x0 = -1, d = Infinity;
          for (let x = 0; x < n; x++) {
            let s = 0;
            for (const p of places) if (p.x <= x && x < p.x + p.w) s += cout(p, p.w + 1) - cout(p, p.w);
            if (s < d) { d = s; x0 = x; }
          }
          if (x0 < 0) ok = false;
          else for (const p of places) { if (p.x <= x0 && x0 < p.x + p.w) p.w++; else if (p.x > x0) p.x++; }
        }
        if (ok) res.set(r.H, { cout: places.reduce((s, p) => s + cout(p, p.w), 0) + r.H * PAR_RANGEE * C / 12, places, H: r.H, C });
      }
      if (res.size) return res;
    }
    return new Map();
  }
  /* Le recours elastique : pour chaque hauteur, le moins cher de la recherche
     sur toutes les formes et du rangement plein etire. Marque `etire` : un
     groupe ainsi range SEUL sur sa rangee fera chercher a la page un partage
     qu elle ecarte d ordinaire (voir `essaie`). */
  function elastique(cartes, C, m) {
    const cle = cleDe(cartes, C, m, "t");
    if (MEMOIRE.has(cle)) return MEMOIRE.get(cle);
    const res = new Map([...parHauteur(cartes, C, m, true).res].map(([H, r]) => [H, { ...r, etire: true }]));
    for (const [H, r] of etirer(cartes, C, m)) if (!res.has(H) || r.cout < res.get(H).cout) res.set(H, { ...r, etire: true });
    return garder(cle, res);
  }

  /** Le meilleur rangement d un groupe sur `C` colonnes (plein, ou de secours). */
  function rangerGroupe(cartes, C, m) {
    const meilleur = (res) => { let b = null; for (const r of res.values()) if (!b || r.cout < b.cout) b = r; return b; };
    const exact = parHauteur(cartes, C, m);
    return meilleur(exact.res) || meilleur(elastique(cartes, C, m)) || secours(cartes, exact.opts, C);
  }

  /* LA PAGE : les groupes, dans leur ordre fixe, en rangees de 1 a 3 groupes
     consecutifs de meme hauteur, dont les largeurs font exactement `P`. Un
     groupe seul prend toute la largeur. Cote a cote, chacun fait au moins
     4 modules et assez pour sa carte la plus large. Renvoie
     `{ P, m, rangees: [{ H, groupes: [{ id, x, w, places, H }] }] }`. */
  /* `o.coins` (17/10/2026, option A retenue, ecran de 2 560 px) : la premiere
     rangee loge l EN-TETE de la page (barre, raccourcis, recherche, menu) au
     milieu, et les deux premiers groupes dans les coins, de part et d autre,
     A SA HAUTEUR. `{ px, Hmin }` : la largeur de l en-tete, et la hauteur en
     demi-rangees que ses voisins doivent atteindre. La place de l en-tete est un
     element `id: "tete"` sans carte ; la rangee porte `coins: true`. Impossible
     (coins trop etroits, groupes trop hauts) : le rangement ordinaire. */
  function rangerPage(groupes, W, o = {}) {
    const { P, m } = grille(W);
    /* Le module d une rangee de `n` groupes : entre deux groupes, `ENTRE` et non
       `ESPACE`. Les cartes de groupes cote a cote sont donc un peu plus etroites
       (2 a 3 px par module) : leurs formes se jugent a cette largeur-la. */
    const mDe = (n) => (W - ESPACE * (P - n) - ENTRE * (n - 1)) / P;
    const memo = new Map();
    const tableau = (gi, w, n) => {
      const k = gi + ":" + w + ":" + n, mn = mDe(n);
      // sans rangement plein a cette largeur, le recours elastique (plus cher)
      if (!memo.has(k)) {
        const exact = parHauteur(groupes[gi].cartes, w, mn).res;
        memo.set(k, exact.size ? exact : elastique(groupes[gi].cartes, w, mn));
      }
      return memo.get(k);
    };
    // largeur minimale d un groupe : sa carte la plus large a sa forme la plus etroite
    const wMin = (g, mn) => Math.max(4, ...g.cartes.map((c) =>
      Math.min(...Object.values(c.t.formes).map((f) => Math.ceil((f.min + ESPACE) / (mn + ESPACE))))));
    const pas = 2;   // cote a cote, des largeurs paires : moins de calcul, et des groupes qui s alignent
    /* ⚠️ COTE A COTE, LES GROUPES DOIVENT AVOIR LA MEME HAUTEUR : chacun doit
       donc recevoir une largeur a peu pres PROPORTIONNELLE A SA SURFACE (celle
       de ses cartes a leur forme ideale). Un partage dont les hauteurs
       naturelles s ecartent de plus d un tiers n a presque aucune chance, et
       l essayer coutait l essentiel du calcul : il est ecarte d avance. */
    const aire = groupes.map((g) => g.cartes.reduce((s, c) => {
      const wi = Math.max(1, Math.min(P, Math.round((largeur(c.t.l, REF) + ESPACE) / (m + ESPACE))));
      return s + wi * c.t.h[1];
    }, 0));
    const plausible = (ids, ws) => {
      const h = ws.map((w, j) => aire[ids[j]] / w);
      return Math.max(...h) <= 1.35 * Math.min(...h);
    };
    const n = groupes.length, dp = new Array(n + 1).fill(null);
    dp[n] = { cout: 0, rangees: [] };
    /* `strict` : les partages cote a cote ecartes d avance (`plausible`). Sans
       aucun rangement plein, un second essai les reprend tous avant le recours
       (le groupe seul, qui laisse des cases vides) : un groupe de petites
       tuiles et de grands graphes (Supervision, « Relevés absents ») ne se
       remplit qu a cote d un autre, dans un partage que le tri jugeait
       improbable (17/10/2026).
       ⚠️ LE SECOND ESSAI AUSSI QUAND UN GROUPE EST SEUL SUR SA RANGEE ET ETIRE
       (`seul` : ce groupe ou le suivant ; 18/10/2026). Bureau seul sur
       24 modules (2 560 px) etirait ses cinq petites cartes sur 2 336 px,
       WireGuard en tete ; a cote de Reseau (16 + 8 modules), partage que le tri
       ecartait (rapport 1,44), tout est plein sans rien etirer. Ce second essai
       la ne cherche qu un partage A DEUX (`kmin`, `kmax`), et PLEIN (`plein` :
       sans le recours elastique, le plus cher a calculer) : complet, il
       doublait le temps de calcul a 2 560 px. */
    const essaie = (i, strict, kmin = 1, kmax = 3, plein = false) => {
      for (let k = kmin; k <= kmax && i + k <= n; k++) {
        if (!dp[i + k]) continue;
        const ids = Array.from({ length: k }, (_, j) => i + j);
        const reparts = [];
        const rec = (j, reste, acc) => {
          const g = groupes[ids[j]], a = wMin(g, mDe(k));
          if (j === k - 1) { if (reste >= a) reparts.push([...acc, reste]); return; }
          for (let w = Math.ceil(a / pas) * pas; w <= reste - 4; w += pas) rec(j + 1, reste - w, [...acc, w]);
        };
        if (k === 1) reparts.push([P]); else rec(0, P, []);
        for (const ws of reparts) {
          if (strict && k > 1 && !plausible(ids, ws)) continue;
          const tabs = ws.map((w, j) => plein ? parHauteur(groupes[ids[j]].cartes, w, mDe(k)).res : tableau(ids[j], w, k));
          for (const H of tabs[0].keys()) {
            if (!tabs.every((t) => t.has(H))) continue;
            const total = tabs.reduce((s, t) => s + t.get(H).cout, 0) + H * PAR_RANGEE + dp[i + k].cout;
            if (!dp[i] || total < dp[i].cout) {
              let x = 0;
              dp[i] = { cout: total, seul: k === 1 && tabs[0].get(H).etire, rangees: [{ H, groupes: ws.map((w, j) => {
                const r = tabs[j].get(H), o = { id: groupes[ids[j]].id, x, w, places: r.places, H };
                x += w; return o; }) }, ...dp[i + k].rangees] };
            }
          }
        }
      }
    };
    /* LA PAGE SANS LES COINS, calculee seulement s il le faut : quand les coins
       tiennent, elle ne servait a rien et doublait le calcul. */
    const ordinaire = () => {
      for (let i = n - 1; i >= 0; i--) {
        essaie(i, true);
        if (!dp[i]) essaie(i, false);
        // `seul` : ce groupe, ou le suivant, seul sur sa rangee et etire ; un
        // partage a deux pourrait les remplir sans etirer
        else if (dp[i].seul || (dp[i + 1] && dp[i + 1].seul)) essaie(i, false, 2, 2, true);
        // aucun rangement plein : le groupe seul, sur toute la largeur, au mieux
        if (!dp[i] && dp[i + 1]) {
          let d = rangerGroupe(groupes[i].cartes, P, m);
          /* Pas de rangement plein sur toute la largeur : un rangement PLEIN sur
             la moitie, le tiers ou le quart, elargi d autant (des cartes plus
             larges que prevu plutot que des cases vides ; Supervision dans
             « Relevés absents » : plein a 12 modules, pas a 24).
             ⚠️ RANGE A LA LARGEUR QU AURONT LES CARTES, ELARGIES : un module de
             `f` modules (18/10/2026). Range avec le module ordinaire, chaque carte
             recevait la hauteur de sa largeur d avant, et s affichait deux fois
             plus large : Stockage en 4x14 a 600 px, faite pour 274 px de large,
             a moitie vide. */
          for (const f of [2, 3, 4]) {
            if (!d.trous || P % f) continue;
            const e = rangerGroupe(groupes[i].cartes, P / f, f * m + (f - 1) * ESPACE);
            if (!e.trous) d = { ...e, places: e.places.map((p) => ({ ...p, x: p.x * f, w: p.w * f })) };
          }
          dp[i] = { cout: d.cout + dp[i + 1].cout, seul: true,
                    rangees: [{ H: d.H, groupes: [{ id: groupes[i].id, x: 0, w: P, places: d.places, H: d.H, trous: d.trous }] }, ...dp[i + 1].rangees] };
        }
      }
      return { P, m, rangees: dp[0].rangees };
    };
    if (!o.coins || groupes.length < 3) return ordinaire();
    // l en-tete au milieu : le plus petit nombre PAIR de modules qui le couvre, des coins egaux
    const m3 = mDe(3);
    let wt = 2;
    while (wt * m3 + (wt - 1) * ESPACE < o.coins.px) wt += 2;
    const c = (P - wt) / 2;
    if (c < 2 || c < wMin(groupes[0], m3) || c < wMin(groupes[1], m3)) return ordinaire();
    const a = tableau(0, c, 3), b = tableau(1, c, 3);
    /* La hauteur, la meme pour les deux coins : celle de l en-tete (`Hmin`), ou
       un peu plus, ses ecarts s allongent ; ou un peu moins, jusqu a
       `Hplancher`, ses ecarts se resserrent (des coins faits de petites tuiles,
       « Relevés absents », n atteignent pas sa hauteur). */
    let mieux = null;
    for (let H = o.coins.Hplancher || o.coins.Hmin; H <= o.coins.Hmin + 2; H++) {
      if (!a.has(H) || !b.has(H)) continue;
      const cout = a.get(H).cout + b.get(H).cout + 3 * Math.abs(H - o.coins.Hmin);
      if (!mieux || cout < mieux.cout) mieux = { cout, H };
    }
    if (!mieux) return ordinaire();
    const H = mieux.H, reste = rangerPage(groupes.slice(2), W);
    return { P, m, rangees: [{ H, coins: true, groupes: [
      { id: groupes[0].id, x: 0, w: c, places: a.get(H).places, H },
      { id: "tete", x: c, w: wt, places: [], H },
      { id: groupes[1].id, x: c + wt, w: c, places: b.get(H).places, H }] }, ...reste.rangees] };
  }

  /* ---- Le mode Compact, range par groupe (17/10/2026, option A retenue) ----
     Une tuile par carte qui mene quelque part, toutes pareilles. Chaque groupe
     est un rectangle de `k` colonnes sur `L` lignes, que ses tuiles remplissent.
     Les groupes gardent leur ordre et se suivent en rangees ; dans une rangee,
     tous ont le MEME nombre de lignes (meme hauteur, titres alignes), et leurs
     colonnes couvrent toute la largeur : `C` colonnes de tuiles, chacune large
     de `tmin` a `tmax` px. Un groupe garde au moins `kmin` colonnes, la largeur
     de son titre. Une rangee trop courte pour remplir la largeur a `tmax` etire
     quand meme ses tuiles (aucun vide sur les cotes, demande) ; seule
     exception, `o.court` (un seul groupe affiche, par le filtre) : elle reste
     courte et la page la centre.
     Cout : la hauteur (une ligne de tuiles = 1, un titre = 0,4), les cases
     qui resteraient vides (0,35 chacune ; la page n en laisse aucune, elle
     elargit les tuiles de la ligne incomplete : c est le prix de ces tuiles
     plus grandes) et la largeur laissee aux rangees courtes.
     `groupes` : [{ id, n, kmin }] ; rend [{ C, L, court, groupes: [{ id, k }] }]. */
  function rangerTuiles(groupes, W, o = {}) {
    const tmin = o.tmin || 100, tmax = o.tmax || 160, G = ESPACE;
    const Cmax = Math.max(1, Math.floor((W + G) / (tmin + G)));
    const Cmin = Math.min(Cmax, Math.max(1, Math.ceil((W + G) / (tmax + G))));
    const gs = groupes.filter((g) => g.n > 0).map((g) => ({ ...g, kmin: Math.min(Cmax, Math.max(1, g.kmin || 1)) }));
    // les groupes a..b-1 sur une meme rangee : la meilleure facon, ou null
    const rangee = (a, b) => {
      const ici = gs.slice(a, b), n = ici.reduce((x, g) => x + g.n, 0);
      let mieux = null;
      for (let L = 1; L <= Math.max(...ici.map((g) => g.n)); L++) {
        const ks = ici.map((g) => Math.max(g.kmin, Math.ceil(g.n / L)));
        const C = ks.reduce((x, y) => x + y, 0);
        // la tuile reelle : `ENTRE` entre deux groupes, `G` entre deux tuiles
        const t = (W - G * (C - ici.length) - ENTRE * (ici.length - 1)) / C;
        if (C > Cmax || t < tmin) continue;
        /* Un groupe qui a moins de tuiles que de cases n en laisse aucune vide :
           sa premiere ligne s elargit, et s il a moins de lignes que ses
           voisins, ses tuiles s allongent (une tuile seule a cote d un groupe de
           trois lignes devient une grande tuile). Les cases « en trop » restent
           comptees : le rangement prefere les grilles pleines. */
        const cout = 0.4 + L + 0.35 * (C * L - n) + 0.15 * Math.max(0, Cmin - C);
        if (!mieux || cout < mieux.cout)
          mieux = { cout, C, L, court: !!o.court && C < Cmin, groupes: ici.map((g, i) => ({ id: g.id, k: ks[i] })) };
      }
      return mieux;
    };
    // les coupures entre rangees : programmation dynamique sur l ordre des groupes
    const best = [{ cout: 0, rangs: [] }];
    for (let j = 1; j <= gs.length; j++) {
      best[j] = null;
      for (let i = 0; i < j; i++) {
        const r = best[i] && rangee(i, j);
        if (r && (!best[j] || best[i].cout + r.cout < best[j].cout)) best[j] = { cout: best[i].cout + r.cout, rangs: [...best[i].rangs, r] };
      }
    }
    return { Cmax, rangs: (best[gs.length] || { rangs: [] }).rangs.map(({ cout, ...r }) => r) };
  }

  /* ---- L ordre dans un groupe ---- */
  const RANG = { essentielle: 0, normale: 1, secondaire: 2 };
  /** Trie les cartes d un groupe : alerte, niveau, usage (par paliers de 3
   *  ouvertures sur 30 jours), ordre declare. */
  function ordonne(cartes, usage) {
    return cartes.map((c, i) => ({ c, i })).sort((a, b) =>
      (!!b.c.alerte - !!a.c.alerte)
      || ((RANG[a.c.niveau] ?? 1) - (RANG[b.c.niveau] ?? 1))
      || (Math.floor((usage[b.c.id] || 0) / 3) - Math.floor((usage[a.c.id] || 0) / 3))
      || (a.i - b.i)).map((x) => x.c);
  }

  /* ---- L usage, par appareil (rien sur le NAS) ----
     Une ouverture = un clic qui ouvre le service ou la fenetre d une carte.
     Compte sur 30 jours glissants, mais l ORDRE n en tient compte qu une fois
     par semaine, le lundi : une carte ne change pas de place d un jour a
     l autre. */
  const CLE = "homelab.usage", CLE_SEMAINE = "homelab.usage.semaine", JOUR = 86400000;
  const auj = () => Math.floor(Date.now() / JOUR);
  const lundi = () => { const d = auj(); return d - ((d + 3) % 7); }; // le 1er janvier 1970 etait un jeudi
  function noter(id) {
    try {
      const u = JSON.parse(localStorage.getItem(CLE) || "{}");
      (u[id] ||= []).push(auj());
      for (const k in u) { u[k] = u[k].filter((j) => j > auj() - 30); if (!u[k].length) delete u[k]; }
      localStorage.setItem(CLE, JSON.stringify(u));
    } catch (e) { /* stockage refuse : l usage ne compte pas, rien de plus */ }
  }
  function usage() {
    try {
      const s = JSON.parse(localStorage.getItem(CLE_SEMAINE) || "null");
      if (s && s.lundi === lundi()) return s.scores;
      const u = JSON.parse(localStorage.getItem(CLE) || "{}"), scores = {};
      for (const k in u) scores[k] = u[k].filter((j) => j > lundi() - 30).length;
      localStorage.setItem(CLE_SEMAINE, JSON.stringify({ lundi: lundi(), scores }));
      return scores;
    } catch (e) { return {}; }
  }

  /* ---- Ce que la page voit apres coup ----
     Les formes viennent du PIRE contenu des scenarios ; le contenu reel peut
     etre plus long (dix appareils WireGuard) ou bien plus court. Une fois les
     cartes posees, la page regarde chacune :
     - « deborde » : le contenu sort de la carte ou colle au bord du bas
       (moins de 8 px d air) ;
     - « vide » : carte plus haute que son ideale, sans graphe, qui garderait
       deux demi-rangees vides.
     La forme est alors ecartee POUR CETTE CARTE, et la page se range de
     nouveau. */
  /** `{ etat: "deborde", manque }` (px a ajouter), `{ etat: "vide" }`, ou null. */
  function verifie(el) {
    const cr = el.getBoundingClientRect();
    if (!cr.height || !cr.width) return null;
    const sort = el.scrollHeight - el.clientHeight;
    const cs = getComputedStyle(el);
    const haut = cr.top + parseFloat(cs.paddingTop), bas = cr.bottom - parseFloat(cs.paddingBottom);
    const vus = (l) => [...l].filter((x) => x.getClientRects().length && getComputedStyle(x).position !== "absolute");
    // le bas du contenu : les enfants de la carte, et ceux du bloc `.vizb`, qui
    // lui s etire jusqu en bas
    let fin = haut, debut = Infinity;
    for (const e of vus(el.children)) {
      debut = Math.min(debut, e.getBoundingClientRect().top);
      for (const x of e.classList.contains("vizb") ? vus(e.children) : [e]) fin = Math.max(fin, x.getBoundingClientRect().bottom);
    }
    // 8 px d air au moins sous le contenu, dans la marge du bas (14 px)
    if (sort > 1 || fin > bas + 6) return { etat: "deborde", manque: Math.ceil(Math.max(sort + 8, fin - bas - 6)) };
    if (el.classList.contains("haute") && !el.querySelector(".grb")
        && (bas - haut) - (fin - debut) >= 2 * (RANGEE + ESPACE)) return { etat: "vide" };
    return null;
  }

  return { VERSION, ESPACE, ENTRE, RANGEE, grille, largeur, hauteur, options, rangerGroupe, rangerPage, rangerTuiles, ordonne, noter, usage, verifie };
})();

/* EN TRAVAILLEUR (Web Worker, 17/10/2026) : la page charge AUSSI ce fichier par
   `new Worker("rangement.js")`. Il y recoit les groupes et une largeur, et
   renvoie le rangement : le calcul d une largeur nouvelle (jusqu a une seconde
   sur grand ecran) ne fige plus la page. Sa memoire (`MEMOIRE`) dure tant que
   la page est ouverte. */
if (typeof window === "undefined" && typeof postMessage === "function") {
  // `prepare` : une largeur que la page n affiche pas encore, rangee d avance
  // (voir `preparer` dans app.js) ; sinon la largeur demandee, tout de suite.
  onmessage = (e) => {
    const { groupes, ...demande } = e.data;   // le reste (cle, tranche…) revient tel quel
    postMessage({ ...demande, page: RANGEMENT.rangerPage(groupes, demande.W, { coins: demande.coins }) });
  };
}
