/* ============ ATELIER DES CARTES (13/10/2026) ============
   `index.html?atelier` : chaque carte de `cartes.js`, seule, a TOUTES les
   tailles que sa declaration permet (voir TAILLES), pour verifier qu elle s y
   affiche bien avant de la confier au rangement en bento.

   Le principe : la VRAIE page demarre comme d habitude (donnees du NAS, ou
   scenarios en demonstration), et l atelier prend la place des groupes. Les
   cartes sont rendues par la vraie fonction `card()` et habillees par les
   vraies feuilles de style : ce qu on voit ici est ce que la page affichera.

   Pour chaque carte :
   - une planche de ses tailles permises (largeurs de son minimum a son
     maximum, hauteurs de sa plage), pour une taille de module au choix ;
   - la detection des defauts : contenu qui deborde, texte coupe par « … »,
     element qui sort du cadre ;
   - sa largeur minimale MESUREE, a comparer a celle qu elle declare ;
   - un cadre libre, redimensionnable a la souris.
   Une carte ajoutee a `cartes.js` y apparait d elle-meme.

   ⚠️ LIMITE CONNUE : les regles `@media` de style.css et fond.css dependent de
   la largeur de l ECRAN, pas de celle de la carte. Elles ne s appliquent donc
   pas aux cartes de l atelier telles qu elles s appliqueraient sur un petit
   ecran. Elles deviendront des regles liees a la largeur de la carte
   (`@container`) a l etape suivante ; l atelier sera alors fidele partout. */
