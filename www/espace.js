/* espace.js — le fond spatial du tableau de bord, et l habillage du contenu
   qui va avec (verre, relief, etat du homelab). Mis au point du 27/10 au
   01/11/2026 avec Alexis, choix par choix ; ce qui a ete essaye et refuse est
   note la ou ca s applique, pour ne pas le reproposer.
   Sans WebGL, la page reprend son fond d origine (fond.css) ; sans ce fichier,
   elle reste sur le noir de l espace (espace.css).

   La scene est peinte UNE FOIS par un shader WebGL, hors du fil principal
   (espace-scene.js), recopiee dans un canevas 2D, puis le contexte WebGL est
   rendu : un contexte garde ouvert peut etre perdu
   (iPhone en arriere-plan) et le fond deviendrait noir.
   ⚠️ PAS D IMAGE `blob:` : la CSP de la page (`img-src 'self' data:`) la
   refuse, et le fond restait invisible. Un canevas n y est pas soumis.
   Seuls quelques petits elements bougent ensuite, en CSS : etoiles qui
   scintillent, vaisseaux.
   ⚠️ Le verre des cartes recalcule son flou des que ce qui est dessous change :
   tout ce qui bouge reste petit et lent.

   L AMBIANCE : Star Citizen melange de Cyberpunk. L espace, la planete a
   anneaux et la lune viennent du premier ; du second, les villes cyan et
   magenta sur la face de nuit et le magenta de la nebuleuse (une constante
   du shader, « neon », ramene a Star Citizen seul).
   Retires a la demande d Alexis : la trame de lignes (un voile blanc qui
   ternissait l image), l anneau orbital en pointilles, la station (avec ses
   feux et son repere « HOMELAB »), la petite lune devant la planete et le
   soleil visible.
   ⚠️ LA PLANETE EST CELLE DU DEUXIEME RENDU, preferee par Alexis a une version
   « realiste » (atmosphere physique, calottes, villes sur les cotes) : ne pas
   la refaire sans le lui demander. La lune, elle, est en relief.
   Etoiles : le melange de deux styles essayes, « realistes » et « cinema ».

   L ETAT DU HOMELAB est integre au decor, comme une meteo spatiale, a la place
   des halos qui teintaient toute la page : une aurore sur le haut de la
   planete (violette au calme, ambre en incident, rouge en panne), et en
   panne la moitie des villes dans le noir.

   LE CONTENU (dans espace.css) : un verre adapte a une scene nette, et un
   relief avec une lumiere qui vient d en haut, fait d OMBRES SEULES, sans aucun
   blanc. Tout est en relief, sauf les pastilles, les rails et la carte Jellyfin,
   creuses (point 3 bis). Les menus deroulants prennent la matiere de leur parent. */
(() => {
  "use strict";
  const aurora = document.querySelector(".aurora");
  if (!aurora) return;

  // les reglages memorises par les panneaux d essai (10 et 11/2026) ne servent plus
  try {
    for (const k of ["fond", "etoiles", "etoiles-2", "verre", "relief", "creuse"]) localStorage.removeItem("homelab.essai-" + k);
    localStorage.removeItem("homelab.test-infos"); localStorage.removeItem("homelab.test-infos-2");
  } catch (x) { /* stockage refuse */ }


  /* La scene se peint dans un travailleur (espace-scene.js). */

  /* 4. CE QUI BOUGE, en HTML par-dessus l image */

  // Le biseau des graphiques (relief, point 5), en ombres seules : le bas de
  // chaque forme s assombrit dedans (la forme moins elle-meme remontee d un
  // pixel), et un liseré d ombre ne depasse QUE dessous (operateur out), pour
  // ne pas assombrir les aires translucides par transparence.
  // ⚠️ Plus de reflet speculaire : le relief est fait SANS blanc.
  document.body.insertAdjacentHTML("beforeend", `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
<filter id="esp-biseau" x="-2%" y="-10%" width="104%" height="125%" color-interpolation-filters="sRGB">
  <feOffset in="SourceAlpha" dy="-1" result="remonte"/>
  <feComposite in="SourceAlpha" in2="remonte" operator="out" result="basDedans"/>
  <feFlood flood-color="#000" flood-opacity=".3"/>
  <feComposite in2="basDedans" operator="in" result="ombreDedans"/>
  <feOffset in="SourceAlpha" dy="1" result="decale"/>
  <feComposite in="decale" in2="SourceAlpha" operator="out" result="bord"/>
  <feFlood flood-color="#000" flood-opacity=".38"/>
  <feComposite in2="bord" operator="in" result="ombre"/>
  <feMerge><feMergeNode in="ombre"/><feMergeNode in="SourceGraphic"/><feMergeNode in="ombreDedans"/></feMerge>
</filter></svg>`);

  // Vaisseau sans contour : coque sombre, eclairee par le haut (le soleil),
  // un aileron, et un reacteur qui brille. Les identifiants de degrade
  // different d un vaisseau a l autre.
  const VAISSEAU = (k) => `<span class="coque"><i></i><svg viewBox="0 0 27 10" aria-hidden="true">
  <defs><linearGradient id="esp-v${k}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#9aaed6"/><stop offset=".4" stop-color="#2b3454"/><stop offset="1" stop-color="#0a0e1b"/></linearGradient></defs>
  <path d="M1 5.5 4 3.7 13 3 22 4.3 26 5.2 22 6.1 13 6.9 4 6.6Z" fill="url(#esp-v${k})"/>
  <path d="M10 3.2 15 1.4 17 3.5Z" fill="#232b47"/></svg></span>`;

  const espace = document.createElement("div");
  espace.className = "espace";
  const image = document.createElement("canvas");
  image.className = "espace-image";
  espace.append(image);
  aurora.append(espace);

  // positions tirees une fois pour toutes, toujours les memes
  let graine = 7;
  const hasard = () => (graine = (graine * 16807) % 2147483647) / 2147483647;
  const tirage = Array.from({ length: 28 }, () => [hasard(), hasard(), hasard(), hasard()]);

  // Le milieu de l espace libre entre deux elements, page en haut ; null s il
  // n y a pas la place de passer.
  function couloir(dessus, dessous) {
    if (!dessus || !dessous) return null;
    const y0 = dessus.getBoundingClientRect().bottom + scrollY;
    const y1 = dessous.getBoundingClientRect().top + scrollY;
    return y1 - y0 >= 16 ? (y0 + y1) / 2 : null;
  }
  function couloirs() {
    const fige = document.getElementById("fige");
    const haut = fige && fige.offsetHeight ? fige : document.getElementById("bar");
    const recherche = document.querySelector(".search");
    return [couloir(haut, document.querySelector(".racc")), couloir(recherche, recherche && recherche.nextElementSibling)];
  }
  function placeVaisseaux() {
    const ys = couloirs();
    espace.querySelectorAll(".vaisseau").forEach((v, k) => {
      if (ys[k] == null) v.style.display = "none";
      else { v.style.display = ""; v.style.top = ys[k].toFixed(0) + "px"; }
    });
  }

  function decore(w, h) {
    let html = "";
    for (const [x, y, t, d] of tirage) {
      const px = x * w, py = y * h * .55;
      html += `<span class="scint" style="left:${px.toFixed(0)}px;top:${py.toFixed(0)}px;--t:${(2.5 + t * 4).toFixed(1)}s;--d:${(-d * 6).toFixed(1)}s"></span>`;
    }
    html += `<div class="vaisseau" style="--duree:75s;--d:6s;--x0:-60px;--x1:${w + 20}px">${VAISSEAU(0)}</div>`;
    html += `<div class="vaisseau retour" style="--duree:95s;--d:38s;--x0:${w + 20}px;--x1:-60px">${VAISSEAU(1)}</div>`;
    for (const e of [...espace.children]) if (e !== image) e.remove();
    image.insertAdjacentHTML("afterend", html);
    placeVaisseaux();
  }
  // La barre et les raccourcis se remplissent apres coup (donnees chargees) :
  // le couloir est remesure au depart de chaque passage, vaisseau invisible.
  for (const ev of ["animationstart", "animationiteration"])
    espace.addEventListener(ev, (e) => { if (e.target.classList.contains("vaisseau")) placeVaisseaux(); });

  // L etat montre : celui que pose app.js (`data-sante`, deja relu du
  // navigateur au chargement).
  const etatCourant = () => {
    const e = document.body.dataset.sante;
    return e === "warn" || e === "crit" ? e : "ok";
  };
  let taille = [0, 0], fondu = null;
  // Acheve tout de suite un fondu en cours : son image passe dans `image`.
  function finFondu() {
    if (!fondu) return;
    clearTimeout(fondu.minuterie);
    image.getContext("2d").drawImage(fondu.cv, 0, 0);
    fondu.cv.remove();
    fondu = null;
  }
  /* La scene demandee au travailleur : seule la derniere demande compte. Sans
     travailleur, sans OffscreenCanvas ou sans WebGL : le fond d origine revient. */
  const sansScene = () => document.body.classList.add("sans-scene");
  let fil = null, demande = 0, etatDemande = null;
  try { fil = new Worker("espace-scene.js"); } catch (x) { sansScene(); }
  if (fil) {
    fil.onerror = sansScene;
    fil.onmessage = ({ data: d }) => {
      if (d.n !== demande) { if (d.image) d.image.close(); return; }
      if (!d.image) return sansScene();
      finFondu();
      // Changement d etat a taille egale : la nouvelle scene va dans un second
      // canevas pose par-dessus, qui apparait en fondu puis remplace l image.
      const parDessus = d.enFondu && image.width === d.image.width && image.height === d.image.height;
      const cible = parDessus ? document.createElement("canvas") : image;
      cible.width = d.image.width;
      cible.height = d.image.height;
      cible.style.width = d.w + "px";
      cible.style.height = d.h + "px";
      cible.getContext("2d").drawImage(d.image, 0, 0);
      d.image.close();
      espace.dataset.etat = d.etat;
      if (parDessus) {
        cible.className = "espace-image fondu";
        image.after(cible);
        void cible.offsetWidth;                 // part bien de l opacite 0
        cible.classList.add("visible");
        fondu = { cv: cible, minuterie: setTimeout(finFondu, 2500) };
        return;
      }
      taille = [d.w, d.h];
      decore(d.w, d.h);
      espace.classList.add("pret");
    };
  }
  function dessine(enFondu) {
    const w = aurora.clientWidth, h = aurora.clientHeight;
    if (!fil || !w || !h) return;
    etatDemande = etatCourant();
    fil.postMessage({ n: ++demande, w, h, dpr: window.devicePixelRatio || 1, etat: etatDemande, enFondu: !!enFondu });
  }
  /* APRES LA PREMIERE IMAGE : la carte graphique, partagee, n a pas a compiler le
     shader pendant que la page s affiche. La minuterie en plus : un onglet en
     arriere-plan n a pas d images. */
  let lancee = false;
  const premiere = () => {
    if (lancee) return;
    lancee = true;
    if (!demande) dessine();
  };
  requestAnimationFrame(premiere);
  setTimeout(premiere, 300);
  new MutationObserver(() => { if (demande && etatCourant() !== etatDemande) dessine(true); })
    .observe(document.body, { attributes: true, attributeFilter: ["data-sante"] });
  addEventListener("load", placeVaisseaux);
  // Les cartes arrivent apres coup et changent la hauteur de la page : les
  // couloirs des vaisseaux sont remesures a chaque fois.
  let remesure = 0;
  new ResizeObserver(() => {
    clearTimeout(remesure);
    remesure = setTimeout(placeVaisseaux, 250);
  }).observe(document.querySelector("main"));

  // Redessine si la largeur change, ou la hauteur de plus de 15 % : la barre
  // d adresse d un telephone qui se replie ne doit pas tout repeindre.
  let attente = 0;
  addEventListener("resize", () => {
    clearTimeout(attente);
    attente = setTimeout(() => {
      const w = aurora.clientWidth, h = aurora.clientHeight;
      if (w !== taille[0] || Math.abs(h - taille[1]) > taille[1] * .15) dessine();
      else placeVaisseaux();
    }, 300);
  });

})();