(() => {
  const actif = new URLSearchParams(location.search).has("atelier");
  window.ATELIER = { actif };
  if (!actif) return;
  // La page normale ne se rafraichit pas dans un onglet cache. L atelier, si :
  // il sert aussi d outil de mesure, dans un onglet qu on ne regarde pas.
  try { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); } catch (e) { /* tant pis */ }

  /* ---- Reglages ---- */
  // la largeur d un module selon l ecran (voir la base de grille proposee)
  const ECRANS = [
    ["Téléphone", 79], ["Écran 1 920", 83], ["Portable 1 280", 92],
    ["Écran 1 440", 106], ["Tablette couchée", 113],
  ];
  const TELEPHONE = 350; // largeur utile d un telephone de 390 px
  // rangees de 44 px : des DEMI-rangees (2 = 100 px, 4 = 212, 6 = 324)
  const R = { module: 92, espace: 12, rangee: 44 };
  const NIV = { essentielle: "E", normale: "N", secondaire: "S" };

  let donnees = null, demoVu, choisie = null, direct = false;
  const resultats = new Map(); // nom de la carte → bilan, pour les reglages du moment

  /* ---- Calculs de taille ---- */
  const largeurPx = (w) => w * R.module + (w - 1) * R.espace;
  const hauteurPx = (h) => h * R.rangee + (h - 1) * R.espace;
  // modules necessaires pour atteindre une largeur en pixels
  const modulesPour = (px) => Math.max(1, Math.ceil((px + R.espace) / (R.module + R.espace)));
  const plage = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
  const largeurs = (t) => { const a = modulesPour(t.min); return plage(a, Math.max(a, t.max)); };
  const hauteurs = (t) => plage(t.h[0], t.h[2]);
  const toutes = () => GROUPS.flatMap((g) => g.s.map((s) => ({ s, g })));
  const trouve = (nom) => toutes().find((x) => x.s.n === nom);
  const court = (t) => { t = String(t).replace(/\s+/g, " ").trim(); return t.length > 38 ? t.slice(0, 37) + "…" : t; };

  /* ---- Rendu d une carte a une taille donnee ---- */
  // Le CONTRAT DE TAILLE, que la grille en bento posera de la meme facon :
  // `data-l` = largeur en modules, `data-h` = hauteur en demi-rangees. Les
  // styles d une carte s adaptent a sa hauteur par `[data-h]`, a sa largeur
  // par `@container carte` (voir bento/base.css).
  // Les classes de l ANCIENNE grille (c4, mini) changent aussi le contenu (une
  // carte `mini c4` se met en ligne) : on les recalcule d apres la taille.
  function habille(el, w, py) {
    const c = el.querySelector(".card");
    if (!c) return;
    c.dataset.l = w;
    c.dataset.h = Math.max(1, Math.round((py + R.espace) / (R.rangee + R.espace)));
    c.classList.remove("c2", "c3", "c4", "mini");
    if (py <= 100) c.classList.add("mini");
    if (w >= 10) c.classList.add("c4");
    // ni lien ni fenetre dans l atelier : un clic n y doit rien ouvrir
    c.querySelectorAll("[data-lien]").forEach((x) => x.removeAttribute("data-lien"));
    if (c.matches("a[href]")) c.removeAttribute("href");
    c.classList.remove("clic");
    c.removeAttribute("role");
  }

  function poseCarte(cadre, s, w, px, py) {
    cadre.innerHTML = card(s, donnees);
    cadre.style.width = px + "px";
    cadre.style.height = py + "px";
    habille(cadre, w, py);
  }

  /* ---- Detection des defauts ---- */
  const nomEl = (el) => {
    const k = [...el.classList].slice(0, 2).join(".");
    const t = court(el.textContent || "");
    return (k ? "." + k : el.tagName.toLowerCase()) + (t ? " « " + t + " »" : "");
  };
  function defauts(cadre) {
    const c = cadre.querySelector(".card");
    if (!c) return ["la carte ne s'affiche pas"];
    const res = [];
    // une regle CSS qui impose une taille a la carte l empeche de suivre sa case
    const cb = c.getBoundingClientRect(), kb = cadre.getBoundingClientRect();
    if (cb.height > kb.height + 1) res.push(`refuse de descendre sous ${Math.round(cb.height)} px de haut`);
    if (cb.width > kb.width + 1) res.push(`refuse de descendre sous ${Math.round(cb.width)} px de large`);
    const dh = c.scrollHeight - c.clientHeight, dw = c.scrollWidth - c.clientWidth;
    if (dh > 1) res.push(`déborde en hauteur de ${dh} px`);
    if (dw > 1) res.push(`déborde en largeur de ${dw} px`);
    const cr = c.getBoundingClientRect();
    let sorties = 0;
    for (const el of c.querySelectorAll("*")) {
      if (!el.getClientRects().length) continue; // non affiche
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden") continue;
      if (cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1)
        res.push(`texte coupé : « ${court(el.textContent)} »`);
      // les elements places expres (pastilles, decors) ne comptent pas
      if (cs.position === "absolute" || cs.position === "fixed") continue;
      const r = el.getBoundingClientRect();
      if ((r.right > cr.right + 1 || r.bottom > cr.bottom + 1) && sorties++ < 3)
        res.push("sort du cadre : " + nomEl(el));
    }
    return [...new Set(res)];
  }

  // Cadre de mesure, hors de la vue mais bien mis en page (dans #groups, pour
  // que les regles qui le visent s appliquent).
  let banc;
  const mesure = (s, w, px, py) => { poseCarte(banc, s, w, px, py); return defauts(banc); };

  // Plus petite largeur, en pixels, sans aucun defaut, pour une hauteur donnee.
  // ⚠️ PAS de dichotomie sur toute la plage : un graphique qui garde ses
  // proportions grandit en hauteur avec la largeur, et une carte trop LARGE
  // deborde alors par le bas. On balaie donc par pas de 26 px, puis on affine
  // entre le dernier echec et le premier succes.
  function minimumMesure(s, h) {
    const py = hauteurPx(h);
    let avant = 100;
    for (let px = 100; px <= 1600; px += 26) {
      if (!mesure(s, modulesPour(px), px, py).length) {
        let a = avant, b = px;
        while (b - a > 2) {
          const m = (a + b) >> 1;
          if (mesure(s, modulesPour(m), m, py).length) a = m; else b = m;
        }
        return b;
      }
      avant = px;
    }
    return null; // ne tient a aucune largeur avec cette hauteur
  }

  // Hauteur, en pixels, dont le contenu a besoin a une largeur donnee : la
  // plus petite sans aucun defaut. Sert a choisir la hauteur des rangees.
  function hauteurContenu(s, px) {
    if (mesure(s, modulesPour(px), px, 1400).length) return null;
    let a = 30, b = 1400;
    while (b - a > 2) {
      const m = (a + b) >> 1;
      if (mesure(s, modulesPour(px), px, m).length) a = m; else b = m;
    }
    return b;
  }
  // rangees necessaires pour une hauteur, et place perdue en bas de la carte
  const rangeesPour = (py) => Math.max(1, Math.ceil((py + R.espace) / (R.rangee + R.espace)));

  // Bilan complet d une carte pour les reglages du moment.
  function bilan(s) {
    const t = tailleDe(s);
    const wIdeal = Math.max(t.l, modulesPour(t.min));
    const hc = hauteurContenu(s, largeurPx(wIdeal));
    const besoin = hc === null ? null : { px: hc, rangees: rangeesPour(hc), perte: hauteurPx(rangeesPour(hc)) - hc };
    const tailles = [];
    for (const h of hauteurs(t))
      for (const w of largeurs(t)) {
        const d = mesure(s, w, largeurPx(w), hauteurPx(h));
        tailles.push({ w, h, d });
      }
    const tel = hauteurs(t).map((h) => ({ h, d: mesure(s, 4, TELEPHONE, hauteurPx(h)) }));
    const minis = Object.fromEntries(hauteurs(t).map((h) => [h, minimumMesure(s, h)]));
    const enDefaut = tailles.filter((x) => x.d.length);
    const mid = minis[t.h[1]];
    const etat = enDefaut.length || mid === null || mid > t.min ? "ko"
      : tel.some((x) => x.d.length) ? "tel" : "ok";
    return { t, tailles, tel, minis, enDefaut, etat, wIdeal, besoin };
  }

  /* ---- Interface ---- */
  const racine = document.getElementById("groups");
  document.body.classList.add("atelier");
  racine.classList.remove("compact");
  const lien = document.createElement("link");
  lien.rel = "stylesheet"; lien.href = "atelier.css";
  document.head.append(lien);

  function squelette() {
    racine.innerHTML = `
      <header class="at-tete">
        <div class="at-titre"><h1>Atelier des cartes</h1>
          <p>Chaque carte, seule, à toutes les tailles que sa déclaration permet.
             <a href="${location.pathname}">Revenir à la page</a></p></div>
        <div class="at-reglages">
          <div class="at-ecrans" role="group" aria-label="Taille du module">${ECRANS.map(([n, m]) =>
            `<button type="button" data-module="${m}">${n}<b>${m} px</b></button>`).join("")}</div>
          <label>Module <input id="at-module" type="number" min="60" max="160" value="${R.module}"> px</label>
          <label>Espace <input id="at-espace" type="number" min="0" max="40" value="${R.espace}"> px</label>
          <label>Rangée <input id="at-rangee" type="number" min="60" max="200" value="${R.rangee}"> px</label>
          <label class="at-coche"><input id="at-direct" type="checkbox"> Données en direct</label>
          <button type="button" id="at-tout" class="at-action">Tester toutes les cartes</button>
        </div>
        <p id="at-resume" class="at-resume" role="status"></p>
      </header>
      <div class="at-corps">
        <nav class="at-liste" aria-label="Cartes"></nav>
        <section class="at-detail" aria-live="polite"></section>
      </div>
      <div id="at-banc" class="at-banc" aria-hidden="true"></div>`;
    banc = racine.querySelector("#at-banc");

    racine.querySelectorAll("[data-module]").forEach((b) => b.onclick = () => regle({ module: +b.dataset.module }));
    for (const k of ["module", "espace", "rangee"])
      racine.querySelector("#at-" + k).onchange = (e) => regle({ [k]: +e.target.value });
    racine.querySelector("#at-direct").onchange = (e) => { direct = e.target.checked; };
    racine.querySelector("#at-tout").onclick = toutTester;
  }

  function regle(r) {
    Object.assign(R, r);
    for (const k of ["module", "espace", "rangee"]) racine.querySelector("#at-" + k).value = R[k];
    resultats.clear(); // les bilans dependaient des anciens reglages
    liste(); detail();
  }

  const PASTILLE = { ok: "tient à toutes ses tailles", tel: "à revoir sur téléphone", ko: "à corriger" };

  function liste() {
    racine.querySelectorAll("[data-module]").forEach((b) => b.classList.toggle("on", +b.dataset.module === R.module));
    racine.querySelector(".at-liste").innerHTML = GROUPS.map((g) => `
      <div class="at-grp"><h2>${esc(g.n)}</h2>${g.s.map((s) => {
        const r = resultats.get(s.n);
        return `<button type="button" class="at-item${s.n === choisie ? " on" : ""}" data-carte="${esc(s.n)}">
          <i class="at-niv ${s.niveau}" title="${s.niveau}">${NIV[s.niveau] || "?"}</i>
          <span>${esc(s.n)}</span><em>${s.taille}</em>
          <i class="at-pt ${r ? r.etat : ""}" title="${r ? PASTILLE[r.etat] : "pas encore testée"}"></i></button>`;
      }).join("")}</div>`).join("");
    racine.querySelectorAll("[data-carte]").forEach((b) => b.onclick = () => { choisie = b.dataset.carte; liste(); detail(); });
    resume();
  }

  function resume() {
    const n = toutes().length, faits = [...resultats.values()];
    const ko = faits.filter((r) => r.etat === "ko").length, tel = faits.filter((r) => r.etat === "tel").length;
    racine.querySelector("#at-resume").textContent = faits.length
      ? `${faits.length}/${n} cartes testées avec un module de ${R.module} px : ${ko} à corriger, ${tel} à revoir sur téléphone.`
      : `${n} cartes. Choisis-en une, ou teste-les toutes.`;
  }

  async function toutTester() {
    const b = racine.querySelector("#at-tout");
    b.disabled = true;
    const tout = toutes();
    for (let i = 0; i < tout.length; i++) {
      b.textContent = `Test ${i + 1}/${tout.length}…`;
      resultats.set(tout[i].s.n, bilan(tout[i].s));
      await new Promise((r) => setTimeout(r, 0)); // rend la main a la page entre deux cartes
    }
    b.textContent = "Tester toutes les cartes";
    b.disabled = false;
    liste(); detail();
  }

  const fmt = (px) => px === null ? "jamais" : px + " px";

  function detail() {
    const zone = racine.querySelector(".at-detail");
    const x = choisie && trouve(choisie);
    if (!x) {
      zone.innerHTML = tableauBilan();
      zone.querySelectorAll("[data-carte]").forEach((b) => b.onclick = () => { choisie = b.dataset.carte; liste(); detail(); });
      return;
    }
    const { s, g } = x;
    const r = resultats.get(s.n) || bilan(s);
    resultats.set(s.n, r);
    const t = r.t;
    const mid = r.minis[t.h[1]];
    const avis = mid === null ? `<p class="at-avis ko">Cette carte ne tient à aucune largeur avec ${t.h[1]} rangée(s) : il lui faut plus de hauteur.</p>`
      : mid > t.min ? `<p class="at-avis ko">Minimum déclaré trop bas : à ${t.min} px, le contenu ne tient pas. Il en faut au moins ${mid}.</p>`
      : mid < t.min - 40 ? `<p class="at-avis info">Le contenu tient dès ${mid} px : le minimum déclaré (${t.min} px) pourrait baisser.</p>`
      : `<p class="at-avis ok">Le minimum déclaré (${t.min} px) correspond au contenu (${mid} px mesurés).</p>`;
    zone.innerHTML = `
      <div class="at-fiche">
        <h2>${esc(s.n)} <small>${esc(g.n)}</small></h2>
        <dl>
          <div><dt>Catégorie</dt><dd>${s.taille}</dd></div>
          <div><dt>Niveau</dt><dd>${s.niveau}</dd></div>
          <div><dt>Largeur min</dt><dd>${t.min} px <small>= ${modulesPour(t.min)} modules ici</small></dd></div>
          <div><dt>Idéale</dt><dd>${t.l}×${t.h[1]}</dd></div>
          <div><dt>Largeur max</dt><dd>${t.max} modules</dd></div>
          <div><dt>Hauteur</dt><dd>${t.h[0]} à ${t.h[2]} rangées</dd></div>
          <div><dt>Hauteur du contenu</dt><dd>${r.besoin ? `${r.besoin.px} px à ${largeurPx(r.wIdeal)} px de large <small>= ${r.besoin.rangees} rangées, ${r.besoin.perte} px perdus</small>` : "ne tient pas"}</dd></div>
          <div><dt>Minimum mesuré</dt><dd>${hauteurs(t).map((h) => `${h} rg : ${fmt(r.minis[h])}`).join(" · ")}</dd></div>
        </dl>
        ${avis}
        ${s.ajuste ? `<p class="at-note">Corrige sa catégorie : ${esc(JSON.stringify(s.ajuste))}</p>` : ""}
      </div>
      <h3 class="at-sous">Tailles permises <small>module de ${R.module} px, espace ${R.espace} px, rangée ${R.rangee} px</small></h3>
      ${hauteurs(t).map((h) => `
        <div class="at-rang">${largeurs(t).map((w) => {
          const d = r.tailles.find((y) => y.w === w && y.h === h).d;
          const ideal = w === Math.max(t.l, modulesPour(t.min)) && h === t.h[1];
          return `<figure class="at-cas${d.length ? " ko" : ""}${ideal ? " ideal" : ""}">
            <figcaption>${w}×${h}<span>${largeurPx(w)} × ${hauteurPx(h)} px${ideal ? " · idéale" : ""}</span></figcaption>
            <div class="at-cadre" data-w="${w}" data-h="${h}"></div>
            ${d.length ? `<ul class="at-def">${d.map((z) => `<li>${esc(z)}</li>`).join("")}</ul>` : ""}
          </figure>`;
        }).join("")}</div>`).join("")}
      <h3 class="at-sous">Sur téléphone <small>toute la largeur, ${TELEPHONE} px</small></h3>
      <div class="at-rang">${r.tel.map(({ h, d }) => `
        <figure class="at-cas${d.length ? " ko" : ""}">
          <figcaption>${h} demi-rangée${h > 1 ? "s" : ""}<span>${TELEPHONE} × ${hauteurPx(h)} px</span></figcaption>
          <div class="at-cadre" data-tel="1" data-h="${h}"></div>
          ${d.length ? `<ul class="at-def">${d.map((z) => `<li>${esc(z)}</li>`).join("")}</ul>` : ""}
        </figure>`).join("")}</div>
      <h3 class="at-sous">Cadre libre <small>tire le coin en bas à droite</small></h3>
      <p class="at-lecture" id="at-lecture"></p>
      <div class="at-libre"><div class="at-cadre" id="at-libre"></div></div>`;

    zone.querySelectorAll(".at-cadre[data-h]").forEach((c) => {
      const h = +c.dataset.h;
      if (c.dataset.tel) poseCarte(c, s, 4, TELEPHONE, hauteurPx(h));
      else { const w = +c.dataset.w; poseCarte(c, s, w, largeurPx(w), hauteurPx(h)); }
    });
    libre(s, t);
  }

  function libre(s, t) {
    const c = racine.querySelector("#at-libre");
    const w = Math.max(t.l, modulesPour(t.min));
    poseCarte(c, s, w, largeurPx(w), hauteurPx(t.h[1]));
    const lecture = racine.querySelector("#at-lecture");
    const maj = () => {
      const px = Math.round(c.getBoundingClientRect().width), py = Math.round(c.getBoundingClientRect().height);
      const mw = (px + R.espace) / (R.module + R.espace), mh = (py + R.espace) / (R.rangee + R.espace);
      habille(c, Math.floor(mw), py);
      const d = defauts(c);
      lecture.className = "at-lecture" + (d.length ? " ko" : "");
      lecture.textContent = `${px} × ${py} px, soit ${mw.toFixed(1)} modules × ${mh.toFixed(1)} rangées. `
        + (d.length ? "Défauts : " + d.join(" ; ") : "Rien ne dépasse.");
    };
    new ResizeObserver(maj).observe(c);
  }

  function tableauBilan() {
    const faits = toutes().filter(({ s }) => resultats.has(s.n));
    if (!faits.length) return `<p class="at-vide">Choisis une carte à gauche pour voir ses tailles, ou lance « Tester toutes les cartes » pour un bilan complet.</p>`;
    // place perdue au total en bas des cartes, pour la hauteur de rangee reglee
    const perte = faits.reduce((n, { s }) => n + (resultats.get(s.n).besoin?.perte ?? 0), 0);
    return `<p class="at-note">Rangées de ${R.rangee} px et espace de ${R.espace} px : ${perte} px perdus au total en bas des cartes, à leur largeur idéale.</p>
      <table class="at-table"><thead><tr><th>Carte</th><th>Catégorie</th><th>Contenu</th><th>Rangées</th><th>Perdu</th><th>Min déclaré</th>
      <th>Min mesuré</th><th>Tailles en défaut</th><th>Téléphone</th></tr></thead><tbody>${faits.map(({ s }) => {
        const r = resultats.get(s.n), mid = r.minis[r.t.h[1]], b = r.besoin;
        return `<tr class="${r.etat}"><td><button type="button" data-carte="${esc(s.n)}">${esc(s.n)}</button></td>
          <td>${s.taille}</td><td>${b ? b.px + " px" : "—"}</td><td>${b ? b.rangees + (b.rangees !== r.t.h[1] ? ` <small>(déclaré ${r.t.h[1]})</small>` : "") : "—"}</td>
          <td>${b ? b.perte + " px" : "—"}</td><td>${r.t.min} px</td><td>${fmt(mid)}</td>
          <td>${r.enDefaut.length ? r.enDefaut.map((y) => `${y.w}×${y.h}`).join(", ") : "aucune"}</td>
          <td>${r.tel.some((y) => y.d.length) ? "à revoir" : "tient"}</td></tr>`;
      }).join("")}</tbody></table>`;
  }


  /* ---- Analyse detaillee, pour les outils (et les agents) ----
     `ATELIER.analyser("Système", { module: 92 })` renvoie tout ce qu il faut
     pour juger les tailles d une carte : hauteur de son contenu a chaque
     largeur, defauts et remplissage a chaque taille declaree, un cran au-dela
     de ses maximums, largeur minimale mesuree, rendu telephone. */

  // Ou s arrete reellement le contenu : textes, images, graphiques et elements
  // colores (barres, pastilles), pas les boites vides qui s etirent.
  // `videVertical` compte AUSSI les trous au milieu (entre l en-tete et des
  // chiffres pousses en bas), que `videBas` ne voit pas.
  function remplissage(cadre) {
    const c = cadre.querySelector(".card");
    if (!c) return null;
    const cs = getComputedStyle(c), cr = c.getBoundingClientRect();
    const z = { l: cr.left + parseFloat(cs.paddingLeft), t: cr.top + parseFloat(cs.paddingTop),
                r: cr.right - parseFloat(cs.paddingRight), b: cr.bottom - parseFloat(cs.paddingBottom) };
    const rects = [];
    const garde = (r) => { if (r.width > 0.5 && r.height > 0.5) rects.push(r); };
    const tw = document.createTreeWalker(c, NodeFilter.SHOW_TEXT), rg = document.createRange();
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.nodeValue.trim() || n.parentElement.closest("svg")) continue;
      rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) garde(r);
    }
    for (const el of c.querySelectorAll("svg, img, canvas")) if (!el.parentElement.closest("svg")) garde(el.getBoundingClientRect());
    for (const el of c.querySelectorAll("*")) {
      if (el.children.length || el.closest("svg")) continue;
      const k = getComputedStyle(el);
      const fond = k.backgroundColor !== "rgba(0, 0, 0, 0)" && k.backgroundColor !== "transparent";
      if (fond || parseFloat(k.borderTopWidth) > 0) garde(el.getBoundingClientRect());
    }
    if (!rects.length) return null;
    // longueur couverte par l union d intervalles, bornee a la zone utile
    const couvre = (iv, a, b) => {
      iv = iv.map(([x, y]) => [Math.max(a, x), Math.min(b, y)]).filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]);
      let tot = 0, cx = -Infinity, cy = -Infinity;
      for (const [x, y] of iv) { if (x > cy) { tot += cy - cx > 0 ? cy - cx : 0; cx = x; cy = y; } else cy = Math.max(cy, y); }
      return tot + (cy - cx > 0 ? cy - cx : 0);
    };
    const hz = z.b - z.t, lz = z.r - z.l;
    const bas = Math.max(...rects.map((r) => r.bottom)), droite = Math.max(...rects.map((r) => r.right));
    return {
      zone: { largeur: Math.round(lz), hauteur: Math.round(hz) },
      videBas: Math.max(0, Math.round(z.b - bas)),
      videDroite: Math.max(0, Math.round(z.r - droite)),
      videVertical: Math.max(0, Math.round(hz - couvre(rects.map((r) => [r.top, r.bottom]), z.t, z.b))),
      videHorizontal: Math.max(0, Math.round(lz - couvre(rects.map((r) => [r.left, r.right]), z.l, z.r))),
    };
  }

  // Taille REELLE a l ecran du plus petit texte des graphiques SVG : un
  // graphique reduit rapetisse aussi ses libelles. Signale aussi un graphique
  // deforme (etire plus dans un sens que dans l autre).
  function lisibilite(cadre) {
    let min = Infinity, deforme = 0;
    for (const svg of cadre.querySelectorAll("svg")) {
      const vb = svg.viewBox && svg.viewBox.baseVal, r = svg.getBoundingClientRect();
      if (!vb || !vb.width || !vb.height || !r.width) continue;
      const kx = r.width / vb.width, ky = r.height / vb.height;
      if (svg.getAttribute("preserveAspectRatio") === "none") deforme = Math.max(deforme, Math.max(kx, ky) / Math.min(kx, ky));
      for (const t of svg.querySelectorAll("text")) {
        const fs = parseFloat(getComputedStyle(t).fontSize);
        if (fs) min = Math.min(min, fs * Math.min(kx, ky));
      }
    }
    return {
      texteGraphiqueMin: min === Infinity ? null : +min.toFixed(1),
      deformationGraphique: deforme ? +deforme.toFixed(2) : null,
    };
  }

  window.ATELIER.lister = () => GROUPS.map((g) => ({ groupe: g.n, cartes: g.s.map((s) => s.n) }));
  window.ATELIER.reglages = () => ({ ...R });
  window.ATELIER.analyser = (nom, opts = {}) => {
    if (!banc) return { erreur: "l'atelier n'est pas encore affiché" };
    const x = trouve(nom);
    if (!x) return { erreur: "carte inconnue : " + nom };
    const avant = { ...R };
    Object.assign(R, opts);
    try {
      const s = x.s, t = tailleDe(s);
      const fiche = (w, px, py) => {
        const defs = mesure(s, w, px, py);
        return { defauts: defs, remplissage: remplissage(banc), ...lisibilite(banc) };
      };
      const contenu = [];
      for (let w = 1; w <= 16; w++)
        contenu.push({ modules: w, px: largeurPx(w), hauteurContenu: hauteurContenu(s, largeurPx(w)) });
      const declarees = [];
      for (const h of hauteurs(t))
        for (const w of largeurs(t))
          declarees.push({ modules: w, demiRangees: h, px: largeurPx(w), py: hauteurPx(h), ...fiche(w, largeurPx(w), hauteurPx(h)) });
      const w0 = largeurs(t)[0];
      const auDela = [
        { cas: "2 modules de plus que le max", modules: t.max + 2, demiRangees: t.h[1] },
        { cas: "2 demi-rangées de plus que le max", modules: Math.max(t.l, w0), demiRangees: t.h[2] + 2 },
        { cas: "1 module de moins que le minimum", modules: Math.max(1, w0 - 1), demiRangees: t.h[1] },
        { cas: "1 demi-rangée de moins que le minimum", modules: Math.max(t.l, w0), demiRangees: Math.max(1, t.h[0] - 1) },
      ].map((c) => ({ ...c, px: largeurPx(c.modules), py: hauteurPx(c.demiRangees), ...fiche(c.modules, largeurPx(c.modules), hauteurPx(c.demiRangees)) }));
      const minimums = Object.fromEntries(hauteurs(t).map((h) => [h, minimumMesure(s, h)]));
      const telephone = hauteurs(t).map((h) => ({ demiRangees: h, py: hauteurPx(h), ...fiche(4, TELEPHONE, hauteurPx(h)) }));
      return { carte: s.n, groupe: x.g.n, taille: s.taille, niveau: s.niveau, ajuste: s.ajuste || null,
               declaration: t, reglages: { ...R }, contenu, declarees, auDela,
               largeurMinMesureeParDemiRangees: minimums, telephone };
    } finally { Object.assign(R, avant); }
  };

  /* Appele par `dessineGroupes()` a chaque rafraichissement de la page. On ne
     redessine pas a chaque tour (toutes les 2 s, cela casserait le cadre libre
     en plein redimensionnement), seulement :
     - au premier passage ;
     - quand l objet DATA est le meme (un clic sur « 24 h · 7 j » redessine) ;
     - quand le scenario de demonstration change ;
     - en continu si « Données en direct » est coche. */
  let premier = true;
  window.ATELIER.dessine = (d) => {
    const meme = d === donnees;
    const scenario = typeof DEMO_ID !== "undefined" ? DEMO_ID : null;
    const change = scenario !== demoVu;
    donnees = d; demoVu = scenario;
    if (premier) { premier = false; squelette(); liste(); detail(); return; }
    if (meme || change || direct) { if (change) resultats.clear(); liste(); detail(); }
  };
})();
