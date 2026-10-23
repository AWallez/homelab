/* ===== Homelab — tableau de bord maison ===== */
/* IP : dans `site.js` ; go : dans `cartes.js`, charges avant ce fichier. */

/* NOM DES FENETRES (09/10/2026). Un lecteur d ecran annoncait « boite de
   dialogue » sans dire laquelle. Toute fenetre ouverte prend son titre (son
   premier `<h3>`) pour nom. Pose sur le PROTOTYPE, avant tout le reste : les
   fenetres creees a la volee (mot de passe, PC) en heritent comme `#dlg`. */
{
  const ouvre = HTMLDialogElement.prototype.showModal;
  let n = 0;
  HTMLDialogElement.prototype.showModal = function () {
    const t = this.querySelector("h3");
    if (t) { if (!t.id) t.id = "titre-fenetre-" + (++n); this.setAttribute("aria-labelledby", t.id); }
    else this.removeAttribute("aria-labelledby");
    return ouvre.call(this);
  };
}

/* Defilement doux, sauf si le systeme demande de reduire les animations. */
const defilementDoux = () => matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

/* LE FOND DU DERNIER ETAT CONNU, DES LE CHARGEMENT (08/10/2026). Le fond
   partait du bleu « tout va bien » et ne virait qu une fois data.json lu, en
   2,4 s de fondu : chaque rechargement montrait un faux « tout va bien ».
   L etat garde dans le navigateur est pose tout de suite, SANS fondu ; le vrai
   le remplace a la premiere lecture. C est un confort d affichage : sans
   stockage, la page se comporte comme avant. */
(() => {
  let e = null;
  try { e = localStorage.getItem("homelab.sante"); } catch (x) { /* stockage refuse */ }
  if (!e) return;
  document.body.classList.add("sans-fondu");
  document.body.dataset.sante = e;
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove("sans-fondu")));
})();
const Go = (o) => (o / 1073741824).toFixed(1).replace(".", ",") + " Go";
const Mo = (o) => o > 1048576 ? (o / 1048576).toFixed(1).replace(".", ",") + " Mio/s"
      : Math.round(o / 1024) + " Kio/s";
const To = (o) => (o / 1099511627776).toFixed(1).replace(".", ",");
const Gk = (k) => (k / 1048576).toFixed(1).replace(".", ",");

/* Volume, avec bascule en tebioctets au-dela de 1024 Gio : « 1280,0 Go » se
   lit mal la ou « 1,25 Tio » se comprend. En dessous du seuil, `Go()` garde
   la main — « il manque 697,7 Go » vaut mieux que « 0,68 Tio ». */
const vol = (o) => o >= 1099511627776
  ? (o / 1099511627776).toFixed(2).replace(".", ",") + " Tio" : Go(o);

/* ---- Composants d'affichage ---- */
const nb = (v) => (+v || 0).toLocaleString("fr-FR");
const pc = (v) => Math.max(0, Math.min(100, +v || 0));
const vg = (x) => String(x).replace(".", ",");

const mesures = (l) => `<div class="stats">${l.map(([v, t]) =>
  `<div class="st"><b>${esc(v)}</b><span>${esc(t)}</span></div>`).join("")}</div>`;

const hero = (v, l, t) => `<div class="hero${t ? " " + t : ""}"><b>${esc(v)}</b><span>${l}</span></div>`;

const jauge = (v, l, w, c) => `<div class="jauge">
  <div class="jauge-t"><b>${esc(v)}</b><span>${esc(l)}</span></div>
  <div class="jauge-b"><i style="width:${pc(w)}%;background:${c || "var(--sbl)"}"></i></div></div>`;

const calme = (h, t) => `<div class="calme${t ? " " + t : ""}"><span class="k">${
  t === "bl" ? "&#9654;" : "&#10003;"}</span><span>${h}</span></div>`;

const past = (l) => `<div class="past">${l.filter(Boolean).map((e) =>
  `<span${e[1] ? ` class="${e[1]}"` : ""}>${esc(e[0])}</span>`).join("")}</div>`;


/* Mediane : resume une serie de temps de reponse sans qu un unique pic la
   deforme. La moyenne, elle, se laisse tirer par un seul echantillon parti
   a trois secondes. */
const mediane = (a) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const duree = (m) => {
  m = Math.round(m);
  if (m < 1) return "moins d'une minute";
  if (m < 60) return m + " min";
  const h = Math.floor(m / 60), r = m % 60;
  // Minutes completees a deux chiffres : « 1 h 06 » se lit comme une
  // duree, « 1 h 6 » comme une coquille.
  return h + " h" + (r ? " " + String(r).padStart(2, "0") : "");
};

/* Duree d indisponibilite, en minutes. Elle est EXACTE et non estimee :
   `siteup` valant 1 (joignable) ou 2 (injoignable), la moyenne d un creneau
   moins 1 est exactement la PROPORTION de sondes ratees ; multipliee par la
   duree du creneau, elle donne des minutes.

   ⚠️ Le resultat NE DEPEND PAS de la cadence du collecteur : une proportion
   n a pas d unite. La premiere version de ce commentaire l attribuait a une
   sonde par minute — il y en a deux — et le calcul serait juste a n importe
   quel rythme. Un creneau a 0 n a aucune mesure et ne compte pas. Voir la
   convention dans `collect.sh`. */
const coupure = (v, pas) => v.reduce((a, x) => a + (x > 0 ? (x - 1) * pas : 0), 0);

/* Ruban de joignabilite. Reprend `.batt` de la carte Kuma pour garder le meme
   vocabulaire visuel, avec deux differences reglees dans `fond.css` :
   - 48 cases et non 96 : sur une carte d une colonne, 340 px interieurs, les
     95 gouttieres de 3 px en mangeraient 285 et les cases tomberaient a 0,6 px.
   - un quatrieme etat, `nd`, pour un creneau SANS MESURE. Sans lui le ruban
     serait ecarlate pendant ses 24 premieres heures.
   ⚠️ Chaque case prend le PIRE des creneaux qu elle couvre : une panne de dix
   minutes ne doit pas se diluer dans une moyenne de demi-heure. */
/* ⚠️ SVG ETIRE, PAS UNE RANGEE DE DIVS. La version en flex donnait des barres
   INEGALES et, sous une certaine largeur, inexistantes : sur un ruban de 317 px,
   des cases de 2,42 ou 2,44 px — donc 2 ou 3 px une fois peintes — sur la carte
   VPN, et de 0,19 px sur la carte Kuma, ou 144 gouttieres de 2 px mangeaient 288
   des 317 px disponibles.
   La cause est structurelle : UNE GOUTTIERE FIXE NE SE COMPRIME PAS, et le
   rapport barre/gouttiere se degrade avec la largeur.
   Dans un viewBox de n unites etire par `preserveAspectRatio="none"`, chaque
   barre occupe exactement une unite : les largeurs sont egales PAR CONSTRUCTION
   et la gouttiere devient proportionnelle. Meme technique que `.courbe`. */
const ruban = (v, n, alt, ts, col) => {
  n = n || 48;
  const c = [];
  for (let k = 0; k < n; k++) {
    const a = Math.floor(k * v.length / n);
    const b = Math.max(a + 1, Math.floor((k + 1) * v.length / n));
    const s = v.slice(a, b).filter(x => x > 0);
    const p = s.length ? Math.max(...s) : 0;
    c.push(!s.length ? "nd" : p <= 1.001 ? "" : p >= 1.999 ? "dn" : "wn");
  }
  return `<svg class="batt fin" viewBox="0 0 ${n} 10" preserveAspectRatio="none"`
    + ` role="img" aria-label="${esc(alt || "Joignabilité sur 24 heures")}"`
    + (ts && ts.length > 1
        ? ` data-lec="batt" data-t0="${ts[0]}" data-ps="${Math.round((ts[ts.length - 1] - ts[0]) / (n - 1 || 1))}"`
          + (col ? ` data-col="${esc(col)}"` : "")
        : "")
    + `><rect class="capt" x="0" y="0" width="${n}" height="10"/>`
    + c.map((x, k) => `<rect x="${(k + 0.13).toFixed(2)}" width="0.74" height="10"${
        x ? ` class="${x}"` : ""}/>`).join("")
    + `</svg>`;
};

/* ECHELLE HORAIRE D UN RUBAN.
   Le ruban disait QUE le port avait lache, jamais QUAND — premiere question
   devant une case rouge, et la reponse doit se recouper avec `watchdog.log`.

   ⚠️ LES HEURES VIENNENT DES HORODATAGES REELS, colonne `t` de l historique, et
   non d un « maintenant moins 24 h ». La serie couvre 23,83 h, et moins encore
   dans les heures qui suivent un redemarrage : une echelle supposee decalerait
   tous les reperes sans que rien ne le dise.

   ⚠️ Les reperes tombent sur des HEURES RONDES LOCALES, pas a intervalle regulier
   depuis le bord. « 14 h » se recoupe avec un journal ; « il y a 6 h » demande un
   calcul mental a chaque lecture.

   ⚠️ Rien au-dela de 90 % : l etiquette y chevaucherait « maintenant ». */
const echelle = (ts, pas, n) => {
  if (!ts || ts.length < 2) return "";
  const t0 = ts[0], t1 = ts[ts.length - 1], d = t1 - t0;
  if (!(d > 0)) return "";
  const m = [];
  /* AU-DELA DE DEUX JOURS, UN REPERE PAR MINUIT, nomme par le jour qui
     commence (« mar. ») : sept jours d heures feraient 28 etiquettes. Le pas
     se fait au calendrier, pas en secondes, pour rester sur minuit les jours
     de changement d heure. */
  /* ⚠️ ET UN TRAIT TOUTES LES 3 H, SANS TEXTE (`tic`, 18/10/2026, demande) :
     l echelle se lit au meme pas qu en 24 h ; 56 etiquettes ne tiendraient pas. */
  if (d > 2 * 86400) {
    const z = new Date(t0 * 1000); z.setHours(Math.ceil(z.getHours() / 3) * 3, 0, 0, 0);
    for (; z / 1000 <= t1; z.setHours(z.getHours() + 3)) {
      const x = (z / 1000 - t0) / d * 100;
      if (x < 0.2 || x > 99.8 || z.getHours() % 3) continue;
      if (z.getHours()) { m.push(`<span class="rep tic" style="left:${x.toFixed(1)}%"></span>`); continue; }
      const cl = x < 4 ? "rep deb" : x > 94 ? "rep bout" : "rep";
      m.push(`<span class="${cl}" style="left:${x.toFixed(1)}%">${z.toLocaleDateString("fr-FR", { weekday: "short" })}</span>`);
    }
    return `<div class="ech">${m.join("")}</div>`;
  }
  for (let t = Math.ceil(t0 / 3600) * 3600; t <= t1; t += 3600) {
    const h = new Date(t * 1000).getHours();
    if (h % (pas || 6)) continue;
    /* ⚠️ DEUX REPERAGES, selon ce que l echelle legende. Sous un GRAPHE, le
       point i tombe a i/(n-1) de la largeur et le calcul direct convient. Sous
       un RUBAN, le releve i est dessine comme une CASE occupant [i, i+1] sur n,
       dont le milieu est a (i+0,5)/n : le calcul direct decalait alors le
       repere de 3,8 px a chaque bord, nul au centre, ce qui se voit. */
    const x = n
      ? (((t - t0) / d * (ts.length - 1)) + 0.5) / n * 100
      : (t - t0) / d * 100;
    // ⚠️ LES BORDS CHANGENT D ANCRAGE, ils ne sont pas ecartes. Une etiquette
    // centree deborde pres de 0 % et de 100 %, et le plafond de 96 % qui la
    // protegeait faisait sauter un repere sur quatre : le 28/08 « 18 h »
    // tombait a 96,53 %. Pres des bords on la cale donc par son cote, et le
    // TRAIT reste a sa position exacte — c est lui qui porte la mesure.
    if (x < 0.2 || x > 99.8) continue;
    const cl = x < 4 ? "rep deb" : x > 94 ? "rep bout" : "rep";
    m.push(`<span class="${cl}" style="left:${x.toFixed(1)}%">${String(h).padStart(2, "0")} h</span>`);
  }
  return `<div class="ech">${m.join("")}</div>`;
};

/* RUBAN HORODATE : legende, ruban a pas fixe, echelle. Facteur commun aux cartes
   VPN et Kuma, qui ne differaient que par la colonne lue.

   ⚠️ UNE CASE = UNE DUREE FIXE. Un decoupage par INDEX donnait, pour 96 cases et
   145 releves, 47 cases de 10 min et 49 de 20 : une case rouge valait le simple
   ou le double, ce qui vide l echelle horaire de son sens. On fixe donc le NOMBRE
   DE RELEVES PAR CASE et le nombre de cases s en deduit.

   ⚠️ Le reste de la division est retire au DEBUT : l alignement est exact du cote
   le plus recent, celui qu on regarde, et c est la case la plus ancienne qui est
   sacrifiee. La meme troncature s applique aux horodatages, sans quoi l echelle
   serait decalee d un releve par rapport au ruban qu elle legende.

   ⚠️ Deux releves et pas trois : a 30 min les trous de cinq a dix minutes se
   fondraient tous en ambre. A 20 min, un trou de 10 min reste ambre et un creneau
   entierement mort devient rouge. */
/* `carte` : son selecteur « 24 h · 7 j » (18/10/2026, demande). Sur 7 jours,
   la serie horaire (`Hs`), toujours en barres sur une ligne : une barre par
   heure, qui vaut la MOYENNE des releves 1/2 de l heure (history-build.sh),
   donc ambre des qu une partie de l heure manquait, rouge si rien n a
   repondu. ⚠️ MEME TAILLE DE CARTE dans les deux periodes : seule la serie
   change, la disposition de la page ne bouge pas (une grille d une ligne par
   jour, essayee, la faisait grandir). */
const rubanH = (d, col, alt, par, carte) => {
  const s7 = carte && sept(carte);
  const v = s7 ? Hs(d, col) : Hn(d, col), PAR = s7 ? 1 : par || 2;
  const dec = v.length % PAR;
  const vc = v.slice(dec), tsc = (s7 ? Hs(d, "t") : Hn(d, "t")).slice(dec);
  const n = Math.max(1, Math.floor(vc.length / PAR));
  const pc = tsc.length > PAR ? (tsc[PAR] - tsc[0]) / 60 : 0;
  return `<div class="rleg"><span>${pc ? "1 barre = " + esc(duree(pc)) : ""}</span>`
    + `<span>maintenant</span></div>`
    + ruban(vc, n, alt + (pc ? ", une case par " + duree(pc) : ""), tsc, col)
    // ⚠️ Pas de 3 h et non 6. Sur 24 h cela fait huit reperes espaces de
    // 12,5 %, soit 66 px sur un ruban de 530 et 35 px sur un de 278, pour
    // des etiquettes de ~24 px. C est la limite basse : a 2 h elles se
    // toucheraient sur une demi-carte.
    + echelle(tsc, 3, n);
};

/* ETAT PAR GROUPE DE SONDES.
   La carte annoncait « 3 sondes hors ligne » sans dire lesquelles : il fallait
   ouvrir Kuma pour savoir par ou commencer. Elle les NOMME, groupe par groupe.
   ⚠️ Aucun ruban par groupe, et c est delibere : trois rubans tripleraient
   l encre pour trois lignes vertes en permanence.
   ⚠️ Au-dela de trois noms on abrege. Une ligne qui deborde ne se lit pas, et
   passe le troisieme c est le groupe entier qui est en cause, pas une sonde
   qu on irait chercher par son nom. */
const grpk = (gs) => {
  if (!gs || !gs.length) return "";
  /* ⚠️ « en attente » n est PAS « hors ligne ». Kuma enchaine ses tentatives
     avant de declarer une panne : mesure du 28/08, une sonde arretee passe en
     attente au bout d une minute et y reste plus de deux minutes. Pendant ce
     temps elle echoue reellement — il faut le dire — mais l annoncer « hors
     ligne » serait faux, et le mot qu on emploie a 3 h du matin compte. */
  const cite = (l, n) => (l || []).slice(0, 3).join(", ")
    + (n > 3 ? " et " + (n - 3) + " autres" : "");
  return `<div class="trks grps">` + gs.map(g => {
    const ko = +g.ko || 0, att = +g.att || 0;
    let val = "✓", cl = "ok", dit = nb(g.tot || 0) + " sondes en ligne";
    if (ko > 0) {
      val = String(ko); cl = "wn";
      dit = cite(g.noms, ko) + " hors ligne" + (att ? " · " + att + " en attente" : "");
    } else if (att > 0) {
      val = String(att); cl = "wn";
      dit = cite(g.natt, att) + " en attente";
    }
    return `<div class="trk${ko || att ? " ko" : ""}"><span class="n">${esc(g.n)}</span>`
      + `<b class="${cl}">${esc(val)}</b><span class="q">${esc(dit)}</span></div>`;
  }).join("") + `</div>`;
};

/* Serie d historique : colonne i du resume 24 h. */
const H = (d, i) => ((d.hist && d.hist.j) || []).map(p => +p[i] || 0);

/* Acces a l historique PAR NOM de colonne.
   `history.json` publie la liste `champs` : s en servir plutot que de compter
   les colonnes a la main supprime toute une classe de bug. La page a trace
   pendant des semaines la colonne 12 sous l etiquette « swap » alors que le swap
   etait en 11 — invisible, parce que 43 % et 46 °C dessinent la meme ligne au
   meme endroit du graphique.
   Consequence heureuse : `collect.sh` peut ajouter ses colonnes en FIN de ligne
   plutot que dans l ordre logique, ce qui evite de deplacer une colonne existante
   et de rendre faux tout l historique deja enregistre. */
const col = (d, n) => (((d.hist || {}).champs) || []).indexOf(n);
const Hn = (d, n) => { const i = col(d, n); return i < 0 ? [] : H(d, i); };

/* Meme lecture par nom, sur la serie de SEPT JOURS au pas d une heure.
   ⚠️ Elle a SES colonnes (`champs_s`) depuis le 08/10/2026 : `siteup`, les
   temperatures des disques et, depuis le 09/10, les courbes des cartes pour
   leur vue « 7 j ». Un fichier plus ancien n a que `champs`, commun aux deux
   series. */
const Hs = (d, n) => { const h = d.hist || {};
  const i = (h.champs_s || h.champs || []).indexOf(n);
  return i < 0 ? [] : (h.s || []).map(p => +p[i] || 0); };

/* ---- 24 H OU 7 JOURS, CARTE PAR CARTE (09/10/2026) -------------------------
   Chaque carte a graphe porte un selecteur « 24 h · 7 j » (voir `periode`).
   24 h par defaut, au pas de la minute (`Hf`) ; 7 jours au pas de l heure
   (`Hs`). Le choix est garde dans le navigateur : un confort d affichage, sans
   stockage la page revient a 24 h.
   ⚠️ L ETAT VIT HORS DU RENDU, dans `PERIODES` : la carte est redessinee toutes
   les deux secondes et le selecteur ne fait que le lire.
   ⚠️ Les PASTILLES des cartes restent sur 24 h (pointes, moyennes) : sur 7
   jours, la moyenne horaire ecraserait justement les pointes qu elles citent. */
let PERIODES = {};
try { PERIODES = JSON.parse(localStorage.getItem("homelab.periodes") || "{}") || {}; } catch (x) { /* stockage refuse */ }
const sept = (carte) => PERIODES[carte] === "7j";
/* La serie tracee par une carte selon sa periode, et le texte qui va avec. */
const Hp = (d, carte, n) => sept(carte) ? Hs(d, n) : Hf(d, n);
const surP = (carte) => sept(carte) ? "sur 7 jours" : "sur 24 h";

/* Colonnes de temperature par disque, triees, quel qu en soit le nombre. La
   machine a quatre emplacements M.2 de donnees, dont trois libres, plus celui du
   systeme : un SSD ajoute plus tard apparaitra tout seul, sans toucher ni au
   collecteur ni a la page. */
const disquesHist = (d) => (((d.hist || {}).champs) || [])
  .filter(n => /^nvme\d+$/.test(n)).sort();

/* ---- Serie FINE, au pas d une minute --------------------------------------
   `history.json` resume 24 h en 145 points de 10 minutes, ou une pointe de
   processeur d une minute disparait dans la moyenne. `history-min.json` publie
   les memes 24 h au pas d UNE MINUTE, pour les onze colonnes que tracent les
   trois cartes concernees.

   ⚠️ IL N ENTRE PAS DANS LA BOUCLE DE 2 s. Il pese le triple et ne change qu une
   fois par minute : le retelecharger trente fois par minute serait du trafic
   pur. Il est mis en cache ici et renouvele toutes les 30 s.

   ⚠️ LES DEUX SERIES N ONT PAS LES MEMES COLONNES. Chercher un indice dans l une
   pour lire dans l autre rendrait une temperature a la place d un debit. `colf`
   interroge les champs de la serie fine, et `Hf` retombe proprement sur la serie
   a 10 min tant que le fichier n existe pas — au premier demarrage, ou si le
   cron n est pas encore passe. */

/* ---- `systeme.json`, ecrit par `systeme.py` chaque minute (05/10/2026) ----
   Memoire, stockage, securite, acces, reseau, Internet, ventilateurs, detail
   de la sauvegarde et periodes de panne de chaque sonde Kuma. Relu toutes les
   20 s : le fichier ne change qu une fois par minute.
   ⚠️ Absent ou illisible, il ne casse rien : les cartes gardent ce que donne
   `data.json`, ou leur etat d attente. */
/* ---- LECTURES SOBRES (08/10/2026) ----
   Chaque fichier etait relu toutes les 2 s avec `?Date.now()` : une URL neuve a
   chaque fois, donc JAMAIS de 304. Un seul onglet ouvert tirait 129 Mo et
   20 000 requetes par heure, dont 94 Mo pour `history.json`, qui ne change
   qu une fois par minute.
   1. `cache: "no-cache"` : le navigateur revalide aupres de nginx (ETag) et
      recoit un 304 sans corps quand rien n a change ;
   2. chaque fichier a sa CADENCE, calee sur celle de son collecteur ;
   3. rien ne part quand l onglet est cache (voir `refresh`).
   ⚠️ L objet rendu est PARTAGE entre deux lectures : la page y range ses ajouts
   (`d.hist`, la fusion de systeme.json), qu elle reecrit a chaque tour. */
const LUS = new Map();      // url -> { t, v }
async function lire(url, periode) {
  const c = LUS.get(url);
  if (c && Date.now() - c.t < periode * 1000) return c.v;
  /* ⚠️ 15 S AU PLUS (09/10/2026). Un NAS qui accepte la connexion sans jamais
     repondre laissait la lecture en attente pour toujours : le tour ne finissait
     jamais, `TOUR` restait pris, plus rien ne se rafraichissait, et la bande
     « Le NAS ne repond plus » ne pouvait pas s afficher, faute d erreur. */
  const r = await fetch(url, { cache: "no-cache", signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(url + " : " + r.status);
  const v = await r.json();
  LUS.set(url, { t: Date.now(), v });
  return v;
}
const lireOuRien = (url, periode) => lire(url, periode).catch(() => null);
/* Lecture ponctuelle, sans cache de page : le contenu, ou `defaut` si le
   fichier manque ou si la reponse est une erreur.
   ⚠️ `r.ok` D ABORD (09/10/2026) : sur un fichier absent, nginx rend sa page
   d erreur 404 en HTML ; lue comme du texte, elle passait pour un contenu
   valide (l etat d une mise a jour en cours). */
async function lireOu(url, defaut, texte) {
  try {
    const r = await fetch(url, { cache: "no-cache", signal: AbortSignal.timeout(15000) });
    if (!r.ok) return defaut;
    return texte ? await r.text() : await r.json();
  } catch { return defaut; }
}

async function lireSysteme() {
  /* Ecrit chaque minute par systeme.py : relu toutes les 30 s. Absent, il ne
     casse rien. */
  return lireOuRien("systeme.json", 30);
}
/* Fusion dans les donnees de la page. Chaque cle de `systeme.json` remplace
   celle de `data.json` ; les cles partagees (sauvegarde, SMART, conteneurs)
   sont COMPLETEES et non remplacees. */
function fusionSysteme(d, s) {
  if (!s) return;
  for (const k of ["secu", "acces", "lan", "wan", "mem", "fankarr", "journal"]) if (s[k]) d[k] = s[k];
  if (s.fans && d.nas) d.nas.fans = s.fans;
  if (s.backup) d.backup = Object.assign({}, d.backup, s.backup);
  if (s.kuma) d.kuma = Object.assign({}, d.kuma, s.kuma);
  if (s.stock && d.smart) {
    d.smart.grappes = s.stock.grappes;
    d.smart.slots = s.stock.slots;
    for (const x of d.smart.d || []) if ((s.stock.roles || {})[x.n]) x.role = s.stock.roles[x.n];
  }
  if (s.mem && s.mem.anon && d.cont)
    for (const x of d.cont.c || []) if (s.mem.anon[x.n] != null) x.anon = s.mem.anon[x.n];
  /* Detail de chaque disque pour sa fenetre, range sous le disque de smart.json.
     ⚠️ LA TEMPERATURE VIENT D ICI (08/10/2026), capteur « Composite » relu toutes
     les 10 min : celle de smart.json date de son passage quotidien, et etait
     pourtant coloree comme une valeur vivante. */
  if (s.disq && d.smart)
    for (const x of d.smart.d || []) {
      if (!s.disq[x.n]) continue;
      x.det = s.disq[x.n];
      const c = (x.det.capt || []).find(k => k[0] === "Composite");
      if (c && c[1] > 0) x.temp = c[1];
    }
}

/* ---- SEUILS DE TEMPERATURE, LES MEMES PARTOUT (08/10/2026) ----
   Le processeur passait a l ambre a 65 °C dans la barre, 70 dans la carte
   Systeme, 80 pour ntfy et 85 pour la carte Temperatures ; les disques a 55 dans
   la carte Stockage contre 70 ailleurs. Une seule table desormais, alignee sur
   les alertes ntfy (`alerts.sh`) : [attention, critique]. */
const SEUILS_T = { cpu: [80, 90], nvme: [70, 80] };
const teinteT = (v, s) => v >= s[1] ? "cr" : v >= s[0] ? "wn" : "ok";

/* Temperature du processeur LISSEE SUR 5 MIN. Le releve de la minute pile
   tombait pendant la rafale des taches cron : 64,5 °C de moyenne contre
   54,5 °C trente secondes plus tard, et la barre passait a l ambre pres d un
   tiers du temps pour une chaleur que la collecte produisait elle-meme. */
const tempCpu = (d) => {
  const v = Hf(d, "temp").slice(-5).filter(x => x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : (d.nas.temp || 0);
};

/* ---- FRAICHEUR DES DONNEES (08/10/2026) ----
   La page ne disait jamais que ses donnees avaient cesse de bouger : un
   collecteur arrete, ou le NAS injoignable (VPN coupe sur l iPhone), laissait
   « Tout va bien » sur des valeurs figees, avec une horloge qui continuait de
   battre. Chaque fichier porte maintenant son heure ; au-dela de trois fois sa
   cadence (deux minutes au moins), une bande le dit au-dessus des pastilles, et
   le fond perd ses couleurs : la page ne sait plus.
   ⚠️ Un fichier SANS horodatage (collecteur d avant) n est pas juge. */
const CADENCES = [["t", 30, "Collecte principale"], ["tLive", 2, "Mesures rapides"],
                  ["tSys", 60, "Collecteur système"]];
let DERNIER_OK = 0;      // derniere lecture reussie de data.json (ms)
function figeHtml(d) {
  const now = Date.now() / 1000, l = [];
  if (!d) {
    const s = DERNIER_OK ? now - DERNIER_OK / 1000 : 0;
    /* Une lecture ratee isolee n est pas une panne : 30 s de grace. */
    if (s < 30) return "";
    l.push("Le NAS ne répond plus depuis " + duree(s / 60)
      + " : réseau, VPN ou serveur. Les valeurs affichées sont les dernières reçues.");
  } else {
    for (const [k, cad, nom] of CADENCES) {
      const t = +d[k];
      if (!t) continue;
      const age = now - t;
      if (age > Math.max(3 * cad, 120)) l.push(nom + " : aucune mise à jour depuis " + duree(age / 60) + ".");
    }
  }
  const pb = d && Array.isArray(d.problemes) ? d.problemes : [];
  document.body.dataset.fige = l.length ? "1" : "";
  if (!l.length && !pb.length) return "";
  return (l.length ? `<div class="fg"><b>Données figées</b>${l.map(x => `<span>${esc(x)}</span>`).join("")}</div>` : "")
    + (pb.length ? `<div class="fg pb"><b>Relevés en échec</b><span>${esc(pb.slice(0, 3).join(" · "))}${
        pb.length > 3 ? " · +" + (pb.length - 3) : ""}</span></div>` : "");
}
async function histFin() {
  /* Une ligne par minute : relu chaque minute. Absent, le trace retombe sur
     la serie a 10 min. */
  return lireOuRien("history-min.json", 60);
}
const colf = (d, n) => (((d.fin || {}).champs) || []).indexOf(n);
const Hf = (d, n) => { const i = colf(d, n);
  return i < 0 ? Hn(d, n) : (((d.fin || {}).m) || []).map(p => +p[i] || 0); };

/* MOYENNE PAR PAQUETS, POUR LE TRACE SEULEMENT.
   La serie fine compte 1440 points sur 24 h pour une aire de trace de 480 px :
   trois points par pixel, sous un trait qui en vaut 3,2. Le resultat n etait plus
   une courbe mais une bande pleine, et la silhouette de qBittorrent etait pire —
   1440 points sur 256 px. On vise donc environ UN POINT PAR PIXEL, et le trait
   descend a 1,2 unite.

   ⚠️ ON REDUIT CE QU ON DESSINE, PAS CE QU ON LIT. `data-v` conserve la serie
   entiere et le survol continue de repondre a la minute. Consequence assumee :
   la courbe montre une moyenne de trois minutes la ou l infobulle donne une
   seule valeur, et les deux peuvent s ecarter sur une pointe breve.
   ⚠️ SAUF LA POINTE DE LA SERIE (09/10/2026) : le paquet qui contient le
   maximum garde ce maximum au lieu de sa moyenne. L echelle s arrete pile sur
   la plus haute valeur relevee (voir `graphe`) ; moyennee, la pointe d une
   minute n aurait jamais atteint le haut du graphe.

   ⚠️ Sans la serie fine, `p` vaut 1 et la fonction rend le tableau intact : les
   145 points de la serie a 10 min ne sont jamais degrades. */
const reduis = (v, cible) => {
  const p = Math.max(1, Math.ceil(v.length / cible));
  if (p === 1) return v;
  const im = v.indexOf(Math.max(...v));
  const o = [];
  for (let i = 0; i < v.length; i += p) {
    const s = v.slice(i, i + p);
    o.push(im >= i && im < i + p ? v[im] : s.reduce((a, b) => a + b, 0) / s.length);
  }
  return o;
};

/* Etiquettes de l AXE des graphes de debit : la gouttiere de `graphe()` ne
   fait que 26 unites, ou « 59,4 Mio/s » deborderait sur le trace. Version
   courte (« 59 M », « 1,5 M », « 850 K ») ; l infobulle garde la valeur
   entiere. */
const MoAxe = (v) => !v ? "0" : v >= 1048576
  ? vg((v / 1048576).toFixed(v >= 10485760 ? 0 : 1)) + " M" : Math.round(v / 1024) + " K";

/* Dernier point de l historique. C est la SEULE source pour les mesures qui ne
   transitent pas par data.json : les temperatures par disque et celle du
   controleur reseau ne sont ecrites que dans history.csv. Au pas de 10 min,
   c est assez frais pour une temperature. */
const dern = (d) => (((d.hist || {}).j) || []).slice(-1)[0] || [];

/* Graphique : echelle chiffree a gauche, axe de temps en bas, point terminal,
   seuil optionnel en pointille. Gouttiere de 26 px pour les etiquettes.

   - `o.min` deplace le BAS de l echelle. Quatre capteurs vivant entre 40 et
     72 degres etaient ecrases dans le tiers superieur d un axe partant de zero ;
     l axe part de 30 et les trois etiquettes suivent.
   - ⚠️ LE HAUT DE L ECHELLE EST LA PLUS HAUTE VALEUR RELEVEE DANS LA PERIODE
     AFFICHEE (09/10/2026), et plus un plafond fixe : 100 % laissait les deux
     tiers du graphe Systeme vides, 90 °C ecrasait les temperatures. Chaque vue
     prend le maximum de SES series : la vue 24 h ne monte pas jusqu a une
     pointe vue sur 7 jours. Un seuil hors de l echelle n est pas trace.
   - `x.d0` fait demarrer une serie LA OU SES DONNEES COMMENCENT. Une mesure
     ajoutee aujourd hui n a pas d historique hier : sans ca elle tracerait une
     ligne plate a zero sur vingt-trois heures, ce qui ressemble a une panne.
     ⚠️ A n activer que la ou zero signifie « pas de donnee ». Pour un
     pourcentage de processeur, zero est une valeur legitime et l option
     masquerait de vraies mesures. */
const graphe = (series, o) => {
  o = o || {};
  const ok = series.filter(x => x.v && x.v.length > 1
    && (!x.d0 || x.v.some(n => n > 0)));
  if (!ok.length) return `<div class="note">Historique en cours de constitution</div>`;
  const m = o.min || 0;
  const M = Math.max(m + 1, ...ok.flatMap(x => x.v));
  const f = o.f || (v => String(Math.round(v)));
  /* ⚠️ LE TRACE S ETIRE, PAS LES CHIFFRES (17/10/2026). Le graphe gardait les
     proportions de son dessin (300 x 84) : il ne grandissait qu avec la LARGEUR
     de la carte, jamais avec sa hauteur, et ses graduations, dessinees dedans,
     rapetissaient avec lui (pour 9 px, la carte Systeme devait faire 450 px).
     Les graduations sont maintenant du TEXTE de la page, dans une gouttiere de
     largeur fixe (`.gax`), et le trace (`preserveAspectRatio="none"`) prend toute
     la place que la carte lui laisse, en hauteur comme en largeur. Les traits
     gardent leur epaisseur (`vector-effect`, voir style.css) ; le point terminal
     est un trait de longueur nulle a bouts ronds : un cercle deviendrait une
     ellipse. Coordonnees du dessin : trace de 0 a 268 sur 272 (4 de marge pour
     le point), de 12 a 78 sur 84. */
  const Y = y => (78 - Math.min(Math.max(y - m, 0) / (M - m), 1) * 66).toFixed(1);
  const X = (i, n) => (i / (n - 1) * 268).toFixed(1);
  const haut = (y) => (y / 84 * 100).toFixed(2) + "%";
  /* ⚠️ LE MOT « SEUIL » A ETE RETIRE, ce n est pas un oubli. Ecrit en entier,
     l etiquette faisait 36,5 unites pour une gouttiere de 26 : elle debordait
     dans l aire de trace, ou elle traversait la courbe memoire. Reduite au seul
     nombre elle tient dans la gouttiere et se lit comme une QUATRIEME GRADUATION
     de l axe ; la couleur et le pointille disent qu il s agit d un seuil.
     ⚠️ Le `Math.min` retient l etiquette dans le cadre : un seuil bas la ferait
     sinon sortir sous l aire de trace, jusque dans l axe du temps.
     ⚠️ L echelle suivant les donnees, le seuil peut tomber au ras d une
     graduation : son etiquette est alors omise (le trait reste), sinon les deux
     nombres se chevauchent. */
  const ys = +Y(o.seuil);
  const sl = o.seuil == null || o.seuil > M || o.seuil < m ? "" :
    `<line x1="0" y1="${Y(o.seuil)}" x2="268" y2="${Y(o.seuil)}" stroke="${o.seuilC || "#ff453a"}"
       stroke-width="1.4" stroke-dasharray="4 4" opacity=".75"/>`;
  const slt = sl && [12, 45, 78].every(y => Math.abs(y - ys) > 7)
    ? `<span class="sl" style="top:${haut(Math.min(ys, 76))};color:${o.seuilC || "#ff8f88"}">${esc(f(o.seuil))}</span>` : "";
  /* Trois series se superposent depuis la fusion Systeme + swap : on allege
     le remplissage, sinon les aires s additionnent en une soupe. */
  const op = ok.length >= 3 ? ".11" : ".16";
  /* UNE COURBE QUI S AGITE S AFFINE (17/10/2026, revue au telephone :
     « quand ca varie trop c est illisible »). Jusqu a 480 points dans 270 px :
     un debit qui monte et descend a chaque point devenait, en trait de 2 px, un
     pave plein. L agitation = le trajet vertical de la courbe rapporte a sa
     largeur (unites du dessin) : calme < 1,5 (trait de 2), agitee (1,5),
     tres agitee des 4 (1,25) ; un cran de moins dans une carte etroite
     (style.css). Mesure du 17/10 : debit recu de qBittorrent 16,7, processeur
     5,1, temperatures 0,7 a 1,6. */
  const agite = (pts) => {
    let t = 0;
    for (let i = 1; i < pts.length; i++) t += Math.abs(pts[i] - pts[i - 1]);
    const a = t / 268;
    return a >= 4 ? " tres-agitee" : a >= 1.5 ? " agitee" : "";
  };
  const ts = o.ts || [];
  return `<div class="grb"><div class="gax" aria-hidden="true"><span style="top:${haut(12)}">${esc(f(M))}</span>`
    + `<span style="top:${haut(45)}">${esc(f((M + m) / 2))}</span><span style="top:${haut(78)}">${esc(f(m))}</span>${slt}</div>`
    + `<svg class="gr" viewBox="0 0 272 84" preserveAspectRatio="none" role="img" aria-label="${esc(o.alt || "historique")}" data-lec="gr" data-x0="0" data-x1="268" data-u="${esc(o.u || "%")}"${ts.length > 1 ? ` data-t0="${ts[0]}" data-t1="${ts[ts.length - 1]}"` : ""}>
    <rect class="capt" x="0" y="6" width="268" height="78"/>
        <g stroke="rgba(255,255,255,.10)" stroke-width="1">
      <line x1="0" y1="12" x2="268" y2="12"/><line x1="0" y1="45" x2="268" y2="45"/><line x1="0" y1="78" x2="268" y2="78"/>
    </g>${sl}
    ${ok.map(x => { const vd = reduis(x.v, 480), n = vd.length;
      const k = x.d0 ? Math.max(0, vd.findIndex(z => z > 0)) : 0;
      const kf = x.d0 ? Math.max(0, x.v.findIndex(z => z > 0)) : 0;
      const pts = vd.slice(k).map((y, i) => X(i + k, n) + "," + Y(y)).join(" L ");
      return `<path d="M ${pts} L 268,78 L ${X(k, n)},78 Z" fill="${x.c}" fill-opacity="${op}"/>
      <path class="serie${agite(vd.slice(k).map(Y))}" data-n="${esc(x.n || "")}" data-k="${kf}" data-v="${x.v.map(z => +(+z).toFixed(1)).join(",")}" d="M ${pts}" fill="none" stroke="${x.c}" stroke-width="2" stroke-linejoin="round"/>
      <path class="bout" d="M 268,${Y(vd[n - 1])} L 268,${Y(vd[n - 1])}" stroke="${x.c}" stroke-width="7" stroke-linecap="round"/>`; }).join("")}
  </svg></div>` + (ts.length > 1 ? `<div class="gech">${echelle(ts, o.pas || 3)}</div>` : "");
};

const pct = v => Math.round(v) + " %";

/* Sept valeurs quotidiennes = sept barres. Une courbe suggererait une continuite
   qui n existe pas entre deux jours. */
const jours = (a) => {
  const v = (a || []).map(x => +x || 0);
  if (!v.length) return "";
  const M = Math.max(1, ...v), haut = Math.max(0, ...v);   // `haut` : le vrai maximum (une semaine a zero disait « max 1 »)
  // Un jour a zero garde un talon visible : sans lui, la barre disparait et
  // la serie ressemble a un trait casse plutot qu a un jour sans visite.
  return `<div class="jours"><div class="b">${v.map((y, i) =>
      `<i class="${i === v.length - 1 ? "now" : ""}" data-lec="jour" data-v="${y}" data-i="${i}" data-n="${v.length}"
          style="height:${y === 0 ? 8 : Math.max(30, y / M * 100)}%"></i>`).join("")}</div>
    <em>7 derniers jours · max ${haut}/jour</em></div>`;
};

/* Troisieme element optionnel : la VALEUR INSTANTANEE de la serie. Elle a
   remplace les trois anneaux de la carte Systeme, qui repetaient la barre du
   haut pour trente fois leur hauteur. Les appels a deux elements restent
   valides, `v` vaut alors undefined. */
const leg = (l) => `<div class="leg">${l.map(([t, c, v]) =>
  `<span><i style="background:${c}"></i>${esc(t)}${
    v != null ? `<b>${esc(v)}</b>` : ""}</span>`).join("")}</div>`;

/* Memoire d un conteneur en Mo, depuis le pourcentage de `docker stats`. */
const moC = (p, rt) => rt ? Math.round(p / 100 * rt / 1024) : 0;

/* ⚠️ La pastille etait DECLAREE dans style.css — `.etatv .ep` et sa variante
   `.ep.ko` en rouge — mais jamais emise : le troisieme argument etait ignore
   depuis l origine. La carte VPN le passait pour rien, son etat de tunnel n a
   donc jamais eu son point de couleur. Corrige le 24/08/2026, en meme temps
   que l arrivee du bandeau d etat de qBittorrent. */
const etatv = (v, sub, ok) => `<div class="etatv">
  <span class="ep${ok ? "" : " ko"}"></span>
  <span class="vv"><b>${esc(v)}</b><span>${esc(sub)}</span></span></div>`;

/* ---- Composants des cartes « Reseau et securite » (05/10/2026) ---- */

/* Liste de controles, une ligne par verification. Trois etats et non deux :
   `in` dit un fait qui n est ni bon ni mauvais — le SSH ouvert est voulu tant
   qu on s en sert, il ne doit ni rassurer en vert ni alarmer en ambre. */
const controles = (l) => `<ul class="chk">${l.filter(Boolean).map(([t, txt, q]) =>
  `<li class="${t}"><span class="k">${t === "wn" ? "!" : t === "in" ? "i" : "&#10003;"}</span>`
  + `<span>${esc(txt)}</span>${q ? `<em>${esc(q)}</em>` : ""}</li>`).join("")}</ul>`;

/* Intertitre a l interieur d une carte qui empile deux listes. */
const intertitre = (t) => `<div class="sh">${esc(t)}</div>`;

/* Sessions ouvertes, une tuile par protocole. Une tuile ETEINTE plutot
   qu absente : « aucun partage ouvert » est une information, et la rangee
   garde la meme forme d un rendu a l autre. */
const sessions = (l) => `<div class="ses">${l.map(x =>
  `<span class="${x.c > 0 ? "" : "vide"}"><i></i>${esc(x.t)} · ${
    x.c > 0 ? esc(x.n || "?") + (x.c > 1 ? " ×" + x.c : "") : "aucun"}</span>`).join("")}</div>`;

/* Journal des connexions. L heure seule pour aujourd hui, le jour au-dela :
   « 21:40 » sans date laisserait croire a une connexion de ce soir.
   ⚠️ LES CONNEXIONS IDENTIQUES QUI SE SUIVENT SONT REGROUPEES (« ×4 ») : un
   script qui se connecte en boucle remplissait les quatre lignes de la carte
   avec la meme entree, et cachait la connexion d avant (05/10/2026). L heure
   affichee est celle de la plus recente. */
const journal = (l, max) => {
  const auj = new Date().toDateString();
  const g = [];
  for (const x of l) {
    const p = g[g.length - 1];
    /* `c` arrive deja compte par le collecteur ; la page n ajoute que ce qu il
       n a pas regroupe lui-meme. */
    if (p && p.s === x.s && p.u === x.u && p.n === x.n && p.r === x.r && p.ok === x.ok) p.c += x.c || 1;
    else g.push(Object.assign({}, x, { c: x.c || 1 }));
  }
  return `<div class="jr">${g.slice(0, max || g.length).map(x => {
    const t = new Date((x.t || 0) * 1000);
    const h = t.toDateString() === auj
      ? t.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
      : t.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
    return `<div><span class="h">${h}</span><span class="s">${esc(x.s)}</span>`
      + `<span class="q">${esc(x.u)} · ${esc(x.n)}${x.c > 1 ? ` <small>×${x.c}</small>` : ""}</span>`
      + `<span class="r ${x.ok ? "ok" : "wn"}">${esc(x.r)}</span></div>`;
  }).join("")}</div>`;
};

/* D ou vient une connexion exterieure (08/10/2026), relu dans `acces.geo` :
   [code pays, pays, ville, operateur, hebergeur]. C est ce qui dit si elle est
   inquietante : un telephone en 5G en France n est pas un serveur loue a
   l autre bout du monde. Le pays et l operateur sont fiables ; la ville d une
   adresse MOBILE est souvent celle du reseau de l operateur, d ou son rang
   second. « hébergeur ou VPN » est un indice tire du nom de l operateur. */
const lieu = (g) => !g ? "" : [[g[2], g[1]].filter(Boolean).join(", "), g[3]].filter(Boolean).join(" · ")
  + (g[4] ? " · hébergeur ou VPN" : "");

/* Bloc « Depuis Internet » de la carte Acces, place EN TETE : c est la raison
   de l alerte. Le 08/10/2026, la connexion exterieure etait introuvable sous
   quatre lignes de sessions SSH du PC. Une ligne par adresse : la connexion la
   plus recente, combien de fois sur 24 h, puis d ou elle vient. */
const depuisInternet = (a) => {
  const ev = (a.ev || []).length
    ? a.ev.filter(x => +x[6]).map(x => ({ t: +x[0], s: x[1], u: x[2], n: x[3], r: x[4], ok: !!+x[5], c: 1 }))
    : (a.log || []).filter(x => x.x).map(x => Object.assign({}, x, { c: x.c || 1 }));
  if (!ev.length) return "";
  const m = new Map();
  for (const e of ev.sort((p, q) => q.t - p.t)) {
    const p = m.get(e.n);
    if (p) { p.c += e.c; p.ok = p.ok && e.ok; } else m.set(e.n, Object.assign({}, e));
  }
  const l = [...m.values()];
  const auj = new Date().toDateString(), hier = new Date(Date.now() - 864e5).toDateString();
  const quand = (t) => { const j = new Date(t * 1000).toDateString();
    return (j === auj ? "" : j === hier ? "hier " : new Date(t * 1000)
      .toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) + " ") + hhmm(t); };
  return intertitre("Depuis Internet") + `<div class="dint">${l.slice(0, 3).map(x =>
    `<div><span class="q">${esc(x.u)} · ${esc(x.s)} · ${quand(x.t)}${x.c > 1 ? ` <small>×${nb(x.c)}</small>` : ""}</span>`
    + `<span class="r ${x.ok ? "ok" : "wn"}">${esc(x.r)}</span>`
    + `<span class="lieu">${(a.geo || {})[x.n] ? esc(lieu(a.geo[x.n])) + ` <small>${esc(x.n)}</small>`
      : esc(x.n) + " <small>localisation inconnue</small>"}</span></div>`).join("")}${
    l.length > 3 ? `<div class="note">et ${nb(l.length - 3)} autre${l.length > 4 ? "s adresses" : " adresse"}</div>` : ""}</div>`;
};

/* Barres classees : libelle, valeur, longueur en %, couleur, precision.
   Plus simple que `bars()` des conteneurs, qui scinde memoire et swap. */
const rangs = (l) => `<div class="rangs">${l.map(([n, v, w, c, s]) =>
  `<div class="rg"><span>${esc(n)}${s ? `<small>${esc(s)}</small>` : ""}</span><b>${esc(v)}</b>`
  + `<i style="width:${pc(w).toFixed(1)}%;background:${c || "var(--sbl)"}"></i></div>`).join("")}</div>`;

/* Jauge empilee : plusieurs segments sur la meme piste. */
const pile = (v, l, parts) => `<div class="jauge empilee">
  <div class="jauge-t"><b>${esc(v)}</b><span>${esc(l)}</span></div>
  <div class="jauge-b pile">${parts.map(([w, c]) =>
    `<i style="width:${pc(w).toFixed(2)}%;background:${c}"></i>`).join("")}</div></div>`;

/* Barre de composition. Un segment marque `h` est HACHURE : il se rend a la
   demande, comme le cache, et ne doit pas se lire comme de la place prise. */
const hachure = (c) => `repeating-linear-gradient(135deg,${teinte(c, .55)} 0 4px,${teinte(c, .2)} 4px 8px)`;
/* ⚠️ CLASSE `ramc`, PAS `compo` : `.compo` est deja le bloc barre + legende de
   la fenetre des conteneurs. La reprendre ici avait ecrase ce bloc a 9 px de
   haut, et sa legende debordait sur les titres de colonnes (05/10/2026). */
const compo = (parts) => `<div class="jauge-b pile ramc">${parts.map(([w, c, h]) =>
  `<i style="width:${pc(w).toFixed(2)}%;background:${h ? hachure(c) : c}"></i>`).join("")}</div>`;

/* Barres a deux tons : le plein en memoire, le voile tasse en zram. Meme
   lecture que les barres des conteneurs, a l echelle d une application. */
const rangsDuo = (l) => `<div class="rangs">${l.map(([n, v, w1, w2, c, s]) =>
  `<div class="rg"><span>${esc(n)}${s ? `<small>${esc(s)}</small>` : ""}</span><b>${esc(v)}</b>`
  + `<span class="p"><i style="width:${pc(w1).toFixed(1)}%;background:${c}"></i>`
  + (w2 > 0 ? `<i style="width:${pc(w2).toFixed(1)}%;background:${teinte(c, .38)}"></i>` : "")
  + `</span></div>`).join("")}</div>`;

/* N NUANCES D UNE COULEUR, de la plus claire a la plus foncee, la couleur de base
   au milieu. Elles servent aux sous-parties d une categorie : on reconnait la
   famille a la teinte, et chaque membre a sa clarte. Ecart borne a 35 % vers le
   blanc et vers le noir, au-dela les extremes se confondaient avec le fond. */
const nuances = (hex, n) => {
  const v = parseInt(hex.slice(1), 16), rgb = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const mix = (t) => "#" + rgb.map(c => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t)))
    .map(c => c.toString(16).padStart(2, "0")).join("");
  if (n <= 1) return [hex];
  return Array.from({ length: n }, (_, i) => mix(.35 - .7 * i / (n - 1)));
};

/* Megaoctets en Mo ou Go, a la francaise. */
const moGo = (mo) => mo >= 1000 ? vg((mo / 1024).toFixed(1)) + " Go" : Math.round(mo) + " Mo";

/* Volume en octets, a l unite la plus lisible. `vol()` reste a la page pour
   les gros volumes ; ici on descend jusqu au Mo, l ordre d une copie du jour.
   Une seule decimale en To, comme la barre du haut : « 4,4 To » doit se lire
   pareil sur la carte et dans la barre. */
const taille = (o) => o >= 1099511627776 ? vg((o / 1099511627776).toFixed(1)) + " To"
  : o >= 1073741824 ? vg((o / 1073741824).toFixed(1)) + " Go"
  : Math.max(0, Math.round(o / 1048576)) + " Mo";

/* Duree d une operation en secondes : « 40 s », « 2 min 40 », « 5 h 02 ».
   Arrondie AVANT d etre decoupee : 119,6 s donnait « 1 min 60 » ; et au-dela
   d une heure, « 302 min 05 » (17/10/2026). */
const chrono = (s) => {
  s = Math.round(s);
  if (s < 60) return s + " s";
  if (s < 3600) return Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0");
  return Math.floor(s / 3600) + " h " + String(Math.floor(s % 3600 / 60)).padStart(2, "0");
};

/* Pastille des ventilateurs : compacte quand tout tourne, NOMINATIVE des
   qu un ventilateur faiblit, seul cas ou savoir lequel importe. */
const ventilos = (f, min) => {
  if (!f || !f.length) return null;
  const lent = f.filter(x => x.rpm < min);
  return lent.length
    // chacun avec SON regime : deux lents donnaient le regime du premier pour les deux ;
    // sans le mot « boîtier » des noms du collecteur (« ventilateurs 1 à 450 et 2 à 380 »)
    ? [(lent.length > 1 ? "ventilateurs " : "ventilateur ") + lent.map(x => String(x.n).replace(/^bo[iî]tier\s+/i, "") + " à " + nb(x.rpm)).join(" et ") + " tr/min", "wn"]
    : ["ventilateurs " + f.map(x => nb(x.rpm)).join(" · ") + " tr/min"];
};

/* « 4,6 / 7,3 To » plutot que « 4,6 To / 7,3 To » quand l unite est la meme. */
const surTotal = (a, b) => {
  const x = taille(a), y = taille(b), u = y.split(" ").pop();
  return (x.endsWith(" " + u) ? x.slice(0, -u.length - 1) : x) + " / " + y;
};

/* Carte Stockage : L ORGANISATION DU STOCKAGE, telle que la machine la monte.
   Un bloc par GRAPPE — le volume de donnees et son type de RAID, puis le disque
   systeme a part — et, dans chaque bloc, les SSD qui la composent. Les
   emplacements libres ferment la liste : c est la que se joue un miroir.
   ⚠️ LA BARRE DE PLACE APPARTIENT AU VOLUME, PAS AU DISQUE. Aujourd hui un seul
   SSD porte le volume, et les deux se confondent ; avec un second SSD en miroir,
   une barre par disque montrerait deux fois les memes donnees.
   ⚠️ LES PETITS POSTES ONT UNE LARGEUR MINIMALE A L ECRAN (CSS). Les medias font
   98 % du volume : a l echelle, iSCSI ou Docker tiendraient dans un tiers de
   pixel. La legende donne les vraies tailles.
   Version retenue le 05/10/2026, qui a ecarte la tendance de
   remplissage, la relecture complete et le taux de la partition racine : rien
   de ce qui n appelle pas une action.
   Le detail par disque — rythme d ecriture, duree de vie, arrets brutaux —
   reste calcule par `disques()`, reserve a la fenetre.
   `cfg` porte les libelles du site (`ESPACE`, `ROLES`) : ce fichier n en sait rien. */
const RAID = { raid0: "RAID 0", raid1: "RAID 1", raid5: "RAID 5", raid6: "RAID 6", raid10: "RAID 10",
               linear: "JBOD", single: "disque simple" };
/* Ce qui protege une grappe, selon son RAID (17/10/2026 : un RAID 5 etait dit
   « miroir actif ») : un miroir (1, 10), une parite (5, 6), ou rien (0, JBOD,
   disque simple). Un RAID inconnu garde l ancien libelle, « miroir ». */
const redondance = (g) => !g.raid ? "miroir"
  : { raid1: "miroir", raid10: "miroir", raid5: "parité", raid6: "parité" }[g.raid] || null;
const ligneDisque = (x, cfg) => {
  const role = cfg.ROLES[x.role];
  const modele = x.modele.replace(/_/g, " ").replace(/\s*\d+(?:[.,]\d+)?\s*(?:GB|TB|Go|To)$/i, "");
  const cap = x.go >= 1000 ? vg((x.go / 1000).toFixed(1)) + " To" : x.go + " Go";
  const ko = !x.ok || x.erreurs > 0;
  const tc = teinteT(x.temp, SEUILS_T.nvme);
  /* Un clic ouvre la fiche du disque (`popDisque`, ecouteur delegue : la carte
     est redessinee toutes les deux secondes). */
  return `<div class="dq" data-disque="${esc(x.n)}" role="button" tabindex="0" title="Voir le détail du disque">`
    + `<i class="${ko ? "cr" : "ok"}"></i>`
    + `<span class="dn"><b>${esc(role || modele)}</b><small>${esc(cap + (role ? " · " + modele : ""))}</small></span>`
    + `<em class="${tc}">${x.temp} °C</em>`
    + `<em class="${x.usure >= 80 ? "wn" : ""}">usure ${x.usure} %</em>`
    + `<em class="${ko ? "wn" : "ok"}">${x.erreurs} erreur${x.erreurs > 1 ? "s" : ""}</em>`
    + `<span class="ouvre" aria-hidden="true"></span></div>`;
};
/* LES DISQUES iSCSI VUS DE L INTERIEUR (09/10/2026, `disques_iscsi` dans
   systeme.py). Le volume ne voit qu un gros fichier, de la meme taille qu il
   soit vide ou plein ; le NAS lit donc la carte d occupation de NTFS dans ce
   fichier. La part du poste iSCSI que Windows a vraiment ecrite est dessinee
   pleine, le reste du disque a 38 % d opacite, comme le swap dans la fenetre
   Memoire. null sans releve. */
const fractionIscsi = (e) => {
  const l = ((e && e.iscsi) || []).filter(x => x.fs > 0 && x.used != null);
  const fs = l.reduce((a, x) => a + x.fs, 0);
  return fs ? l.reduce((a, x) => a + x.used, 0) / fs : null;
};

const grappesDisques = (s, cfg) => {
  const dq = (s && s.d) || [];
  const gs = ((s && s.grappes) || []).slice().sort((a, b) => (a.sys ? 1 : 0) - (b.sys ? 1 : 0));
  /* Sans releve SMART, les grappes (et la place du volume) restent affichees :
     toute la carte devenait « Relevé des disques en attente » (17/10/2026). */
  if (!dq.length && !gs.length) return `<div class="note">Relevé des disques en attente</div>`;
  /* Sans grappes (collecteur pas encore a jour) : les disques seuls. */
  if (!gs.length) return `<div class="blocs"><div class="dqb">${dq.map(x => ligneDisque(x, cfg)).join("")}</div></div>`;
  const vus = new Set();
  const blocs = gs.map(g => {
    const membres = dq.filter(x => (g.disques || []).includes(x.n));
    membres.forEach(x => vus.add(x.n));
    const e = g.esp || null;
    let tete;
    if (g.sys) tete = `<b>${esc(g.nom || "Système")}</b><span>hors grappe · disque de démarrage</span>`;
    else {
      const r = redondance(g);
      const etat = g.att < 2 ? ["aucun miroir", "wn"]
        : !r ? ["aucune redondance", "wn"]
        : g.n < g.att ? [(r === "parité" ? "grappe dégradée : " : "miroir dégradé : ") + g.n + "/" + g.att, "wn"]
        : [r === "parité" ? "parité active" : "miroir actif", "ok"];
      tete = `<b>${esc(g.nom)}</b><span>${esc([RAID[g.raid] || g.raid,
                g.att + " disque" + (g.att > 1 ? "s" : ""), g.fs].filter(Boolean).join(" · "))}</span>`
        + `<span class="faits"><span class="${etat[1]}">${esc(etat[0])}</span>`
        + (g.err != null ? `<span class="${g.err > 0 ? "wn" : "ok"}">${g.err > 0 ? nb(g.err) + " erreurs" : "0 erreur"} btrfs</span>` : "")
        + `</span>`;
    }
    let espace = "";
    if (e && e.tot) {
      /* Du plus gros au plus petit, « autres » toujours en dernier, comme dans
         la fenetre du volume (09/10/2026) : dans l ordre de la configuration,
         la barre melangeait grands et petits postes. */
      const parts = Object.keys(cfg.ESPACE).filter(k => ((e.parts || {})[k] || 0) > 0).map(k => [k, e.parts[k]])
        .sort(([a, x], [b, y]) => (a === "autres") - (b === "autres") || y - x);
      const used = e.used != null ? e.used : parts.reduce((a, [, o]) => a + o, 0);
      /* L espace LIBRE DANS LE DISQUE iSCSI est HACHURE, comme le cache de la
         carte Memoire (09/10/2026) : reserve sur le volume, mais rien n y est
         ecrit. La legende le dit en deux entrees, « écrit » et « libre ». */
      const fI = fractionIscsi(e);
      espace = `<div class="jauge-b pile">` + parts.map(([k, o]) => {
          const w = o / e.tot * 100, c = cfg.ESPACE[k][1];
          return k === "iscsi" && fI != null
            ? `<i style="width:${pc(w * fI).toFixed(2)}%;background:${c}"></i>`
              + `<i style="width:${pc(w * (1 - fI)).toFixed(2)}%;background:${hachure(c)}"></i>`
            : `<i style="width:${pc(w).toFixed(2)}%;background:${c}"></i>`; }).join("")
        + `</div><div class="bv"><span><b>${esc(surTotal(used, e.tot))}</b> · ${esc(taille(Math.max(0, e.tot - used)))} libres</span></div>`
        /* UNE SEULE ENTREE pour l iSCSI : pastille moitie pleine, moitie
           hachuree, et « 1,1 To · 370 Go libres ». */
        + leg(parts.map(([k, o]) => { const c = cfg.ESPACE[k][1];
            return k === "iscsi" && fI != null
              ? [cfg.ESPACE[k][0], `linear-gradient(90deg,${c} 50%,transparent 50%),${hachure(c)}`,
                 taille(o * fI) + " · " + taille(o * (1 - fI)) + " libres"]
              : [cfg.ESPACE[k][0], c, taille(o)]; }));
    }
    /* L en-tete et la barre d un volume de donnees ouvrent le detail de son
       espace (`popEspace`), les lignes de disque leur fiche. */
    const zone = !espace ? `<div class="gh">${tete}</div>${espace}`
      : `<div class="vz" data-espace="${esc(g.nom)}" role="button" tabindex="0" title="Voir ce qui prend la place">`
        + `<div class="gh">${tete}<span class="ouvre" aria-hidden="true"></span></div>${espace}</div>`;
    return `<div class="dqb${g.sys ? " sys" : ""}">${zone}`
      + `<div class="dqs">${membres.map(x => ligneDisque(x, cfg)).join("")}</div></div>`;
  });
  /* Un disque qu aucune grappe ne reclame : neuf, ou pas encore monte. */
  const seuls = dq.filter(x => !vus.has(x.n));
  if (seuls.length) blocs.push(`<div class="dqb"><div class="gh"><b>Hors grappe</b><span>disque non utilisé</span></div>`
    + `<div class="dqs">${seuls.map(x => ligneDisque(x, cfg)).join("")}</div></div>`);
  const sl = s.slots || null;
  if (sl && sl.libres > 0) {
    const mono = gs.find(g => !g.sys && g.raid === "raid1" && g.att < 2);
    blocs.push(`<div class="libre">${sl.libres} emplacement${sl.libres > 1 ? "s" : ""} M.2 libre${sl.libres > 1 ? "s" : ""} sur ${sl.tot}`
      + (mono ? ` · un second SSD ferait du ${esc(mono.nom.toLowerCase())} un vrai miroir` : "") + `</div>`);
  }
  if (!dq.length) blocs.push(`<div class="note">Relevé des disques en attente</div>`);
  return `<div class="blocs">${blocs.join("")}</div>`;
};

/* Anciennete en secondes. `duree()` compte en heures sans plafond, ce qui
   donne « 144 h » pour six jours : au-dela de deux jours on passe aux jours. */
const anciennete = (s) => s >= 172800 ? Math.round(s / 86400) + " j" : duree(s / 60);

/* GROUPS : dans `cartes.js`, charge avant ce fichier. */

const ICONS = {
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5z"/>',
  down: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  chart: '<path d="M3 17l5-6 4 4 4-7 5 9"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
};
const svg = (p, k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${k || 2}">${p}</svg>`;
const esc = (s) => String(s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
const label = (u) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");

/* ---- Etat d une carte (08/10/2026) ----
   `false`, `true`, ou `"incident"`. Une carte de la liste `TACHES` (CRM,
   Radarr…) porte d ordinaire une tache, qui ne fait pas virer le fond ; elle
   peut desormais dire qu il s agit d un vrai incident (l outil des mises a
   jour arrete, par exemple). Un service MUET (`ko` dans data.json, son API ne
   repond pas) est toujours un incident : sa carte affichait sinon des zeros en
   vert, « Aucun film manquant » pour un Radarr arrete. */
const muet = (s, d) => !!s.ko && (d.ko || []).includes(s.ko);
const etatCarte = (s, d) => {
  if (muet(s, d)) return "incident";
  if (!s.warn) return false;
  try { return s.warn(d); } catch (e) { return false; }
};
/* ⚠️ TROIS NIVEAUX DEPUIS LE 08/10/2026. `warn` peut aussi rendre `"crit"` :
   le service est hors d usage (site injoignable, tunnel tombe, lien coupe).
   C est un incident ROUGE, la ou l ambre dit « a regarder ». Avant, tout etait
   ambre, et l ambre allume a vingt endroits ne distinguait plus rien. */
const incident = (s, w) => w === "incident" || w === "crit" || (!!w && !TACHES.includes(s.n));
/* Classe de la pastille : rouge, ambre, ou TACHE (neutre, ne fait pas virer le fond). */
const niveau = (s, w) => !w ? "" : w === "crit" ? "crit incident" : incident(s, w) ? "warn incident" : "tache";

/* La RAISON d un etat, en quelques mots, pour la ligne sous la barre : le nom
   seul obligeait a descendre jusqu a la carte pour savoir de quoi il s agit.
   Chaque carte qui peut s allumer dit pourquoi (`pourquoi` dans `cartes.js`). */
const raison = (s, d, w) => {
  if (muet(s, d)) return "ne répond pas";
  if (s.pourquoi) { try { const r = s.pourquoi(d); if (r) return r; } catch (e) { console.warn(s.n, e); } }
  return w === "crit" ? "hors service" : "à vérifier";
};

/* « 1 film », « 3 films », « 0 film » : en francais, zero prend le singulier.
   Espace INSECABLE entre le nombre et le mot : un retour a la ligne ne les
   separe jamais. */
const pluriel = (n, s, p) => nb(n) + "\u00a0" + (Math.abs(n) > 1 ? (p || s + "s") : s);

/* Les messages de sante de Prowlarr arrivent en anglais, tels quels :
   « Indexers unavailable due to failures for more than 6 hours: Orion ». Les
   formes connues sont traduites ; une autre est citee entre guillemets, pour
   qu on sache que la phrase vient de Prowlarr et non de la page. */
const PROWLARR_OBJETS = { indexers: "indexeurs", applications: "applications",
  "download clients": "clients de téléchargement", proxies: "proxys", "indexer proxies": "proxys" };
const prowlarrFr = (m) => {
  m = String(m || "").trim();
  let r = m.match(/^All (indexers|applications|download clients|indexer proxies) are unavailable due to failures( for more than 6 hours)?\.?$/i);
  if (r) return "Tous les " + PROWLARR_OBJETS[r[1].toLowerCase()] + " sont en échec" + (r[2] ? " depuis plus de 6 h" : "");
  r = m.match(/^(Indexers|Applications|Download clients|Indexer proxies|Proxies) unavailable due to failures( for more than 6 hours)?: (.+)$/i);
  if (r) { const o = PROWLARR_OBJETS[r[1].toLowerCase()];
    return o[0].toUpperCase() + o.slice(1) + " en échec" + (r[2] ? " depuis plus de 6 h" : "") + " : " + r[3]; }
  r = m.match(/^Indexer VIP benefits (expiring soon|have expired): (.+)$/i);
  if (r) return (r[1].toLowerCase() === "have expired" ? "Statut VIP expiré : " : "Statut VIP bientôt expiré : ") + r[2];
  return m ? "« " + m + " »" : "";
};

// « Mises à jour » → « mises-a-jour »
const slug = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* `p` (bento, 17/10/2026) : la place donnee par le rangement (rangement.js),
   `{ x, y, w, h, haute }` en modules et demi-rangees. La carte porte alors son
   contrat de taille (`data-l`, `data-h`, `haute`) et sa case dans la grille de
   son groupe ; les classes de l ancienne grille (`c4`, `mini`) se deduisent de
   cette taille, comme dans l atelier. Sans `p`, la carte d avant (mode Compact).
   `pre` : son contenu deja calcule (`corpsCarte`), que le rangement a lu pour
   juger la carte ; sans lui, calcule ici.
   `p` sans hauteur (`{ style }`) : une tuile du mode Compact, qui ne porte que
   sa largeur (voir `tuiles`). */
function card(s, d, p, pre) {
  const { body, viz, v } = pre || corpsCarte(s, d);
  const main = s.u || s.x;
  /* `data-carte` : repere stable de la carte (nom sans accents ni espaces),
     pour lui donner des styles a elle seule (www/bento/*.css). `data-v` :
     l empreinte de son contenu ; la meme qu au tour d avant, `fondre` ne
     compare pas ce contenu, il met seulement la carte a sa place. */
  const bento = p && p.h != null;
  const id = `data-carte="${slug(s.n)}" data-v="${v}"` + (bento ? ` data-l="${p.w}" data-h="${p.h}" style="grid-column:${p.x + 1}/span ${p.w};grid-row:${p.y + 1}/span ${p.h}"`
    : p && p.style ? ` style="${p.style}"` : "");
  const kl = "card" + (viz ? " viz" : "") + (bento
    ? (p.w >= 10 ? " c4" : "") + (p.h <= 2 ? " mini" : "") + (p.haute ? " haute" : "")
    : (s.w === 4 ? " c4" : s.w === 3 ? " c3" : s.w === 2 ? " c2" : "") + (s.mini ? " mini" : ""));
  /* Focalisable et annoncee comme ouvrant une fenetre (09/10/2026) : au clavier,
     Tab y arrive, Entree ou Espace l ouvre (voir plus bas). */
  if (s.pop) return `<div class="${kl} clic" ${id} data-pop="${s.pop}" tabindex="0" role="button" aria-haspopup="dialog">${body}</div>`;
  return main ? `<a class="${kl}" ${id} rel="noreferrer" href="${main}">${body}</a>` : `<div class="${kl}" ${id}>${body}</div>`;
}

// le contenu d une carte, sans son enveloppe (sa place, ses classes)
function corpsCarte(s, d) {
  /* ⚠️ RENDU PROTEGE : une cle absente de data.json levait une exception, et
     c est TOUTE LA PAGE qui cessait de se mettre a jour. La carte fautive dit
     maintenant qu elle ne peut pas s afficher, les autres continuent. */
  const sur = (f) => { try { return f ? f(d) : null; } catch (e) { console.warn(s.n, e); return undefined; } };
  const tait = muet(s, d);
  let stats = tait ? null : sur(s.f);
  let viz = tait ? `<div class="note muet">${esc(s.n)} ne répond pas</div>` : sur(s.r);
  const note = tait ? null : sur(s.note);
  if (viz === undefined || stats === undefined) {
    viz = `<div class="note muet">Données illisibles pour cette carte</div>`; stats = null;
  }
  const warn = etatCarte(s, d);
  const logo = s.ic ? `<img src="icons/${s.ic.includes(".") ? s.ic : s.ic + ".svg"}" alt="">` : esc(s.n.slice(0, 2).toUpperCase());
  const adr = [s.x && `<span class="dom lien" data-lien="${esc(s.x)}" title="${esc(s.x)}">${esc(label(s.x))}</span>`, s.u && `<span class="port">:${esc(s.u.split(":").pop())}</span>`].filter(Boolean).join("");
  const body = `<div class="head"><span class="chip">${logo}</span>
      <div class="txt"><h3><span class="nom">${esc(s.n)}</span>${adr ? `<span class="adr">${adr}</span>` : ""}</h3>
        <p>${esc(s.d)}</p></div>
      ${s.per ? periode(s.n) : ""}<i class="dot${warn ? " " + niveau(s, warn) : ""}"></i>${s.pop ? '<i class="ouvre" aria-hidden="true"></i>' : ""}</div>
    ${viz ? `<div class="vizb">${viz}</div>` : ""}
    ${stats ? `<div class="stats">${stats.map(([v, l]) =>
      `<div class="st"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("")}</div>` : ""}
    ${note ? `<div class="note">${esc(note)}</div>` : ""}`;
  return { body, viz: !!viz, v: empreinte(body) };
}
// FNV-1a, et la longueur : deux contenus differents n ont pas la meme
const empreinte = (t) => {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return t.length.toString(36) + "." + (h >>> 0).toString(36);
};

/* Le selecteur « 24 h · 7 j » d une carte a graphe (`per: 1` dans cartes.js),
   pose dans son en-tete. Voir `PERIODES`.
   ⚠️ Des `<span role="button">` et non des `<button>` : plusieurs de ces cartes
   sont des liens `<a>`, ou un bouton n a pas sa place. Le clic est intercepte
   en phase de CAPTURE, avant le lien de la carte (voir plus bas). */
const periode = (carte) => `<span class="periode" role="group" aria-label="Période du graphe">${
  [["24h", "24 h"], ["7j", "7 j"]].map(([k, t]) => {
    const on = (sept(carte) ? "7j" : "24h") === k;
    return `<span role="button" tabindex="0" data-per="${k}" aria-pressed="${on}"${on ? ' class="on"' : ""}>${t}</span>`;
  }).join("")}</span>`;

addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-per]");
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  // le selecteur d une carte, ou celui de sa courbe en grand (`popGraphe`)
  const grand = b.closest("dialog") && b.closest("dialog").querySelector(".courbe");
  const carte = b.closest(".card") || (grand && document.querySelector(`#groups .card[data-carte="${grand.dataset.pour}"]`));
  const nom = carte && carte.querySelector(".nom");
  if (!nom) return;
  if (b.dataset.per === "7j") PERIODES[nom.textContent] = "7j";
  else delete PERIODES[nom.textContent];
  try { localStorage.setItem("homelab.periodes", JSON.stringify(PERIODES)); } catch (x) { /* stockage refuse */ }
  cacheTip();
  dessineGroupes();
  if (grand) popGraphe(document.querySelector(`#groups .card[data-carte="${grand.dataset.pour}"]`));
}, true);
addEventListener("keydown", (e) => {
  if ((e.key !== "Enter" && e.key !== " ") || !e.target.matches || !e.target.matches("[data-per]")) return;
  e.preventDefault(); e.stopPropagation();
  e.target.click();
}, true);

/* ⚠️ LA CARTE EST DEJA UN `<a>`, vers le service LOCAL des qu il en existe un.
   On ne peut pas y imbriquer un second lien : le navigateur fermerait le premier
   et casserait la structure de la carte. Le domaine public est donc un `<span>`
   rendu cliquable par DELEGATION.
   ⚠️ `stopPropagation` ET `preventDefault` : le premier empeche le clic
   d atteindre le lien de la carte, le second annule la navigation par defaut.
   Sans les deux, cliquer sur le domaine ouvrait le port local — l inverse de ce
   qu on demande.
   ⚠️ Phase de CAPTURE : le gestionnaire doit passer avant le lien de la carte.
   ℹ️ Ouverture dans le MEME onglet : le tableau de bord n est pas un portail
   qu on garde ouvert derriere soi. */
addEventListener("click", (e) => {
  const el = e.target.closest("[data-lien]");
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  location.href = el.dataset.lien;
}, true);

/* LES CARTES EN ALERTE, NOMMEES. Le fond passait a l ambre sans dire d ou ca
   venait, et il fallait parcourir les vingt-sept cartes pour trouver la
   coupable.
   ⚠️ MEME FILTRE QUE `sante()`, et surtout MEME LISTE `TACHES` : une carte
   qui ne fait pas virer le fond ne doit pas etre nommee ici, sinon la barre
   accuserait un innocent.
   ⚠️ Calcule sur les DONNEES et non sur le DOM. `sante()` tourne sur son
   propre intervalle : si elle ecrivait dans la barre, `fusionne` effacerait
   son texte au rendu suivant.
   ⚠️ `try` autour du predicat : une carte dont la donnee manque ne doit pas
   emporter toute la barre du haut avec elle. */
/* Toutes les cartes allumees, avec leur niveau et leur raison, dans l ordre de
   la page. `inc` distingue les incidents des TACHES. */
const etats = (d) => GROUPS.flatMap(g => g.s).map(s => {
  const w = etatCarte(s, d);
  return w ? { n: s.n, w, inc: incident(s, w), r: raison(s, d, w) } : null;
}).filter(Boolean);
const soucisDe = (d) => etats(d).filter(e => e.inc);

/* UNE PASTILLE PAR CARTE ALLUMEE, AVEC SA RAISON (08/10/2026).
   Les pastilles ne donnaient qu un nom : la raison etait au huitieme ecran sur
   iPhone. Chacune dit maintenant ce qui ne va pas ; un clic mene a la carte.
   Depuis le 09/10/2026 elles vivent DANS la barre collante, entre le menu des
   groupes et « Compact », et suivent donc le defilement.
   Deux blocs : les TACHES en neutre (films manquants, demandes, leads), qui se
   font sans alarme, TOUJOURS AU-DESSUS ; puis les incidents, rouges d abord. Chaque bloc passe a la ligne de son cote.
   ⚠️ Cinq incidents au plus, puis « + N autres » : un clic deplie le reste, un
   second le replie. L etat vit hors du rendu, refait toutes les deux secondes.
   ⚠️ DES `<span role="button">` ET NON DES `<button>` : dans la barre, toutes
   les regles des onglets visent `#filters button` (verre, taille, et surtout
   `display: none` hors du menu) et les auraient avalees. Le clavier est rendu
   plus bas (Entree, Espace). */
const MAX_INCIDENTS = 5;
let SOUCIS_TOUS = false;
const pastilles = (d) => {
  const l = etats(d);
  const inc = l.filter(e => e.inc).sort((a, b) => (b.w === "crit") - (a.w === "crit"));
  const tac = l.filter(e => !e.inc);
  const vus = SOUCIS_TOUS ? inc : inc.slice(0, MAX_INCIDENTS);
  const caches = inc.length - vus.length;
  const bt = (cl, attr, html) => `<span role="button" tabindex="0" class="pil ${cl}" ${attr}>${html}</span>`;
  /* LE NOM SEUL, LA RAISON AU SURVOL (09/10/2026) : la
     phrase entiere faisait passer les pastilles sur plusieurs lignes dans la
     barre collee. Elle passe dans l infobulle des courbes (`data-lec`), et
     dans le nom accessible de la pastille pour un lecteur d ecran. */
  const pil = (e, k) => bt(k, `data-carte="${esc(e.n)}" data-lec="raison" data-r="${esc(e.r)}" aria-label="${esc(e.n + " : " + e.r)}"`,
    (k === "tache" ? "" : "<i></i>") + `<b>${esc(e.n)}</b>`);
  const incs = vus.map(e => pil(e, e.w === "crit" ? "crit" : "inc")).join("")
    + (caches > 0 ? bt("plus", 'data-plus="1"', "+ " + pluriel(caches, "autre"))
       : SOUCIS_TOUS && inc.length > MAX_INCIDENTS ? bt("plus", 'data-plus="0"', "Réduire") : "");
  /* Un bloc vide n est pas rendu, pour que `#soucis:empty` fasse disparaitre
     la zone quand tout va bien. */
  return (tac.length ? `<div class="taches">${tac.map(e => pil(e, "tache")).join("")}</div>` : "")
    + (incs ? `<div class="incs">${incs}</div>` : "");
};
addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-plus]");
  if (!b) return;
  SOUCIS_TOUS = b.dataset.plus === "1";
  fondre(document.getElementById("soucis"), pastilles(DATA));
  placeEtSerre();
});
/* Entree et Espace sur une pastille ou la cloche : ce qu un `<button>` ferait
   de lui-meme. */
addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const el = e.target.closest && e.target.closest("#filters [role=button]");
  if (!el) return;
  e.preventDefault();
  el.click();
});

/* UNE PASTILLE SUR DEUX LIGNES EPOUSE SON TEXTE (09/10/2026).
   Un texte qui passe a la ligne donne a sa boite TOUTE la largeur disponible,
   meme quand ses lignes sont bien plus courtes : le fond colore s etalait pour
   rien. Le CSS ne sait pas resserrer une boite sur ses lignes ; on mesure donc
   la plus longue (une `Range` donne un rectangle par ligne) et on fixe la
   largeur dessus, rembourrage et bordure compris. Les coupures restent les
   memes : aucune ligne n est plus longue que la largeur fixee.
   ⚠️ Refait apres chaque rendu : `fondre` reecrit les attributs, et efface donc
   la largeur posee au tour precedent. */
function serrePastilles() {
  document.querySelectorAll("#soucis .pil").forEach(p => {
    p.style.width = "";
    const cs = getComputedStyle(p);
    const lh = parseFloat(cs.lineHeight) || 16;
    /* Une seule ligne : rien a resserrer. */
    if (p.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) < lh * 1.5) return;
    /* ⚠️ Regroupees par LIGNE ET NON PAR HAUTEUR EXACTE : le point colore et le
       nom en gras ont leur propre rectangle, a un pixel pres du texte, et
       comptes a part ils passaient pour des lignes courtes. */
    const r = document.createRange();
    r.selectNodeContents(p);
    const lignes = [];
    for (const b of r.getClientRects()) {
      if (!b.width) continue;
      const c = (b.top + b.bottom) / 2;
      const l = lignes.find(x => Math.abs(x.c - c) < lh / 2);
      if (l) { l.g = Math.min(l.g, b.left); l.d = Math.max(l.d, b.right); }
      else lignes.push({ c, g: b.left, d: b.right });
    }
    if (lignes.length < 2) return;
    const bord = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
               + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    p.style.width = Math.ceil(Math.max(...lignes.map(l => l.d - l.g)) + bord + 1) + "px";
  });
}
/* EN MODE MENU, ENTRE LES BOUTONS OU DESSOUS (09/10/2026).
   Les pastilles restent entre le menu et « Compact » tant qu elles y tiennent
   sur UNE ligne ; au-dela, elles passent sous les boutons, sur toute la
   largeur de la barre (`.dessous`, voir `fond.css`), au lieu de s empiler dans
   la zone etroite du milieu.
   Elles passent aussi dessous des qu une seule d entre elles doit se
   resserrer pour tenir entre les boutons.
   ⚠️ On essaie TOUJOURS d abord entre les boutons, puis on mesure : une
   pastille qui disparait doit pouvoir les faire remonter. Les deux etats se
   succedent dans la meme tache, sans image intermediaire a l ecran. */
function placeSoucis() {
  const w = document.getElementById("filters"), s = document.getElementById("soucis");
  if (!w || !s) return;
  w.classList.remove("dessous");
  if (getComputedStyle(w).display !== "grid" || w.classList.contains("sans-notifs")) return;
  const p = [...s.querySelectorAll(".pil")];
  if (!p.length) return;
  /* La largeur posee par `serrePastilles()` au tour precedent fausserait la
     mesure : on la retire, elle sera reposee juste apres. */
  p.forEach(x => { x.style.width = ""; });
  const hauts = p.map(x => x.offsetTop);
  /* ⚠️ UNE PASTILLE QUI SE RESSERRE PASSE AUSSI DESSOUS :
     seule sur sa ligne et trop large pour la zone du milieu, elle ne changeait
     pas de ligne mais retrecissait, son nom passant sur deux lignes ou
     debordant. On le voit a sa hauteur (plus d une ligne de texte) ou a son
     contenu plus large qu elle. */
  const serree = (x) => {
    const cs = getComputedStyle(x), lh = parseFloat(cs.lineHeight) || 16;
    return x.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) > lh * 1.5
      || x.scrollWidth > x.clientWidth + 1;
  };
  if (Math.max(...hauts) - Math.min(...hauts) > 4 || p.some(serree)) w.classList.add("dessous");
}
/* Le voile flou sous le trait (voir `fond.css`, paragraphe 29) : seulement quand
   les pastilles sont SOUS les boutons, et cale sur leur zone. */
function voile() {
  const w = document.getElementById("filters"), s = document.getElementById("soucis");
  if (!w || !s) return;
  /* ⚠️ ZONE DEFILANTE SEULEMENT SI LES PASTILLES DEPASSENT L ECRAN (09/10/2026). Toujours defilante, elle retenait la molette et le doigt
     (`overscroll-behavior: contain`) : la page ne defilait plus quand le
     pointeur passait sur les pastilles. `scrollHeight` donne la hauteur
     entiere meme une fois la zone bornee : pas d aller-retour possible. */
  s.classList.toggle("deborde", s.scrollHeight > innerHeight - 90);
  const sous = getComputedStyle(w).display !== "grid" || w.classList.contains("dessous");
  const vu = sous && !!s.offsetParent && s.children.length > 0 && !w.classList.contains("sans-notifs");
  w.classList.toggle("voile", vu);
  if (!vu) return;
  w.style.setProperty("--vy", s.offsetTop + "px");
  w.style.setProperty("--vh", s.offsetHeight + "px");
}
const placeEtSerre = () => { placeSoucis(); serrePastilles(); voile(); };
addEventListener("resize", voile, { passive: true });
/* Le voile suit la zone des pastilles a chaque changement de TAILLE (une ligne
   de plus, la barre construite) ; il ne change lui-meme aucune taille, donc
   aucun risque de boucle. */
new ResizeObserver(() => voile()).observe(document.getElementById("soucis"));

/* Seulement quand la LARGEUR change : resserrer change la hauteur, et
   relancer a chaque hauteur bouclerait. */
{
  let larg = 0;
  new ResizeObserver(([e]) => {
    const l = Math.round(e.contentRect.width);
    if (l !== larg) { larg = l; placeEtSerre(); }
  }).observe(document.getElementById("nav"));
}

/* La cloche de la barre : nombre de pastilles, point d etat de la plus grave,
   et icone barree quand les pastilles sont masquees. */
const CLOCHE = '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>';
const CLOCHE_BARREE = '<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M2 2l20 20"/>';
function majAlertes() {
  const al = document.getElementById("alertes");
  if (!al) return;
  const l = DATA.nas ? etats(DATA) : [];
  const cache = document.getElementById("filters").classList.contains("sans-notifs");
  const niv = l.some(e => e.w === "crit") ? "crit" : l.some(e => e.inc) ? "inc" : "tache";
  al.innerHTML = `<span class="ic">${svg(cache ? CLOCHE_BARREE : CLOCHE, 2)}${
    l.length ? `<i class="pt ${niv}"></i>` : ""}</span>` + (l.length ? `<span class="n">${l.length}</span>` : "");
  al.title = (cache ? "Afficher" : "Masquer") + " les notifications";
  al.setAttribute("aria-label", al.title);
  al.setAttribute("aria-pressed", cache ? "true" : "false");
}


/* ---- La barre du haut : L ETAT D ABORD (08/10/2026) ----
   L heure occupait la place d honneur en 2,6 rem, l etat se lisait en petit a
   l autre bout. La premiere question d un tableau de bord est « est-ce que
   tout va bien » : l etat passe a gauche et en grand, l heure a droite et en
   petit, les mesures restent au milieu. */
/* Majuscule en tete de chaque texte de la barre (09/10/2026) : la date que rend
   `toLocaleDateString` commence par une minuscule (« vendredi 9 octobre »). */
const majuscule = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function bar(d) {
  const now = new Date();
  const ok = d.nas.run === d.nas.all, off = d.nas.all - d.nas.run;
  const soucis = soucisDe(d);
  const grave = soucis.some(e => e.w === "crit");
  /* Donnees figees (voir `figeHtml`) : « Tout va bien » ne peut plus se dire,
     la page ne sait pas. Les arrets et les alertes, eux, restent affiches. */
  const fige = document.body.dataset.fige === "1";
  /* Une mesure : piste, valeur, libelle. Trois jauges seulement (processeur,
     memoire, stockage), chacune dans son degrade : essayees en bleu uni le
     08/10/2026, elles ternissaient la barre, et une jauge sur la temperature
     et les conteneurs n apportait rien.
     ⚠️ TOUTES ONT UNE PISTE, vide pour les trois autres : sans elle, la rangee
     ne s alignait plus.
     La jauge EN HAUT, puis la valeur et son libelle (09/10/2026, choix
     d Alexis apres essai) : les jauges forment une ligne en tete de la rangee,
     valeur et libelle se lisent d un bloc dessous. */
  const mi = (v, u, larg, cl, lib, couleur) => `<div class="mi"><div class="tr${larg == null ? " vide" : ""}">${
      larg == null ? "" : `<i class="${cl}" style="width:${pc(larg).toFixed(1)}%"></i>`}</div><b${
      couleur ? ` style="color:${couleur}"` : ""}>${v}${u ? `<span class="u">${u}</span>` : ""}</b><small>${lib}</small></div>`;

  const dsk = d.nas.disk || 0, dtot = d.nas.disktot || 0, t = tempCpu(d);
  const tt = teinteT(t, SEUILS_T.cpu), maj = (d.updates || {}).total || 0;
  return `<div class="hp"><div class="line"><i class="${!ok || grave ? "crit" : soucis.length ? "attention" : fige ? "inconnu" : ""}"></i><span>${
        /* ⚠️ La classe de la pastille est lue par `sante()` : `crit` (conteneur
           arrete ou incident grave) met le fond au rouge. */
        !ok ? pluriel(off, "service arrêté", "services arrêtés")
        : soucis.length ? pluriel(soucis.length, "incident")
        : fige ? "Données figées" : "Tout va bien"}</span></div>
      <em>${maj ? pluriel(maj, "mise à jour en attente", "mises à jour en attente") : "Aucune mise à jour en attente"}</em></div>
    <div class="met">
      ${mi((d.nas.cpu * (d.nas.cores || 1) / 100).toFixed(1).replace(".", ",") + " / " + (d.nas.cores || 1), "cœurs", d.nas.cpu, "", "Processeur")}
      ${mi(Gk(d.nas.ramu || 0) + " / " + Gk(d.nas.ramt || 1), "Go", d.nas.ram, "w", "Mémoire")}
      ${mi(To(dtot * dsk / 100) + " / " + To(dtot), "To", dsk, "", "Stockage")}
      ${mi(Math.round(t) + " °C", "", null, "", "Température", { cr: "var(--scr)", wn: "var(--swn)", ok: "" }[tt])}
      ${/* Les conteneurs quittent la ligne d etat pour devenir une mesure : la
           valeur passe au rouge des qu un conteneur est arrete. */
        mi(d.nas.run + " / " + d.nas.all, "", null, "", "Conteneurs", ok ? "" : "var(--scr)")}
      ${mi(d.nas.up + " j", "", null, "", "En service")}
    </div>
    <div class="clock"><b>${now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</b>
      <span>${majuscule(now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }))}<span class="an"> ${now.getFullYear()}</span></span></div>`;
}

/* DEF : dans `site.js`, charge avant ce fichier. */
/* ---- Mot de passe des actions (08/10/2026) ----
   Les ecritures (raccourcis, mises a jour, PC) passent par nginx, qui exige un
   appareil du reseau maison ou du VPN ET un mot de passe (authentification
   HTTP « Basic »). Le nom d utilisateur que ce protocole impose est fixe et
   rempli ici : on ne tape que le mot de passe.
   ⚠️ LE CHAMP VIT DANS LA FENETRE QUI FAIT L ACTION (raccourci, PC), pas dans
   une fenetre de plus : une seule validation, et l erreur s affiche la ou on
   vient de taper, fenetre ouverte. Il n apparait que tant que la page ne
   connait pas le mot de passe.
   ⚠️ `credentials: "omit"` EST CE QUI EVITE LA FENETRE DU NAVIGATEUR. Sur un 401,
   un `fetch` ordinaire fait demander nom et mot de passe par le navigateur
   lui-meme ; sans identifiants de navigateur, le 401 revient a la page, et
   l en-tete `Authorization` pose a la main part quand meme (verifie).
   Le mot de passe reste EN MEMOIRE le temps de la page, jamais dans le
   stockage du navigateur. */
const UTILISATEUR_ACTIONS = "homelab";
let MDP = null;
const REFUS = "Action refusée : réservée au réseau maison et au VPN.";
/* 429 : nginx limite les ecritures a 10 par minute et par appareil, pour
   qu on ne puisse pas essayer des mots de passe en rafale. */
const TROP = "Trop d'essais : réessaie dans une minute.";

/* 15 s au plus, comme les lectures : sinon les boutons de la fenetre restaient
   desactives pour toujours, et « Le NAS ne repond pas » ne s affichait jamais. */
const envoie = (url, corps, mdp) => fetch(url, { method: "PUT", credentials: "omit", signal: AbortSignal.timeout(15000),
  headers: Object.assign({ "Content-Type": "application/json" }, mdp == null ? {}
    : { Authorization: "Basic " + btoa(unescape(encodeURIComponent(UTILISATEUR_ACTIONS + ":" + mdp))) }),
  body: JSON.stringify(corps) });

/* Champ du mot de passe a inserer dans une fenetre d action, suivi de la ligne
   d erreur. Le nom d utilisateur cache aide les gestionnaires de mots de passe. */
const CHAMP_MDP = `<input type="text" name="username" autocomplete="username" value="${UTILISATEUR_ACTIONS}" hidden>
  <label for="mdpv">Mot de passe des actions</label>
  <input id="mdpv" type="password" autocomplete="current-password">`;
const champMdp = () => (MDP === null && !DEMO ? CHAMP_MDP : "") + `<div class="err" role="alert"></div>`;

/* Ecrit depuis une fenetre OUVERTE. Rend true si c est ecrit ; sinon la fenetre
   reste ouverte et dit pourquoi. En demonstration, rien ne part : la page n a
   pas de veilleur derriere elle, et le depot local ne doit pas voir ses
   fixtures reecrites. */
async function ecritDepuis(d, url, corps) {
  if (DEMO) return true;
  const err = d.querySelector(".err");
  let champ = d.querySelector("#mdpv");
  const essai = champ ? champ.value : MDP;
  if (champ && !essai) { err.textContent = "Mot de passe requis."; champ.focus(); return false; }
  const boutons = [...d.querySelectorAll("button")];
  boutons.forEach(b => b.disabled = true);
  err.textContent = "";
  let r = null;
  try { r = await envoie(url, corps, essai); } catch { /* panne reseau : dit plus bas */ }
  boutons.forEach(b => b.disabled = false);
  if (r && r.ok) { MDP = essai; return true; }
  if (r && r.status === 401) {
    /* Le mot de passe garde en memoire a pu changer cote NAS : on rend le champ. */
    MDP = null;
    if (!champ) { err.insertAdjacentHTML("beforebegin", CHAMP_MDP); champ = d.querySelector("#mdpv"); }
    err.textContent = essai ? "Mot de passe incorrect." : "Mot de passe requis.";
    champ.value = ""; champ.focus();
    return false;
  }
  err.textContent = !r ? "Le NAS ne répond pas." : r.status === 403 ? REFUS
    : r.status === 429 ? TROP : "Enregistrement impossible (erreur " + r.status + ").";
  return false;
}

/* Pour les actions lancees hors d une fenetre a champ (la fenetre des mises a
   jour) : une petite fenetre ne demande que le mot de passe. */
function demandeMdp(msg) {
  return new Promise((fin) => {
    const d = document.createElement("dialog");
    d.className = "dlg mdp";
    d.innerHTML = `<form method="dialog"><h3>Mot de passe</h3>
      <div class="sub">Cette action modifie le serveur.</div>
      ${CHAMP_MDP}<div class="err" role="alert">${esc(msg || "")}</div>
      <div class="row"><span class="sp"></span><button type="button" id="mdpn">Annuler</button>
        <button value="ok" class="pri">Valider</button></div></form>`;
    document.body.append(d);
    d.querySelector("#mdpn").addEventListener("click", () => d.close("non"));
    d.addEventListener("close", () => {
      const v = d.returnValue === "ok" ? d.querySelector("#mdpv").value : "";
      d.remove();
      fin(v || null);
    });
    d.showModal();
    d.querySelector("#mdpv").focus();
  });
}

/* Ecrit un fichier de `data/` en PUT ; au premier refus faute de mot de passe,
   le demande, puis reessaie. Rend la reponse : 401 si annule, 403 hors du
   reseau maison et du VPN. */
async function ecrire(url, corps) {
  for (;;) {
    const r = await envoie(url, corps, MDP);
    if (r.status !== 401) return r;
    const essai = await demandeMdp(MDP !== null ? "Mot de passe incorrect." : "");
    if (essai === null) { MDP = null; return r; }
    MDP = essai;
  }
}

/* Les raccourcis vivent sur le NAS : identiques depuis tous les navigateurs.
   ⚠️ LA LISTE AFFICHEE NE CHANGE QU APRES L ECRITURE (08/10/2026). Mise a jour
   avant, elle montrait un raccourci « enregistre » alors que l ecriture avait
   ete refusee, jusqu au rechargement. */
let SC = DEF.slice();
const rd = () => SC;
async function load() {
  try {
    const r = await fetch("data/shortcuts.json", { cache: "no-cache" });
    if (r.ok) { const j = await r.json(); if (Array.isArray(j) && j.length) SC = j; }
  } catch (e) { console.warn("raccourcis illisibles, liste par défaut", e); }
  shortcuts();
}
const hst = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
/* ⚠️ SEUL UN LIEN http(s) DEVIENT CLIQUABLE. Le fichier des raccourcis s ecrit
   par une requete PUT : un `javascript:` qui y serait depose s executerait au
   clic. `esc()` protege le HTML, pas le schema du lien. */
const lienSurRacc = (u) => /^https?:\/\//i.test(u || "") ? u : "#";
const dlg = () => document.getElementById("dlg");

/* ⚠️ LES GESTIONNAIRES DE MOTS DE PASSE A L ECART (17/10/2026). La fenetre
   porte le champ du mot de passe des actions : Bitwarden y voyait un
   formulaire de connexion et remplissait le champ texte le plus proche, le
   NOM du raccourci, avec l identifiant. `autocomplete="off"` ne l arrete pas ;
   chaque gestionnaire a son attribut. Le mot de passe, lui, reste rempli. */
const SANS_GESTIONNAIRE = 'autocomplete="off" data-bwignore="true" data-1p-ignore="true" data-lpignore="true"';

function editShortcut(i) {
  const it = i === null ? { url: "", name: "" } : rd()[i];
  const d = dlg();
  d.innerHTML = `<form><h3>${i === null ? "Nouveau raccourci" : "Modifier le raccourci"}</h3>
    <label for="du">Adresse</label><input id="du" value="${esc(it.url)}" placeholder="exemple.fr" required ${SANS_GESTIONNAIRE}>
    <label for="dn">Nom</label><input id="dn" value="${esc(it.name)}" placeholder="Exemple" ${SANS_GESTIONNAIRE}>
    ${champMdp()}
    <div class="row">${i === null ? "" : '<button type="button" id="dsup" class="danger">Supprimer</button>'}
    <span class="sp"></span><button type="button" id="dann">Annuler</button>
    <button type="submit" class="pri">${i === null ? "Ajouter" : "Enregistrer"}</button></div></form>`;
  const enregistre = async (l) => {
    if (!(await ecritDepuis(d, "data/shortcuts.json", l))) return;
    SC = l; shortcuts(); d.close("ok");
    // Le veilleur du NAS récupère l'icône d'un nouveau raccourci dès l'écriture
    // du fichier (inotify sur www/data) : on recharge la table quelques secondes
    // après, pour l'afficher sans avoir à recharger la page.
    setTimeout(() => { ICONES = null; shortcuts(); }, 6000);
  };
  d.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = d.querySelector("#du").value.trim(); if (!raw) return;
    const url = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
    const nv = { url, name: d.querySelector("#dn").value.trim() || hst(url) };
    const l = rd().slice();
    i === null ? l.push(nv) : (l[i] = nv);
    enregistre(l);
  });
  d.querySelector("#dsup")?.addEventListener("click", () => enregistre(rd().filter((_, k) => k !== i)));
  d.querySelector("#dann").addEventListener("click", () => d.close("no"));
  d.showModal(); d.querySelector("#du").focus();
}

let DATA = {};
/* Fermer la fenêtre en cliquant en dehors. On exige que le geste COMMENCE et
   FINISSE sur le fond : `click` seul se déclenche au relâchement et vise
   l'ancêtre commun, si bien qu'un glissé parti de l'intérieur (une sélection de
   texte relâchée hors du cadre) fermait la fenêtre par accident. */
const horsCadre = (e) => {
  const r = dlg().getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
};
let departDehors = false;
dlg().addEventListener("mousedown", (e) => { departDehors = horsCadre(e); });
dlg().addEventListener("mouseup", (e) => {
  if (departDehors && horsCadre(e)) dlg().close("no");
  departDehors = false;
});

/* Les icônes des raccourcis sont servies par le NAS. Chargées depuis les sites
   eux-mêmes, c'étaient des requêtes tierces : le bouclier du navigateur en
   bloquait une partie (ERR_BLOCKED_BY_CLIENT) et certains domaines les
   refusaient (ERR_BLOCKED_BY_RESPONSE.NotSameSite) — d'où des raccourcis sans
   icône alors que l'onglet du site en affichait une. `favicons.py` les rapatrie
   dans www/icons/ et décrit le résultat dans index.json (le nom de fichier
   dépend du format réel : un « .ico » est parfois un PNG). */
let ICONES = null;

/* ---- MODE EDITION DES RACCOURCIS, AU DOIGT (09/10/2026) ----
   Le crayon de chaque raccourci n apparait qu au survol de la souris : sur
   iPhone, impossible de modifier ou supprimer un raccourci. Sur un ecran sans
   survol, la tuile « Ajouter » laisse la place a « Modifier », qui passe en
   mode edition comme l ecran d accueil : crayon sur chaque icone, un toucher
   sur une icone l ouvre en modification au lieu de suivre le lien, et
   « Ajouter » revient a cote de « Terminé ».
   ⚠️ « Modifier » REMPLACE « Ajouter » hors edition : meme nombre de tuiles,
   donc meme disposition en lignes (voir `rangeeRacc`). Ordinateur inchange. */
let EDITION = false;
const TACTILE = () => matchMedia("(hover: none)").matches;
const ICO_PLUS = '<path d="M12 6v12M6 12h12"/>';
const ICO_CRAYON = '<path d="M4 20h4L20 8l-4-4L4 16z"/>';
const ICO_FINI = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';

function shortcuts() {
  const w = document.getElementById("shortcuts");
  const tactile = TACTILE();
  if (!tactile) EDITION = false;
  const tuile = (cl, ico, txt) => `<button class="t ${cl}" type="button"><span class="i">${svg(ico, 1.8)}</span><span class="l">${txt}</span></button>`;
  w.innerHTML = rd().map((it, i) => `<a class="t" rel="noreferrer" href="${esc(lienSurRacc(it.url))}" title="${esc(it.url)}" data-n="${i}">
      <span class="i" data-h="${esc(hst(it.url))}">${esc((it.name || hst(it.url)).slice(0, 2).toUpperCase())}</span>
      <span class="l">${esc(it.name || hst(it.url))}</span>
      <button class="e" type="button" data-i="${i}">${svg('<path d="M4 20h4L20 8l-4-4L4 16z"/>', 2.4)}</button></a>`).join("")
    + (!tactile || EDITION ? tuile("add", ICO_PLUS, "Ajouter") : "")
    + (tactile ? tuile("mod", EDITION ? ICO_FINI : ICO_CRAYON, EDITION ? "Terminé" : "Modifier") : "");
  w.parentElement.classList.toggle("edition", EDITION);
  // Premier passage : on va chercher la table des icônes locales, puis on
  // redessine. `{}` en attendant, pour ne pas empiler les requêtes.
  if (ICONES === null) {
    ICONES = {};
    lireOu("icons/sites/index.json", null).then(m => { if (m) { ICONES = m; shortcuts(); } });
  }
  w.querySelectorAll(".i[data-h]").forEach(s => {
    const f = ICONES[s.dataset.h];
    if (!f) return;                  // pas d'icône rapatriée : les initiales restent
    const im = new Image();
    im.onload = () => { s.textContent = ""; s.appendChild(im); };
    im.src = "icons/sites/" + f;
  });
  w.querySelectorAll(".e").forEach(b => b.onclick = ev => { ev.preventDefault(); editShortcut(+b.dataset.i); });
  /* En edition, toucher l icone l ouvre en modification au lieu du lien.
     Le rang est lu au clic (`data-n`) : un raccourci deplace en change. */
  w.querySelectorAll("a.t").forEach((t) => t.onclick = ev => {
    if (!EDITION) return;
    ev.preventDefault(); editShortcut(+t.dataset.n);
  });
  const add = w.querySelector(".add");
  if (add) add.onclick = () => editShortcut(null);
  const mod = w.querySelector(".mod");
  if (mod) mod.onclick = () => { EDITION = !EDITION; shortcuts(); };
  rangeeRacc();
}

/* ---- Raccourcis : TROIS LIGNES AU PLUS, PUIS DEFILEMENT (09/10/2026) ----
   Telephone ET ordinateur. Autant de lignes qu il en faut,
   equilibrees (six et six pour douze, et non huit et quatre), mais jamais plus
   de trois : au-dela, la grille garde ses trois lignes, deborde a droite et
   defile. Les fleches ‹ › disent
   qu il y a la suite et la font venir ; elles n apparaissent que d un cote ou
   il reste quelque chose a voir.
   ⚠️ L ORDRE RESTE CELUI DE LA LECTURE, ligne par ligne : la grille recoit
   son nombre de colonnes (`--k`) au lieu de couler en colonnes, ce qui aurait
   range le deuxieme raccourci SOUS le premier.
   ⚠️ La largeur d une colonne et l ecart viennent du CSS (`--l`, `--g`), qui
   les change sur telephone : le calcul ne peut pas les supposer. */
function rangeeRacc() {
  const w = document.getElementById("shortcuts"), r = w.parentElement;
  const st = getComputedStyle(w);
  const l = parseFloat(st.getPropertyValue("--l")) || 76, g = parseFloat(st.getPropertyValue("--g")) || 14;
  /* Largeur UTILE, sans le rembourrage pose quand la rangee va jusqu aux bords. */
  const utile = w.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
  const n = w.children.length, cap = Math.max(1, Math.floor((utile + g) / (l + g)));
  const lignes = Math.min(3, Math.ceil(n / cap));
  const k = Math.ceil(n / lignes);
  w.style.setProperty("--k", k);
  w.style.setProperty("--k2", 2 * k);
  r.classList.toggle("defile", k > cap);
  /* La derniere ligne, incomplete, se centre (voir fond.css) ; pas quand la
     rangee defile : elle part du bord gauche. Repose a chaque appel selon le
     RANG : un raccourci deplace (`glisseRacc`) emporterait sinon son decalage
     avec lui. */
  const debut = (lignes - 1) * k, manque = k * lignes - n;
  [...w.children].forEach((t, j) => {
    t.style.gridColumnStart = j === debut && manque > 0 && k <= cap ? String(manque + 1) : "";
  });
  fleches();
}
function fleches() {
  const w = document.getElementById("shortcuts"), r = w.parentElement;
  const plus = r.classList.contains("defile");
  r.dataset.g = plus && w.scrollLeft > 2 ? "1" : "";
  r.dataset.d = plus && w.scrollLeft + w.clientWidth < w.scrollWidth - 2 ? "1" : "";
}
{
  const w = document.getElementById("shortcuts"), r = w.parentElement;
  w.addEventListener("scroll", fleches, { passive: true });
  new ResizeObserver(rangeeRacc).observe(r);
  r.querySelectorAll(".fl").forEach(b => b.addEventListener("click", () =>
    w.scrollBy({ left: (b.classList.contains("g") ? -1 : 1) * w.clientWidth * .8, behavior: defilementDoux() })));
  molette(w);
  glisseRacc(w);
}

/* ---- DEPLACER UN RACCOURCI (17/10/2026) ----
   On l attrape et on le pose ailleurs : les autres s ecartent pour lui faire
   place pendant le geste, et le nouvel ordre s enregistre sur le NAS au
   relachement (le mot de passe des actions est demande s il le faut).
   - A la souris : le geste commence apres 5 px ; en deca, c est un clic et le
     lien s ouvre.
   - Au doigt : en mode edition seulement (« Modifier »), apres un appui de
     250 ms sans bouger ; hors edition, glisser fait defiler la rangee.
   ⚠️ UNE COPIE SUIT LE POINTEUR, dans `body` : la rangee defile
   (`overflow-x: auto`) et rognerait une tuile sortie de son cadre. La tuile
   elle-meme reste dans la grille, estompee (`.vide`) : c est elle qui change
   de place, et elle montre ou la copie tombera.
   ⚠️ LES PLACES SONT RELEVEES UNE FOIS, au debut du geste : la grille garde sa
   forme, seul l ordre change. Relues a chaque mouvement, elles suivraient les
   tuiles en train de glisser et la cible oscillerait.
   ⚠️ L ORDRE N EST ADOPTE (`SC`) QU UNE FOIS ECRIT, comme dans la fenetre : un
   refus remet la rangee comme avant et dit pourquoi. Echap annule le geste. */
function glisseRacc(w) {
  const SEUIL = 5, BOUGE = 8, APPUI = 250, BORD = 48;
  let g = null;
  const tuiles = () => [...w.querySelectorAll("a.t")];
  // le glisser natif d un lien (ou de son image) ferait concurrence
  w.addEventListener("dragstart", (e) => e.preventDefault());

  w.addEventListener("pointerdown", (e) => {
    const t = e.target.closest("a.t");
    if (g || !t || !e.isPrimary || e.button !== 0 || e.target.closest(".e")) return;
    const souris = e.pointerType === "mouse";
    if (!souris && !EDITION) return;
    g = { t, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, souris, actif: false };
    if (!souris) g.appui = setTimeout(prend, APPUI);
  });
  addEventListener("pointermove", (e) => {
    if (!g || e.pointerId !== g.id) return;
    g.x = e.clientX; g.y = e.clientY;
    if (g.actif) return suit();
    const loin = Math.hypot(g.x - g.x0, g.y - g.y0);
    if (!g.souris) { if (loin > BOUGE) lache(); }   // le doigt fait defiler
    else if (loin >= SEUIL) prend();
  });
  addEventListener("pointerup", (e) => { if (g && e.pointerId === g.id) pose(); });
  addEventListener("pointercancel", (e) => { if (g && e.pointerId === g.id) pose(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && g && g.actif) pose(true); });
  // le geste engage, le doigt ne fait plus defiler la page
  w.addEventListener("touchmove", (e) => { if (g && g.actif) e.preventDefault(); }, { passive: false });

  const lache = () => { if (g) clearTimeout(g.appui); g = null; };

  function prend() {
    if (!g || g.actif || !g.t.isConnected) return lache();
    g.actif = true;
    const wr = w.getBoundingClientRect();
    // les places, en coordonnees du CONTENU de la rangee : elle peut defiler
    g.places = tuiles().map((t) => {
      const r = t.getBoundingClientRect();
      return { x: r.left - wr.left + w.scrollLeft + r.width / 2, y: r.top - wr.top + r.height / 2 };
    });
    const r = g.t.getBoundingClientRect();
    g.dx = g.x0 - r.left; g.dy = g.y0 - r.top;
    const c = g.t.cloneNode(true);
    c.removeAttribute("href"); c.removeAttribute("title"); c.setAttribute("aria-hidden", "true");
    c.style.cssText = `position:fixed;left:0;top:0;margin:0;z-index:95;pointer-events:none;width:${r.width}px`;
    document.body.append(c);
    requestAnimationFrame(() => c.classList.add("prise"));   // se souleve (transition de `.t .i`)
    g.copie = c;
    g.t.classList.add("vide");
    document.documentElement.classList.add("glisse");
    if (!g.souris && navigator.vibrate) navigator.vibrate(8);
    suit();
  }

  // la copie sous le pointeur ; la tuile a la place la plus proche
  function suit() {
    g.copie.style.transform = `translate(${g.x - g.dx}px,${g.y - g.dy}px)`;
    const wr = w.getBoundingClientRect();
    const px = g.x - wr.left + w.scrollLeft, py = g.y - wr.top;
    let cible = 0, d = Infinity;
    g.places.forEach((p, j) => { const e = Math.hypot(p.x - px, p.y - py); if (e < d) { d = e; cible = j; } });
    const ts = tuiles(), ici = ts.indexOf(g.t);
    if (cible !== ici) deplace(ts, ici, cible);
    // pres d un bord d une rangee qui defile, elle defile
    g.bord = !w.parentElement.classList.contains("defile") ? 0
      : g.x < wr.left + BORD ? -1 : g.x > wr.right - BORD ? 1 : 0;
    if (g.bord && !g.boucle) { g.boucle = true; requestAnimationFrame(defile); }
  }
  function defile() {
    if (!g || !g.actif || !g.bord) { if (g) g.boucle = false; return; }
    const avant = w.scrollLeft;
    w.scrollLeft += g.bord * 8;
    if (w.scrollLeft !== avant) suit();
    requestAnimationFrame(defile);
  }

  // la tuile change de place ; les autres glissent vers la leur (FLIP)
  function deplace(ts, ici, cible) {
    const avant = new Map(ts.map((t) => [t, t.getBoundingClientRect()]));
    ts.forEach((t) => t.getAnimations().forEach((a) => a.cancel()));
    w.insertBefore(g.t, cible > ici ? ts[cible].nextSibling : ts[cible]);
    rangeeRacc();
    if (doux()) return;
    for (const t of ts) {
      if (t === g.t) continue;
      const a = avant.get(t), b = t.getBoundingClientRect();
      if (Math.abs(a.left - b.left) + Math.abs(a.top - b.top) < 1) continue;
      t.animate([{ transform: `translate(${a.left - b.left}px,${a.top - b.top}px)` }, { transform: "none" }],
        { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
  }

  // l ordre d avant le geste (rang d origine : `data-n`)
  function remet() {
    const bout = w.querySelector("button.t");
    tuiles().sort((a, b) => a.dataset.n - b.dataset.n).forEach((t) => w.insertBefore(t, bout));
    rangeeRacc();
  }

  function pose(annule = false) {
    const f = g; lache();
    if (!f || !f.actif) return;
    document.documentElement.classList.remove("glisse");
    // le clic qui suit le relachement n ouvre ni le lien ni la fenetre
    const bloque = (e) => { e.preventDefault(); e.stopPropagation(); };
    addEventListener("click", bloque, true);
    setTimeout(() => removeEventListener("click", bloque, true), 0);
    if (annule) remet();
    // la copie rejoint la place de la tuile, puis s efface devant elle
    const fin = () => { f.copie.remove(); f.t.classList.remove("vide"); };
    const r = f.t.getBoundingClientRect();
    f.copie.classList.remove("prise");
    if (doux()) fin();
    else f.copie.animate([{ transform: f.copie.style.transform }, { transform: `translate(${r.left}px,${r.top}px)` }],
      { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" }).finished.then(fin, fin);
    const ordre = tuiles().map((t) => +t.dataset.n);
    if (!annule && ordre.some((k, j) => k !== j)) enregistre(ordre);
  }

  async function enregistre(ordre) {
    const l = ordre.map((k) => rd()[k]);
    let r = null;
    // en demonstration, rien ne part (voir `ecritDepuis`)
    if (!DEMO) try { r = await ecrire("data/shortcuts.json", l); } catch { /* le NAS ne repond pas : dit plus bas */ }
    if (DEMO || (r && r.ok)) {
      SC = l;
      tuiles().forEach((t, j) => { t.dataset.n = j; const e = t.querySelector(".e"); if (e) e.dataset.i = j; });
      return;
    }
    remet();
    if (r && r.status === 401) return;   // mot de passe non donne : rien de plus a dire
    const d = dlg();
    d.classList.remove("large");
    d.innerHTML = `<form method="dialog"><h3>Ordre non enregistré</h3>
      <div class="sub">${esc(!r ? "Le NAS ne répond pas." : r.status === 403 ? REFUS : r.status === 429 ? TROP
        : "Enregistrement impossible (erreur " + r.status + ").")}</div>
      <div class="row"><span class="sp"></span><button class="pri" value="ok">OK</button></div></form>`;
    d.showModal();
  }
}

/* A la souris, la molette verticale fait defiler une rangee horizontale tant
   qu elle a de quoi defiler dans ce sens ; arrivee au bout, elle rend la main a
   la page. Sans ca, une souris sans molette horizontale ne voyait jamais la fin
   d une rangee qui deborde (raccourcis, pastilles). */
function molette(el) {
  el.addEventListener("wheel", (e) => {
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 1 || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    const avant = el.scrollLeft;
    if ((e.deltaY < 0 && avant <= 0) || (e.deltaY > 0 && avant >= max - 1)) return;
    e.preventDefault();
    el.scrollLeft = Math.max(0, Math.min(max, avant + e.deltaY));
  }, { passive: false });
}

let majTimer = null;

/* ⚠️ DEPUIS LE 25/09/2026, LA SOURCE EST `maj.json`, écrit par compose-auto-update
   à chaque passe et après chaque action demandée depuis cette page. Il remplace
   `updates.json` (check-updates.sh) et `maj-history.json` (maj-nas.sh), tous deux
   arrêtés. Pour chaque conteneur suivi : son mode, la version disponible, et
   s'il est bloqué, pourquoi, avec la marche à suivre.

   Le fichier peut manquer (installation neuve) : on renvoie un état vide plutôt
   que de laisser l'absence casser l'ouverture de la fenêtre. */
async function getMaj() {
  return majDemo(await lireOu("maj.json", { conteneurs: {} }));
}

/* ⚠️ INVENTAIRE DE TOUS LES CONTENEURS, ecrit par `versions.sh`, trie du plus
   recemment mis a jour au plus ancien.

   Ce n est PAS un journal d evenements. `maj-history.json` dit « le 14/09,
   sonarr est passe de ls322 a ls324 » ; celui-ci dit « sonarr est en ls324,
   recree le 14/09 ». Trie par date decroissante il repond aux deux questions a
   la fois, ce qui evite d avoir deux listes a lire dans la meme fenetre.

   Le fichier peut ne pas exister — installation neuve, collecteur pas encore
   passe — et c est un cas NORMAL : on renvoie une liste vide plutot que de
   laisser l absence casser l ouverture de la fenetre. */
async function getVersions() {
  return versionsDemo(await lireOu("versions.json", { items: [] }));
}
async function majState() {
  return lireOu("data/maj-status.json", "", true);
}

/* ⚠️ UNE SEULE LISTE, FUSION DE DEUX SOURCES : l'inventaire (`versions.json`,
   ce qui TOURNE, avec les liens de notes de version) et l'état de
   compose-auto-update (`maj.json` : mode, version disponible, blocage). En cas
   de désaccord sur la version en service, l'inventaire gagne.

   Chaque ligne porte en plus :
   - un bouton de MODE, « auto » ou « manuel », qui bascule le conteneur sans
     toucher à la configuration ; le choix fait ici prime sur elle ;
   - si le conteneur est BLOQUÉ (manuel temporaire), la raison, la marche à
     suivre et l'erreur exacte : de quoi savoir quoi faire sans ouvrir un terminal.

   ⚠️ Le bouton de mode et le cadre de raison passent AU-DESSUS de la surcouche
   cliquable du label (`z-index` dans `fond.css`) : sans cela, un clic sur
   « auto » cochait la case de la ligne au lieu de basculer le mode.

   Les cases à cocher restent réservées aux conteneurs qui ont quelque chose à
   appliquer : une nouvelle version, ou un blocage à lever. */
function paintUpd(maj, note, vers) {
  const suivis = (maj && maj.conteneurs) || {};
  // Laissés de côté volontairement (image construite sur place, exclusion) :
  // on l'affiche, sinon une ligne sans bouton de mode ressemble à un oubli.
  const ignores = (maj && maj.ignores) || {};
  const vit = (vers && vers.items) || [];
  const risque = (n) => /postgres|db$|broker/.test(n);
  /* ⚠️ LE LIEN EST FILTRE. Son origine est l etiquette OCI de l image, donc une
     donnee declarative que l on ne controle pas — celle de gluetun pointe vers
     un fork alors que l image est officielle. Une image malveillante pourrait y
     placer un `javascript:`. Seul un https absolu est rendu cliquable. */
  const lienSur = (s) => typeof s === "string" && /^https:\/\/[\w.-]+\//.test(s);
  const RAISON = { telechargement: "téléchargement impossible",
                   installation: "mise à jour annulée, ancienne version remise",
                   majeure: "version majeure à valider",
                   retour_arriere: "retour arrière ÉCHOUÉ" };
  const quand = (s) => s ? `${s.slice(8, 10)}/${s.slice(5, 7)} à ${s.slice(11, 16)}` : "?";

  const rangee = (n, v, s) => {
    s = s || {};
    const dispo = s.disponible || null;
    // Une empreinte (h) ne dit rien : la version connue de l'outil passe devant,
    // par exemple « nginx 1.30.5 » pour une image construite sur place.
    const brut = !!(v && v.h) && !s.version;
    const vu = (v && v.h && s.version) || (v && v.v) || s.version || "";
    /* ⚠️ MEME VERSION, IMAGE RECONSTRUITE (23/10/2026, demande) : `postgres:17`
       republiee en 17.11 avec une nouvelle empreinte (correctifs du systeme
       qu elle contient) s affichait « 17.11 → 17.11 », qu on prenait pour un
       bogue. `meme` la nomme pour ce qu elle est. */
    const meme = !!(dispo && dispo.version && dispo.version === vu);
    return { n, d: (v && v.d) || "", ts: v ? v.ts || 0 : -1,
             v: vu, h: brut, url: (v && v.u) || "",
             upd: !!(dispo || s.blocage), nv: (dispo && dispo.version) || "", meme,
             mode: s.mode || "", bloc: s.blocage || null, neuf: !!s.decouvert,
             hors: ignores[n] || null,
             avert: (s.avertissements || []).map(a => a.message) };
  };
  const vus = new Set();
  const fusion = vit.map(v => { vus.add(v.n); return rangee(v.n, v, suivis[v.n]); });
  // ⚠️ UN CONTENEUR ARRÊTÉ est suivi mais absent de l'inventaire (`docker ps`) :
  // sans ce rattrapage il disparaîtrait au moment où l'on en a le plus besoin.
  for (const [n, s] of Object.entries(suivis)) if (!vus.has(n)) fusion.push(rangee(n, null, s));

  // Les bloqués d'abord, puis les autres actionnables, puis l'inventaire.
  fusion.sort((a, b) => (!!b.bloc - !!a.bloc) || (b.upd - a.upd) || (b.ts - a.ts));
  const nAtt = fusion.filter(x => x.upd).length;
  const nBloc = fusion.filter(x => x.bloc).length;
  const nAuto = fusion.filter(x => x.mode === "auto").length;

  const motif = (x) => {
    if (!x.bloc && !x.avert.length) return "";
    const b = x.bloc;
    return `<div class="motif${b && b.raison === "retour_arriere" ? " urgent" : ""}">${b
      ? `<b>Manuel temporaire : ${esc(RAISON[b.raison] || b.raison)}</b>${esc(b.message)}. ${esc(b.conseil)}${
          b.erreur ? `<details><summary>Erreur exacte</summary><code>${esc(b.erreur)}</code></details>` : ""}`
      : ""}${x.avert.map(a => `<div>⚠️ ${esc(a)}</div>`).join("")}</div>`;
  };

  const ligne = (x, k) => `<li class="${x.upd ? "att" : ""}">
      ${x.upd ? `<input type="checkbox" id="c${k}" value="${esc(x.n)}">`
              : `<span class="pastille"></span>`}
      <span class="hd">${esc(x.d)}</span>
      <label class="hn" ${x.upd ? `for="c${k}"` : ""}>${esc(x.n)}${
        x.upd && risque(x.n) ? '<span class="rq">base de données</span>' : ""}${
        x.upd && x.meme ? '<span class="rq ri" title="Même version de l’application, nouvelle image : en général des correctifs du système qu’elle contient.">image reconstruite</span>' : ""}${
        x.neuf ? '<span class="rq">nouveau</span>' : ""}</label>
      <span class="hv${x.h && !x.upd ? " brut" : ""}"${
        x.h && !x.upd ? ' title="Aucune étiquette de version sur cette image : empreinte affichée à la place."' : ""}>${
        x.upd && x.nv && !x.meme ? `<s>${esc(x.v)}</s><i>→</i><b>${esc(x.nv)}</b>` : `<b>${esc(x.v)}</b>`}</span>
      ${lienSur(x.url)
        ? `<a class="hl" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">notes</a>`
        : `<span class="hl vide">—</span>`}
      ${x.mode
        ? `<button type="button" class="mode ${x.mode === "auto" ? "auto" : "manuel"}" data-n="${esc(x.n)}"
             data-m="${x.mode === "auto" ? "manuel" : "auto"}" title="${x.mode === "auto"
               ? "Mis à jour la nuit. Cliquer pour passer en manuel."
               : "Jamais mis à jour seul. Cliquer pour passer en automatique."}">${x.mode === "auto" ? "auto" : "manuel"}</button>`
        : x.hors
          ? `<span class="mode hors" title="${esc(x.hors.raison)}">${esc(x.hors.etiquette)}</span>`
          : `<span class="mode vide"></span>`}
      ${motif(x)}</li>`;

  dlg().innerHTML = `<form method="dialog"><h3>Conteneurs et mises à jour</h3>
    <p class="sub">${fusion.length} conteneurs · ${nAuto} en automatique · ${nAtt
      ? `${nAtt} à faire à la main${nBloc ? `, dont ${nBloc} bloqué${nBloc > 1 ? "s" : ""}` : ""}`
      : "rien à faire à la main"}</p>
    <p class="sub2">Les actions en tête, puis du plus récemment mis à jour au plus ancien${
      maj && maj.derniere_passe ? ` · dernière passe le ${esc(quand(maj.derniere_passe.fin))}` : ""}</p>
    <div class="scroll">
      ${fusion.length
        ? `<ul class="hist">${fusion.map(ligne).join("")}</ul>`
        : `<div class="majv">Aucun conteneur relevé</div>`}
    </div>
    <p class="etat" id="mst">${esc(note || "")}</p>
    <div class="row centre">${nAtt ? '<button type="button" id="mgo" class="go" disabled>Aucune mise à jour sélectionnée</button>' : ""}</div></form>`;

  const d = dlg(), st = d.querySelector("#mst"), go = d.querySelector("#mgo");
  const boxes = [...d.querySelectorAll('input[type="checkbox"]')];
  const modes = [...d.querySelectorAll("button.mode")];
  const sync = () => { const n = boxes.filter(b => b.checked).length;
    if (go) { go.disabled = !n; go.textContent = n ? `Mettre à jour (${n})` : "Aucune mise à jour sélectionnée"; } };
  boxes.forEach(b => b.onchange = sync); sync();
  const figer = (oui) => { boxes.forEach(b => b.disabled = oui); modes.forEach(b => b.disabled = oui); };

  /* Une demande = un fichier déposé en PUT, puis on suit `maj-status.json`
     jusqu'à « done ». Commun aux deux actions : mettre à jour, changer de mode.
     On mémorise l'état AVANT : on n'accepte un « done » que s'il a changé. */
  const demander = async (charge) => {
    const avant = await majState();
    figer(true); if (go) go.disabled = true;
    st.textContent = "Demande envoyée…";
    try {
      const r = await ecrire("data/trigger.json", charge);
      /* ⚠️ `fetch` ne leve pas sur un code d erreur : sans ce test, un refus
         laissait « en attente du demarrage » a l ecran pour toujours. */
      if (!r.ok) {
        st.textContent = r.status === 401 ? "Action annulée : mot de passe requis."
          : r.status === 403 ? REFUS : r.status === 429 ? TROP
          : "Déclenchement impossible (" + r.status + ").";
        figer(false); sync(); return false;
      }
    } catch {
      st.textContent = "Déclenchement impossible."; figer(false); sync(); return false;
    }
    clearInterval(majTimer);
    majTimer = setInterval(async () => {
      if (!st.isConnected) return clearInterval(majTimer);
      const txt = await majState();
      if (!txt || txt === avant) { st.textContent = "⏳ en attente du démarrage…"; return; }
      let s; try { s = JSON.parse(txt); } catch { return; }
      if (s.state === "running") { st.textContent = "⏳ " + s.msg; return; }
      if (s.state === "done") {
        clearInterval(majTimer);
        const fin = (s.ok === false ? "⚠️ " : "✅ ") + s.msg;
        st.textContent = fin;
        setTimeout(async () => { paintUpd(await getMaj(), fin, await getVersions()); refresh(); }, 1500);
      }
    }, 2000);
    return true;
  };

  modes.forEach(b => b.addEventListener("click", () =>
    demander({ action: "mode", nom: b.dataset.n, mode: b.dataset.m })));

  if (!go) return;
  go.addEventListener("click", async () => {
    const items = boxes.filter(b => b.checked).map(b => b.value);
    if (!items.length) return;
    go.className = "go busy"; go.textContent = "Mise à jour en cours";
    if (!await demander({ action: "appliquer", items })) {
      go.className = "go"; go.textContent = "Réessayer"; go.disabled = false;
    }
  });
}

async function popUpdates() { paintUpd(await getMaj(), "", await getVersions()); dlg().showModal(); }

/* Liste complete des conteneurs, triee par memoire decroissante. */
/* Les piles se deduisent du prefixe du nom : aucune liste a maintenir,
   un service ajoute se range tout seul. */
/* PILES et AUTRES : dans `site.js`, charge avant ce fichier. */
const pileDe = (n) => PILES.find(p => n.startsWith(p.k)) || AUTRES;

async function popConteneurs() {
  /* ⚠️ PLUS DE DERIVE NI DE MOYENNE 24 H (retirees sur demande le
     05/10/2026) : la fenetre ne charge donc plus `containers-hist.json`. */
  const d = document.getElementById("dlg");
  const rt = DATA.nas.ramt || 0;
  const m = DATA.mem || null;
  const MEM = typeof MEMOIRE !== "undefined" ? MEMOIRE : {};
  const cat = k => MEM[k] || [k, "", "#8a94a6"];
  const c = ((DATA.cont && DATA.cont.c) || []).slice();

  /* LA FENETRE DE TOUTE LA MEMOIRE (05/10/2026), et plus seulement des
     conteneurs : meme categories que la carte, chacune depliable jusqu au
     processus, puis ce qui n appartient a personne — noyau, cache, swap.
     ⚠️ « MEMOIRE » = CE QUE LE PROCESSUS OCCUPE VRAIMENT, sans le cache
     (`anon` du cgroup), et « swap » ce qui en a ete evacue. C est la mesure de
     la carte : les lignes d un groupe additionnees retombent sur son titre, et
     les titres sur la carte. Tant que le collecteur ne fournit pas `anon`, les
     conteneurs retombent sur le pourcentage de `docker stats`. */
  const memC = (x) => x.anon != null ? x.anon : moC(x.mem, rt);
  const totC = (x) => memC(x) + (x.swap || 0);

  /* Groupes ouverts, retenus PAR NAVIGATEUR : un confort de lecture, pas une
     donnee a partager. Tous replies a la premiere ouverture. */
  let ouverts = [];
  try { ouverts = JSON.parse(localStorage.getItem("hl-pop-ouverts") || "[]"); } catch (e) { /* navigation privee */ }
  /* ⚠️ UNE SEULE ECHELLE POUR TOUTE LA FENETRE, titres comme lignes : `E`, le
     plus gros bloc affiche. Avec une echelle par groupe, un service pouvait
     montrer une barre plus longue que celle de son propre groupe. Les petits
     processus deviennent de minces traits : c est leur vraie part.
     `E` est fixe plus bas, une fois tous les blocs connus, avant le premier
     dessin. */
  let E = 1;
  /* Rien n est dessine pour une valeur nulle : la largeur minimale qui garde
     visibles les petits processus aurait fait d un zero un point. */
  const barre2 = (mem, sw, coul, cl) => `<span class="${cl}">`
    + (mem > 0 ? `<i style="width:${(mem / E * 100).toFixed(2)}%;background:${coul}"></i>` : "")
    + (sw > 0 ? `<u style="width:${(sw / E * 100).toFixed(2)}%;background:${coul}"></u>` : "") + `</span>`;
  /* TITRE DE GROUPE = UNE LIGNE COMME LES AUTRES (05/10/2026, sur demande) :
     ses totaux dans les memes colonnes — memoire, swap, processeur — au lieu
     d une phrase « 9 services · 586 Mo · dont 235 Mo en swap » a dechiffrer. Le
     nombre de membres, qui n a pas de colonne, suit le nom en petit. La barre
     dessous, sur l echelle commune : repliee, la fenetre se lit comme un
     histogramme. `v` : [memoire, swap, processeur ou null]. */
  const groupe = (id, coul, nom, n, v, lignes, cl) =>
    `<details class="grp${cl ? " " + cl : ""}" data-g="${esc(id)}"${ouverts.includes(id) ? " open" : ""}>`
    + `<summary class="grp-h ln"><span class="nm"><span class="chev" aria-hidden="true"></span>`
    + `<i style="background:${coul}"></i><b>${esc(nom)}</b>${n ? `<small>${n}</small>` : ""}</span>`
    + `<span class="mm">${moGo(v[0])}</span><span class="sw">${v[1] ? moGo(v[1]) : "—"}</span>`
    + `<span class="cp">${v[2] != null ? vg((+v[2]).toFixed(1)) + " %" : "—"}</span>`
    + barre2(v[0], v[1], coul, "gb") + `</summary><div class="grp-l">${lignes}</div></details>`;
  /* Processeur d un groupe : la somme de ses membres, ou rien si aucun n est mesure. */
  const somCpu = (l) => { const v = l.filter(y => y.cpu != null);
    return v.length ? v.reduce((a, y) => a + (+y.cpu || 0), 0) : null; };

  /* Une ligne de processus : nom, memoire, swap, processeur, puis la barre a deux
     tons — plein en memoire, voile en swap — a l echelle de la fenetre. */
  const ligne = (nom, mem, sw, cpu, coul) =>
    `<div class="ln"><span class="nm">${nom}</span>`
    + `<span class="mm">${mem != null ? moGo(mem) : "—"}</span>`
    + `<span class="sw">${sw ? moGo(sw) : "—"}</span>`
    + `<span class="cp">${cpu != null ? vg((+cpu).toFixed(1)) + " %" : "—"}</span>`
    + barre2(mem || 0, sw, coul, "tr") + `</div>`;
  /* Precision en petit apres un nom, la ou aucune colonne ne la porte. */
  const precis = (t) => t ? `<small>${esc(t)}</small>` : "";
  const section = (t) => `<div class="psec">${esc(t)}</div>`;

  /* ---- Les programmes : UNE LISTE, DANS L ORDRE DE LA LEGENDE ----
     Refonte demandee le 05/10/2026 : trois parties et douze titres
     replies se lisaient mal. Chaque CATEGORIE de la carte devient une ligne, du
     plus gros au plus petit, « Autres » en dernier ; ses SOUS-PARTIES (les piles
     de conteneurs, les processus d un service) prennent des NUANCES de sa
     couleur. La barre du haut est decoupee pareil : on lit la categorie, puis ce
     qui la compose, sans legende supplementaire. */
  const g = new Map();
  c.forEach(x => { const p = pileDe(x.n);
    if (!g.has(p.n)) g.set(p.n, { n: p.n, l: [], t: 0, mem: 0, sw: 0 });
    const e = g.get(p.n); e.l.push(x); e.t += totC(x); e.mem += memC(x); e.sw += x.swap || 0; });
  /* ⚠️ TOUT EST TRIE PAR MEMOIRE, la valeur de la premiere colonne et de la
     legende. Trie par memoire + swap, l ordre semblait faux des qu on lisait les
     chiffres : Photos et IA (40 Mo) passait devant Cameras (110 Mo). */
  const piles = [...g.values()].sort((a, b) => b.mem - a.mem);
  piles.forEach(p => p.l.sort((a, b) => memC(b) - memC(a)));

  /* Copie : on ne touche pas aux donnees partagees avec la carte. Le total des
     conteneurs est RECALCULE depuis leurs piles, pour que le titre retombe
     exactement sur la somme de ses lignes et la legende sur le titre. */
  const catsM = ((m && m.g) || []).map(x => Object.assign({}, x));
  const cc = catsM.find(x => x.k === "conteneurs");
  const pm = piles.reduce((a, p) => a + p.mem, 0), psw = piles.reduce((a, p) => a + p.sw, 0);
  if (cc && piles.length) { cc.mo = pm; cc.t = psw; }
  else if (!cc && c.length) catsM.push({ k: "conteneurs", mo: pm, t: psw });
  const cats = catsM.sort((a, b) => (a.k === "autres") - (b.k === "autres") || b.mo - a.mo);

  /* Sous-parties de chaque categorie, avec leur nuance : nom, memoire, swap, et
     ce qu il faut pour dessiner leurs lignes. */
  const parts = cats.map(x => {
    const base = cat(x.k)[2];
    if (x.k === "conteneurs") {
      const nu = nuances(base, piles.length);
      return piles.map((p, i) => ({ n: p.n, v: p.t, mem: p.mem, sw: p.sw, c: nu[i], pile: p }));
    }
    const l = (x.l || []).slice().sort((a, b) => b.mo - a.mo);
    const nu = nuances(base, l.length);
    return l.map((y, i) => ({ n: y.n, v: y.mo + (y.t || 0), mem: y.mo, sw: y.t || 0, cpu: y.cpu, c: nu[i] }));
  });

  const det0 = (m && m.det) || {};
  E = Math.max(1, ...cats.map(x => x.mo + (x.t || 0)),
    (det0.zram || []).reduce((a, x) => a + x.used + x.orig, 0) + (det0.swaps || []).reduce((a, x) => a + x.used, 0),
    (m && m.noyau) || 0, (m && m.cache) || 0);

  const programmes = cats.map((x, i) => {
    const k = cat(x.k), ps = parts[i];
    if (x.k === "conteneurs") {
      const n = ps.reduce((a, p) => a + p.pile.l.length, 0);
      return groupe("s:conteneurs", k[2], k[0], n, [x.mo, x.t || 0, somCpu(c)],
        ps.map(p => groupe("c:" + p.n, p.c, p.n, p.pile.l.length, [p.mem, p.sw, somCpu(p.pile.l)],
          p.pile.l.map(y => {
            const pre = PILES.find(q => y.n.startsWith(q.k));
            const nom = pre ? `<s>${esc(pre.k)}</s>${esc(y.n.slice(pre.k.length))}` : esc(y.n);
            return ligne(nom, memC(y), y.swap || 0, y.cpu, p.c);
          }).join(""), "sous")).join(""));
    }
    return groupe("s:" + x.k, k[2], k[0], ps.length, [x.mo, x.t || 0, somCpu(ps)],
      ps.length ? ps.map(p => ligne(esc(p.n), p.mem, p.sw, p.cpu, p.c)).join("")
                : `<div class="note">Détail en attente du collecteur</div>`);
  }).join("");

  /* ---- 3. Ce qui n appartient a personne ---- */
  let noyau = "";
  const det = m && m.det;
  if (det) {
    const z = det.zram || [], sw = det.swaps || [];
    const orig = z.reduce((a, x) => a + x.orig, 0), used = z.reduce((a, x) => a + x.used, 0);
    const ssd = sw.reduce((a, x) => a + x.used, 0);
    const NOMS_SWAP = { ssd: "partition du SSD", fichier: "fichier d'échange" };
    /* HORS PROGRAMMES, MEMES COLONNES (05/10/2026, sur demande).
       Zram : « memoire » = la RAM qu il occupe vraiment, « swap » = les donnees
       de swap qu il contient. Le titre additionne zram et SSD dans sa colonne
       swap : c est exactement ce que les programmes ont en swap, d un cote de
       la fenetre comme de l autre. Compression et remplissage, qui n ont pas de
       colonne, suivent le nom en petit. La partition et le fichier d echange
       n occupent pas de RAM : « — » en memoire. */
    const nz = nuances("#c07bf0", z.length);
    noyau += groupe("k:zram", "#c07bf0", "Zram et swap", null, [used, orig + ssd, null],
      z.map((x, i) => ligne(esc(x.n) + precis([x.algo, x.used ? "×" + vg((x.orig / x.used).toFixed(1)) : "",
            "plein à " + Math.round(x.orig / (x.cap || 1) * 100) + " %"].filter(Boolean).join(" · ")),
          x.used, x.orig, null, nz[i])).join("")
      + sw.map(x => ligne(esc(NOMS_SWAP[x.n] || x.n) + precis("sur " + moGo(x.size) + (x.n === "ssd" ? " · lent" : "")),
          null, x.used, null, "#ff9f0a")).join(""));
    const n = det.noyau || {};
    const tn = m.noyau || 0;
    const parts = [["caches d'objets, récupérables", n.slab_r], ["caches d'objets, fixes", n.slab_u],
                   ["tables de pages", n.pt], ["piles des processus", n.ks]].filter(([, v]) => v > 0);
    const rn = Math.max(0, tn - parts.reduce((a, [, v]) => a + v, 0));
    if (rn > 0) parts.push(["pilotes et réservé", rn]);
    const nn = nuances("#8a94a6", parts.length);
    noyau += groupe("k:noyau", "#8a94a6", "Noyau", null, [tn, 0, null],
      parts.map(([l, v], i) => ligne(esc(l), v, 0, null, nn[i])).join(""));
    const ca = det.cache || {}, tc = m.cache || 0;
    const pc2 = [["fichiers lus récemment", ca.actif], ["fichiers anciens, rendus en premier", ca.inactif],
                 ["mémoire partagée", ca.shmem]].filter(([, v]) => v > 0);
    const nc = nuances("#4d97ee", pc2.length);
    noyau += groupe("k:cache", "#4d97ee", "Cache", null, [tc, 0, null],
      pc2.map(([l, v], i) => ligne(esc(l), v, 0, null, nc[i])).join(""));
  }

  /* ---- Barre de tete : chaque categorie, decoupee en ses sous-parties ----
     La legende ne nomme que les categories, dans l ORDRE DE LA LISTE : les
     nuances suffisent a montrer qu un bloc se compose de plusieurs parties.
     ⚠️ LA BARRE ET LA LEGENDE PORTENT LA MEMOIRE SEULE, la valeur de la colonne
     « memoire ». Elles additionnaient le swap : la legende annoncait 1,6 Go pour
     des conteneurs dont le titre disait 1,3 Go (05/10/2026). Le swap reste dans
     sa colonne et dans le voile des barres. */
  const tt = Math.max(1, cats.reduce((a, x) => a + x.mo, 0));
  /* Survol d un segment : la categorie en titre, la sous-partie, sa memoire et
     sa part de la memoire des programmes. Lu par l infobulle commune
     (`data-lec="part"`, voir `litPart`). */
  const seg = (titre, nom, v, coul) => `<i data-lec="part" data-t="${esc(titre)}" data-n="${esc(nom)}"`
    + ` data-v="${esc(moGo(v) + " · " + vg((v / tt * 100).toFixed(1)) + " %")}" data-c="${coul}"`
    + ` style="width:${(v / tt * 100).toFixed(2)}%;background:${coul}"></i>`;
  const barre = `<div class="compo"><div class="cbar">`
    + cats.map((x, i) => parts[i].length
        ? parts[i].map(p => seg(cat(x.k)[0], p.n, p.mem, p.c)).join("")
        : seg(cat(x.k)[0], "en mémoire", x.mo, cat(x.k)[2])).join("")
    + `</div><div class="clg">` + cats.map(x =>
        `<span><i style="background:${cat(x.k)[2]}"></i>${esc(cat(x.k)[0])} <b>${moGo(x.mo)}</b></span>`).join("")
    + `</div></div>`;

  /* En-tete de colonnes. ⚠️ Il est place AU-DESSUS de la zone defilante, et son
     alignement se regle dans `fond.css` : `.scroll` reserve 10 px de barre et 8
     de remplissage, l en-tete compense donc par 18 px de marge droite. */
  const entete = `<div class="ln lnh"><span class="nm">processus</span>`
    + `<span class="mm">mémoire</span><span class="sw">swap</span>`
    + `<span class="cp">proc.</span></div>`;

  const swTot = m ? ((m.g || []).reduce((a, x) => a + (x.t || 0), 0)) : c.reduce((a, x) => a + (x.swap || 0), 0);
  d.classList.add("large");
  d.innerHTML = `<h3>Mémoire</h3>
    <div class="sub">${m ? moGo(m.dispo) + " disponibles sur " + moGo(m.tot)
        + " · programmes " + moGo(m.prog) + " et " + moGo(swTot) + " en swap"
      : c.length + " conteneurs"}</div>
    ${barre}${entete}<div class="scroll">${programmes
      + (noyau ? section("Hors programmes · noyau, cache et swap") + noyau : "")}</div>`;
  d.querySelectorAll("details.grp").forEach(el => el.addEventListener("toggle", () => {
    const o = [...d.querySelectorAll("details.grp[open]")].map(x => x.dataset.g);
    try { localStorage.setItem("hl-pop-ouverts", JSON.stringify(o)); } catch (e) { /* navigation privee */ }
  }));
  d.showModal();
}

/* ---- Fenetre « Acces » : TOUTES LES CONNEXIONS DES 24 H (05/10/2026) ----
   Demandee le 05/10/2026 : la carte n en montre que quatre. Trois lectures, de la
   plus large a la plus fine : l histogramme heure par heure dit QUAND, le
   compte par machine et par methode dit QUI et COMMENT, puis le journal entier,
   ou les connexions identiques rapprochees forment une rafale qu on deplie
   jusqu a la minute.
   `ev` arrive du collecteur en tableaux courts :
   [heure, service, compte, machine, methode, ok, Internet]. Un collecteur plus
   ancien n envoie que `log`, deja regroupe : la fenetre s en contente. */
const RAFALE_S = 30 * 60;     // deux connexions identiques a moins de 30 min : meme rafale
let ACC_H = [];               // tranches de l histogramme, relues par l infobulle
const COUL_ACC = { SSH: "#4d97ee", UGOS: "#c07bf0", Web: "#c07bf0" };
/* Couleur d une connexion : celle de son service, sauf alerte. Internet passe
   avant le refus : une tentative venue de dehors est le cas a voir d abord. */
const accCoul = (e) => e.x ? "#ff453a" : !e.ok ? "#ff9f0a" : COUL_ACC[e.s] || "#5ac8fa";
const accCat = (e) => e.x ? "depuis Internet" : !e.ok ? "refusée" : e.s;

function popAcces() {
  const d = document.getElementById("dlg");
  d.classList.add("large");
  const a = DATA.acces;
  if (!a) {
    d.innerHTML = `<h3>Accès</h3><div class="note">Relevé des connexions en attente</div>`;
    return d.showModal();
  }
  const ev = (a.ev || []).length
    ? a.ev.map(x => ({ t: +x[0], s: x[1], u: x[2], n: x[3], r: x[4], ok: !!x[5], x: !!x[6], c: 1 }))
    : (a.log || []).map(x => Object.assign({}, x, { c: x.c || 1 }));
  const tot = ev.reduce((s, e) => s + e.c, 0);
  const n = a.n != null ? a.n : tot;
  const refus = ev.reduce((s, e) => s + (e.ok ? 0 : e.c), 0);
  const ext = ev.reduce((s, e) => s + (e.x ? e.c : 0), 0);
  const pl = (v, m) => nb(v) + " " + m + (v > 1 ? "s" : "");

  /* ---- 1. Histogramme, une colonne par heure d horloge ----
     La premiere est entamee : la fenetre du collecteur commence 24 h avant
     maintenant, rarement pile sur une heure. ⚠️ UNE COLONNE NON VIDE GARDE 8 %
     DE HAUTEUR : a cote d une rafale de cent connexions, une connexion seule
     au telephone disparaissait. */
  const fin = Date.now() / 1000;
  const h = new Date((fin - 86400) * 1000); h.setMinutes(0, 0, 0);
  const t0 = h.getTime() / 1000, nH = Math.ceil((fin - t0) / 3600);
  ACC_H = Array.from({ length: nH }, (_, i) => ({ t0: t0 + i * 3600, t1: Math.min(fin, t0 + (i + 1) * 3600), n: 0, g: new Map() }));
  for (const e of ev) {
    const b = ACC_H[Math.floor((e.t - t0) / 3600)];
    if (!b) continue;
    b.n += e.c;
    const k = [e.s, e.u, e.n, e.r, e.x].join("|");
    const x = b.g.get(k) || { s: e.s, u: e.u, n: e.n, r: e.r, c: 0, col: accCoul(e), cat: accCat(e) };
    x.c += e.c; b.g.set(k, x);
  }
  const M = Math.max(1, ...ACC_H.map(b => b.n));
  const ORDRE = (c) => c === "depuis Internet" ? 2 : c === "refusée" ? 1 : 0;
  const colonnes = ACC_H.map((b, i) => {
    /* Segments empiles par categorie, les alertes en haut de la colonne. */
    const cats = new Map();
    for (const x of b.g.values()) {
      const c = cats.get(x.cat) || { cat: x.cat, col: x.col, c: 0 };
      c.c += x.c; cats.set(x.cat, c);
    }
    const segs = [...cats.values()].sort((p, q) => ORDRE(p.cat) - ORDRE(q.cat) || q.c - p.c);
    const ht = b.n ? Math.max(8, b.n / M * 100) : 0;
    return `<span class="acb${b.n ? "" : " vide"}" data-lec="acc" data-i="${i}"><i style="height:${ht.toFixed(1)}%">`
      + segs.map(s => `<b style="flex:${s.c};background:${s.col}"></b>`).join("") + `</i></span>`;
  }).join("");
  /* Repere toutes les six heures, a l aplomb de sa colonne. */
  const axe = ACC_H.map(b => { const hh = new Date(b.t0 * 1000).getHours();
    return `<span>${hh % 6 === 0 ? String(hh).padStart(2, "0") + " h" : ""}</span>`; }).join("");
  const presentes = [...new Set(ev.map(accCat))].sort((p, q) => ORDRE(p) - ORDRE(q));
  const legende = presentes.map(c => {
    const e = ev.find(x => accCat(x) === c);
    const v = ev.filter(x => accCat(x) === c).reduce((s, x) => s + x.c, 0);
    return `<span><i style="background:${accCoul(e)}"></i>${esc(c)} <b>${nb(v)}</b></span>`;
  }).join("");
  const histo = `<div class="acx"><div class="acx-m">${pl(M, "connexion")} au plus dans une heure</div>`
    + `<div class="acx-b" style="--n:${nH}">${colonnes}</div>`
    + `<div class="acx-a" style="--n:${nH}">${axe}</div></div>`
    + `<div class="clg">${legende}</div>`;

  /* ---- 2. Qui et comment ---- */
  const compte = (cle, coul, prec) => {
    const m = new Map();
    for (const e of ev) {
      const k = cle(e);
      const x = m.get(k) || { k, c: 0, e, l: [] };
      x.c += e.c; x.l.push(e); m.set(k, x);
    }
    const l = [...m.values()].sort((p, q) => q.c - p.c);
    const mx = Math.max(1, ...l.map(x => x.c));
    return rangs(l.map(x => [x.k, nb(x.c), x.c / mx * 100, coul(x), prec(x)]));
  };
  /* Une machine se colore selon sa pire connexion : une seule venue d Internet
     ou refusee suffit a la faire remarquer. */
  const pire = (x) => accCoul(x.l.find(e => e.x) || x.l.find(e => !e.ok) || x.e);
  const services = (x) => [...new Set(x.l.map(e => e.u))].join(", ") + " · " + [...new Set(x.l.map(e => e.s))].join(", ");
  const geo = a.geo || {};
  const qui = ev.length ? `<div class="acc-duo">`
    + `<div><div class="psec">Par machine</div>${compte(e => e.n, pire,
        x => services(x) + (geo[x.k] ? " · " + lieu(geo[x.k]) : ""))}</div>`
    + `<div><div class="psec">Par méthode</div>${compte(e => e.s + " · " + e.r, x => accCoul(x.e), () => "")}</div>`
    + `</div>` : "";

  /* ---- 3. Le journal, par rafales ----
     Une rafale : des connexions identiques (service, compte, machine, methode,
     resultat) qui se suivent a moins de 30 min. Un script qui se connecte en
     boucle tient sur une ligne, « 09:21 → 10:47 ×30 », au lieu de trente. */
  const raf = [];
  for (const e of ev.slice().sort((p, q) => q.t - p.t)) {
    const p = raf[raf.length - 1];
    if (p && p.s === e.s && p.u === e.u && p.n === e.n && p.r === e.r && p.ok === e.ok && p.x === e.x
        && p.t0 - e.t <= RAFALE_S) { p.c += e.c; p.t0 = e.t; p.ts.push(e.t); }
    else raf.push(Object.assign({}, e, { t1: e.t, t0: e.t, ts: [e.t] }));
  }
  const auj = new Date().toDateString(), hier = new Date(Date.now() - 86400000).toDateString();
  const jourDe = (t) => { const j = new Date(t * 1000).toDateString();
    return j === auj ? "Aujourd'hui" : j === hier ? "Hier"
      : new Date(t * 1000).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }); };
  /* Minutes d une rafale, les doublons d une meme minute fondus en « ×3 ». */
  const minutes = (ts) => {
    const m = new Map();
    for (const t of ts) { const k = hhmm(t); m.set(k, (m.get(k) || 0) + 1); }
    return [...m].map(([k, v]) => `<span>${k}${v > 1 ? `<small>×${v}</small>` : ""}</span>`).join("");
  };
  const ligne = (x) => {
    const plage = x.t0 === x.t1 || hhmm(x.t0) === hhmm(x.t1) ? hhmm(x.t1) : hhmm(x.t0) + " → " + hhmm(x.t1);
    const cl = x.x ? "cr" : x.ok ? "ok" : "wn";
    const corps = `<span class="chev" aria-hidden="true"></span><span class="h">${plage}</span>`
      + `<span class="s">${esc(x.s)}</span>`
      + `<span class="q">${esc(x.u)} · ${esc(x.n)}${x.c > 1 ? ` <small>×${nb(x.c)}</small>` : ""}</span>`
      + `<span class="r ${cl}">${esc(x.r)}${x.x ? " · Internet" : ""}</span>`
      + (x.x ? `<span class="lieu">${esc(lieu(geo[x.n]) || "localisation inconnue")}</span>` : "");
    /* Depliable seulement quand il y a plus d une minute a montrer. */
    return x.ts.length > 1 && new Set(x.ts.map(hhmm)).size > 1
      ? `<details class="acj"><summary class="acr">${corps}</summary><div class="acm">${minutes(x.ts)}</div></details>`
      : `<div class="acr seul">${corps}</div>`;
  };
  let jour = "", journalHtml = "";
  for (const x of raf) {
    const j = jourDe(x.t1);
    if (j !== jour) { journalHtml += `<div class="psec">${esc(j)}</div>`; jour = j; }
    journalHtml += ligne(x);
  }

  const coupe = (a.ev || []).length && a.ev.length < n ? " · les " + nb(a.ev.length) + " plus récentes affichées" : "";
  d.innerHTML = `<h3>Accès</h3>
    <div class="sub">${pl(n, "connexion")} sur 24 h · ${refus ? pl(refus, "refusée") : "aucune refusée"} · ${
      ext ? nb(ext) + " depuis Internet" : "toutes depuis le réseau local ou le VPN"}${coupe}</div>
    ${ev.length ? histo : ""}<div class="scroll">${ev.length ? qui + journalHtml
      : `<div class="note">Aucune connexion sur 24 h</div>`}</div>`;
  d.showModal();
}

/* ============ JOURNAL DES 7 JOURS (09/10/2026) ============
   Construit par `systeme.py` (`journal`) : [heure, categorie, texte, niveau],
   du plus recent au plus ancien. Niveau `ok` retour a la normale, `in`
   information, `wn` incident, `cr` panne : la pastille de chaque ligne en prend
   la couleur. */
const J_CAT = { nas: "NAS", memoire: "Mémoire", conteneur: "Conteneur", maj: "Mise à jour", sonde: "Sonde",
                site: "Site", vpn: "VPN", reseau: "Réseau", sauvegarde: "Sauvegarde", acces: "Accès" };
/* L heure seule aujourd hui ; « hier » ; le jour de la semaine au-dela. Dans la
   fenetre, ou les jours ont leur intertitre, l heure suffit (`seule`). */
const quandJ = (t, seule) => {
  const j = new Date(t * 1000).toDateString();
  if (seule || j === new Date().toDateString()) return hhmm(t);
  if (j === new Date(Date.now() - 86400000).toDateString()) return "hier " + hhmm(t);
  return new Date(t * 1000).toLocaleDateString("fr-FR", { weekday: "short" }) + " " + hhmm(t);
};
const evts = (l, max, seule) => `<div class="jx${seule ? " court" : ""}">${l.slice(0, max || l.length).map(e =>
  `<div class="${esc(e[3] || "in")}"><span class="h">${quandJ(e[0], seule)}</span><span class="pt"></span>`
  + `<span class="s">${esc(J_CAT[e[1]] || e[1])}</span><span class="q">${esc(e[2])}</span></div>`).join("")}</div>`;

/* La fenetre : la semaine jour par jour, filtrable par categorie. Le filtre
   choisi est garde le temps de la page, pas au-dela. */
let J_FILTRE = "";
function popJournal() {
  const d = document.getElementById("dlg");
  d.classList.add("large");
  const l = DATA.journal || [];
  const cats = [...new Set(l.map(e => e[1]))].sort((a, b) => (J_CAT[a] || a).localeCompare(J_CAT[b] || b));
  if (J_FILTRE && !cats.includes(J_FILTRE)) J_FILTRE = "";
  const vue = J_FILTRE ? l.filter(e => e[1] === J_FILTRE) : l;
  const puce = (k, t, n) => `<button type="button" data-jf="${esc(k)}"${J_FILTRE === k ? ' class="on"' : ""}>${esc(t)}<b>${nb(n)}</b></button>`;
  const filtres = cats.length > 1 ? `<div class="jf">${puce("", "Tout", l.length)}${
    cats.map(c => puce(c, J_CAT[c] || c, l.filter(e => e[1] === c).length)).join("")}</div>` : "";
  const auj = new Date().toDateString(), hier = new Date(Date.now() - 86400000).toDateString();
  const jourDe = (t) => { const j = new Date(t * 1000).toDateString();
    return j === auj ? "Aujourd'hui" : j === hier ? "Hier"
      : new Date(t * 1000).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }); };
  let corps = "", jour = "", lot = [];
  const vide = () => { if (lot.length) corps += evts(lot, 0, true); lot = []; };
  for (const e of vue) {
    const j = jourDe(e[0]);
    if (j !== jour) { vide(); corps += `<div class="psec">${esc(j)}</div>`; jour = j; }
    lot.push(e);
  }
  vide();
  const inc = l.filter(e => e[3] === "wn" || e[3] === "cr").length;
  d.innerHTML = `<h3>Journal</h3>
    <div class="sub">${pluriel(l.length, "événement")} sur 7 jours · ${inc ? pluriel(inc, "incident") : "aucun incident"}</div>
    ${filtres}<div class="scroll">${corps || `<div class="note">Aucun événement sur 7 jours</div>`}</div>`;
  d.querySelectorAll("[data-jf]").forEach(b => b.onclick = () => { J_FILTRE = b.dataset.jf; popJournal(); });
  if (!d.open) d.showModal();
}

/* ---- LES COURBES EN GRAND (18/10/2026, demande) ----
   Dans une carte, une courbe tient dans 270 px : une semaine de debit s y
   tasse. Un clic SUR LA COURBE l ouvre dans une fenetre, sur toute sa largeur,
   avec sa legende, son axe du temps et le choix 24 h · 7 j ; le survol y lit
   les memes valeurs (l infobulle suit dans la fenetre, voir `montreTip`).
   - Le reste de la carte garde son lien ou sa fenetre.
   - Au doigt, un premier toucher lit la courbe (infobulle) sans quitter la
     page ; un second toucher sur la meme courbe l ouvre en grand.
   - La fenetre reprend le dessin de la carte (memes donnees, meme periode) :
     `data-pour` la relie a sa carte, pour la redessiner au changement de
     periode.
   - Les rubans aussi (VPN, Uptime Kuma), avec leur legende et leurs heures. */
const GRAPHE = ".grb, svg.batt.fin";
function popGraphe(carte) {
  const g = carte && carte.querySelector(GRAPHE);
  if (!g) return;
  const d = dlg();
  d.classList.remove("large");
  const boite = g.parentElement;
  const blocs = [...boite.children].filter((e) => e.matches(".leg, .grb, .gech, .rleg, svg.batt.fin, .ech"))
    .map((e) => e.outerHTML).join("");
  const desc = carte.querySelector(".head p"), per = carte.querySelector(".periode");
  d.innerHTML = `<h3>${esc(carte.querySelector(".nom").textContent)}</h3>`
    + (desc ? `<div class="sub">${esc(desc.textContent)}</div>` : "")
    + (per ? per.outerHTML : "")
    + `<div class="courbe" data-pour="${esc(carte.dataset.carte)}">${blocs}</div>`;
  if (!d.open) d.showModal();
}
/* ⚠️ LA ZONE DU CLIC EST LE BLOC DU GRAPHE ENTIER (18/10/2026, demande : « sur
   mobile on pourrait vite cliquer a cote ») : sa legende, son trace, son axe
   du temps, les ecarts entre eux, et 10 px autour. Les commandes qui s y
   trouvent gardent leur clic (selecteur, boutons, liens). Au doigt, seul le
   TRACE garde ses deux temps (sa valeur, puis la fenetre) ; la legende ou
   l axe ouvrent directement. */
const ZONE_GRAPHE = ".leg, .grb, .gech, .rleg, svg.batt.fin, .ech";
function dansGraphe(carte, x, y) {
  const g = carte.querySelector(GRAPHE);
  if (!g) return false;
  const rs = [...g.parentElement.children].filter((e) => e.matches(ZONE_GRAPHE)).map((e) => e.getBoundingClientRect());
  const M = 10;
  return x >= Math.min(...rs.map((r) => r.left)) - M && x <= Math.max(...rs.map((r) => r.right)) + M
    && y >= Math.min(...rs.map((r) => r.top)) - M && y <= Math.max(...rs.map((r) => r.bottom)) + M;
}
addEventListener("click", (e) => {
  if (e.defaultPrevented || !e.target.closest) return;
  const carte = e.target.closest("#groups .card");
  if (!carte || e.target.closest(".periode, button, [data-lien], [data-pc], [data-disque], [data-espace]")) return;
  if (!dansGraphe(carte, e.clientX, e.clientY)) return;
  e.preventDefault(); e.stopPropagation();
  const trace = e.target.closest("svg[data-lec]");
  if (AU_DOIGT && trace && !(TOUCHE === trace && TOUCHE_PREC === trace)) return;
  cacheTip();
  popGraphe(carte);
}, true);

/* ---- Fenetre d un disque (05/10/2026) ----
   Pourquoi : la ligne d un disque dans la carte Stockage
   (temperature, usure, erreurs) « est bien mais vague ». Un clic ouvre sa
   fiche : quatre chiffres, puis la sante, les sondes de temperature, l usure
   et les ecritures, l identite et la liaison, les partitions.
   Le detail vient de `systeme.json` (`disq`, collecteur root, relu toutes les
   10 min) ; sans lui, la fenetre se contente de smart.json. */
const PCIE = { "2.5": "1.0", "5.0": "2.0", "8.0": "3.0", "16.0": "4.0", "32.0": "5.0", "64.0": "6.0" };
/* Points de montage d UGOS, en clair. */
const MONTAGES = { "/boot": "démarrage", "/rootfs": "système", "[SWAP]": "swap", "/ugreen": "applications UGOS",
                   "/overlay": "système, partie modifiable", "/mnt/factory": "réglages d'usine" };
/* Octets en unites DECIMALES, celles des fabricants : la fiche d un disque dit
   « 8 To » et « 45 To ecrits ». `taille()`, binaire, reste celle de l espace
   occupe, comme l affichent UGOS et Windows. */
const dec = (o) => o >= 1e12 ? vg((o / 1e12).toFixed(1)) + " To" : o >= 1e9 ? vg((o / 1e9).toFixed(1)) + " Go"
  : Math.round(o / 1e6) + " Mo";

function popDisque(n) {
  const s = DATA.smart || {}, x = (s.d || []).find(y => y.n === n);
  if (!x) return;
  const dl = document.getElementById("dlg");
  dl.classList.add("large");
  const det = x.det || {}, h = det.h || {};
  const val = (a, b) => a != null ? a : b;
  const usure = val(h.usure, x.usure), heures = val(h.heures, x.heures), cycles = val(h.cycles, x.cycles);
  const ecrit = val(h.ecrit, x.ecrit != null ? x.ecrit * 1e12 : null);
  const spare = val(h.spare, x.spare), brutaux = val(h.brutaux, x.brutaux), errM = val(h.err_media, x.erreurs);
  const role = ROLES[x.role];
  const modele = x.modele.replace(/_/g, " ").replace(/\s*\d+(?:[.,]\d+)?\s*(?:GB|TB|Go|To)$/i, "");
  const cap = x.go >= 1000 ? vg((x.go / 1000).toFixed(1)) + " To" : x.go + " Go";
  const g = (s.grappes || []).find(y => (y.disques || []).includes(n));
  const ou = !g ? "hors grappe" : g.sys ? "disque de démarrage" : g.nom + " · " + (RAID[g.raid] || g.raid);
  const jours = heures != null ? Math.round(heures / 24) : null;
  const [tMax, tCrit] = det.seuils || [];
  const pl = (v, m, p) => nb(v) + " " + (v > 1 ? (p || m + "s") : m);
  const sec = (t) => `<div class="psec">${esc(t)}</div>`;
  const kv = (l) => `<div class="dkv">${l.filter(Boolean).map(([k, v, cl]) =>
    `<span>${esc(k)}</span><b${cl ? ` class="${cl}"` : ""}>${esc(v)}</b>`).join("")}</div>`;

  /* ---- Quatre chiffres, les memes seuils que la ligne de la carte ---- */
  const tuile = (v, l, cl) => `<div class="dtu${cl ? " " + cl : ""}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`;
  const tuiles = `<div class="dtus">`
    + tuile(x.temp + " °C", "température", teinteT(x.temp, SEUILS_T.nvme).replace("ok", ""))
    + tuile(usure != null ? usure + " %" : "—", "usure", usure >= 80 ? "wn" : "")
    + tuile(ecrit ? dec(ecrit) : "—", "écrits au total")
    + tuile(jours != null ? nb(jours) + " j" : "—", "en service") + `</div>`;

  /* ---- Sante ----
     ⚠️ LE JOURNAL D ERREURS N EST PAS UNE ALERTE : il compte surtout des
     commandes que le disque a refusees (une fonction non geree), sans aucun
     rapport avec les donnees. Ce sont les erreurs DU SUPPORT qui comptent. */
  const CW = [[1, "réserve de secours épuisée"], [2, "température hors limites"], [4, "fiabilité dégradée"],
              [8, "passé en lecture seule"], [16, "sauvegarde interne en échec"]];
  const chaud = (h.t_alerte || 0) + (h.t_crit || 0);
  const sante = controles([
    det.ok === false || !x.ok ? ["wn", "Bilan SMART : défaut signalé", "disque à remplacer"]
      : ["ok", "Bilan SMART : aucun défaut", ""],
    h.cw > 0 ? ["wn", "Alerte du disque : " + CW.filter(([b]) => h.cw & b).map(([, t]) => t).join(", "), ""] : null,
    spare != null ? [h.spare_min != null && spare <= h.spare_min ? "wn" : "ok", "Réserve de secours " + spare + " %",
                     h.spare_min != null ? "alerte sous " + h.spare_min + " %" : ""] : null,
    errM > 0 ? ["wn", pl(errM, "erreur") + " du support", "données illisibles ou abîmées"]
      : ["ok", "Aucune erreur du support", "données illisibles ou abîmées"],
    h.err_journal == null ? null : h.err_journal > 0
      ? ["in", pl(h.err_journal, "entrée") + " au journal d'erreurs", "commandes refusées, sans gravité"]
      : ["ok", "Journal d'erreurs vide", ""],
    chaud > 0 ? ["wn", "En surchauffe pendant " + duree(chaud), "depuis la mise en service"]
      : h.t_alerte != null ? ["ok", "Jamais en surchauffe", tMax ? "alerte à " + tMax + " °C" : ""] : null,
    brutaux == null ? null : brutaux > 0
      ? ["in", pl(brutaux, "arrêt brutal", "arrêts brutaux"), "coupures de courant ou redémarrages forcés"]
      : ["ok", "Aucun arrêt brutal", ""],
  ]);

  /* ---- Temperature : les sondes du disque, puis 24 h d historique ---- */
  const dg = v => Math.round(v) + " °C";
  const v24 = Hf(DATA, n).filter(v => v > 0), v7 = Hs(DATA, n).filter(v => v > 0);
  const capt = det.capt || [];
  const nc = nuances("#4d97ee", capt.length);
  /* ⚠️ PAS DE COURBE (retiree sur demande le 05/10/2026) : la carte
     Temperatures trace deja chaque disque sur 24 h. Restent ce qu elle ne
     montre pas : les sondes du disque une a une, sa plage, ses seuils. */
  const temp = (capt.length ? leg(capt.map(([l, t], i) =>
        [l === "Composite" ? "globale" : l.replace(/^Sensor/, "sonde"), nc[i], t + " °C"])) : "")
    + past([v24.length ? ["24 h : de " + dg(Math.min(...v24)) + " à " + dg(Math.max(...v24)), ""] : null,
            /* ⚠️ La serie de 7 jours est faite de MOYENNES HORAIRES, qui lissent
               les pointes : seule, elle annoncait 42 °C quand les dernieres 24 h,
               a la minute, montaient a 44. On prend le plus haut des deux. */
            v7.length ? ["pointe sur 7 jours " + dg(Math.max(...v7, ...v24)), ""] : null,
            tMax ? ["alerte à " + tMax + " °C" + (tCrit ? ", critique à " + tCrit + " °C" : ""), ""] : null]);

  /* ---- Usure et ecritures ----
     La duree de vie restante se deduit de l usure DEJA CONSOMMEE et de l age :
     c est le seul chiffre que le disque donne sur lui-meme. Sous 1 %, l usure
     est arrondie a zero et toute projection serait inventee. */
  const ry = det.rythme || {};
  const parJour = ry.j7 != null ? [ry.j7, "moyenne sur 7 jours"] : ry.j1 != null ? [ry.j1, "sur les dernières 24 h"]
    : ecrit && heures ? [ecrit / (heures / 24), "moyenne depuis la mise en service"] : null;
  const reste = usure >= 1 && heures ? heures / 8760 * (100 - usure) / usure : null;
  const usureHtml = usure != null ? pile(usure + " %", "de la durée de vie garantie consommée",
      [[usure, usure >= 80 ? "#ffb340" : "#34c759"]]) : "";
  const ecr = kv([
    ["Écrit au total", ecrit ? dec(ecrit) : "—"],
    h.lu ? ["Lu au total", dec(h.lu)] : null,
    parJour ? ["Écrit par jour", "≈ " + dec(parJour[0]) + " · " + parJour[1]] : null,
    usure != null ? ["Durée de vie restante", reste != null
      ? "≈ " + (reste >= 10 ? nb(Math.round(reste)) : vg(reste.toFixed(1))) + " ans au rythme actuel"
      : "trop peu d'usure pour l'estimer"] : null,
  ]);

  /* ---- Fiche : identite, liaison, vie du disque ----
     La liaison dit si le disque tourne a pleine vitesse : un emplacement M.2
     cable en x2 divise son debit par deux sans aucun autre symptome. */
  const [lv, ll, lvm, llm] = det.lien || [];
  const gen = (t) => { const m = /^([\d.]+)/.exec(t || ""); return m ? "PCIe " + (PCIE[m[1]] || m[1] + " GT/s") : ""; };
  const bride = lvm && (lvm !== lv || llm !== ll);
  const fiche = kv([
    ["Modèle", modele], ["Capacité", cap], det.fw ? ["Micrologiciel", det.fw] : null,
    lv ? ["Liaison", gen(lv) + " ×" + ll + (bride ? " · le disque accepte " + gen(lvm) + " ×" + llm : " · le maximum du disque")] : null,
    heures != null ? ["En service", nb(heures) + " h, soit " + pl(jours, "jour")] : null,
    cycles != null ? ["Allumages", nb(cycles)] : null,
    h.occupe != null ? ["Contrôleur occupé", duree(h.occupe) + " au total"] : null,
  ]);

  /* ---- Partitions, et ce que chacune porte ---- */
  const parts = (det.parts || []).filter(p => p.o >= 1e6).map(p => {
    const raid = (p.sur || []).find(c => /^raid/.test(c.t || ""));
    const fin = (p.sur || []).filter(c => c.m).slice(-1)[0];
    const nomM = (m) => MONTAGES[m] || (g && !g.sys && /^\/volume\d/.test(m) ? g.nom.toLowerCase() : m);
    const quoi = raid ? (RAID[raid.t] || raid.t) + " (" + raid.n + ")" + (fin ? " → " + nomM(fin.m) + (fin.fs ? " · " + fin.fs : "") : "")
      : p.m ? nomM(p.m) + (p.fs && p.fs !== "swap" ? " · " + p.fs : "")
      : p.fs ? p.fs + " · non montée" : "réservée, sans système de fichiers";
    return `<span>${esc(p.n.replace(/^nvme\d+n\d+/, ""))}</span><b>${esc(dec(p.o))}</b><em>${esc(quoi)}</em>`;
  }).join("");

  dl.innerHTML = `<h3>${esc(role ? role + " · " + modele : modele)}</h3>
    <div class="sub">${esc([cap, ou].join(" · "))}</div>${tuiles}
    <div class="scroll disq">${sec("Santé")}${sante}${sec("Température")}${temp}`
    + `${sec("Usure et écritures")}${usureHtml}${ecr}${sec("Fiche")}${fiche}`
    + `${parts ? sec("Partitions") + `<div class="dpt">${parts}</div>` : ""}`
    + `${x.det ? "" : `<div class="note">Détail complet en attente du collecteur</div>`}</div>`;
  dl.showModal();
}
/* ---- Fenetre de l espace d un volume (06/10/2026) ----
   Meme esprit que la fenetre Memoire, demandee le 06/10/2026 : la carte dit
   combien prend chaque categorie, la fenetre dit QUOI. Une ligne par
   categorie, de la plus grosse a la plus petite (« Autres » en dernier),
   depliable jusqu aux dossiers et a leurs enfants ; nuances de la couleur de la
   categorie pour ses dossiers ; UNE SEULE ECHELLE pour toutes les barres.
   Donnees : `esp.det` de systeme.json, ecrit par la mesure de nuit
   (`du_detail`). `p` : ce qu un dossier partage, en liens physiques, avec un
   dossier deja compte (torrents et Films/Series). */
const NOMS_DOSSIER = { "#recycle": "corbeille" };
function popEspace(nom) {
  const s = DATA.smart || {}, g = (s.grappes || []).find(y => y.nom === nom);
  if (!g || !g.esp) return;
  const dl = document.getElementById("dlg");
  dl.classList.add("large");
  const e = g.esp, det = e.det || {};
  const ES = typeof ESPACE !== "undefined" ? ESPACE : {};
  /* Noms de categorie avec majuscule, comme dans la fenetre Memoire : la
     legende de la carte les ecrit en minuscules, au fil de la phrase. */
  const cat = k => { const c = ES[k] || [k, "#8a94a6"];
    return [/^[a-z][A-Z]/.test(c[0]) ? c[0] : c[0].charAt(0).toUpperCase() + c[0].slice(1), c[1]]; };   /* « iSCSI » reste tel quel */
  const tot = e.tot || 1;
  const used = e.used != null ? e.used : Object.values(e.parts || {}).reduce((a, o) => a + o, 0);
  const cats = Object.entries(e.parts || {}).filter(([, o]) => o > 0)
    .sort(([a, x], [b, y]) => (a === "autres") - (b === "autres") || y - x);
  const E = Math.max(1, ...cats.map(([, o]) => o));
  const luns = e.iscsi || [], fI = fractionIscsi(e);
  let ouverts = [];
  try { ouverts = JSON.parse(localStorage.getItem("hl-pop-espace") || "[]"); } catch (er) { /* navigation privee */ }
  const pct = o => { const v = o / tot * 100; return v >= 10 ? Math.round(v) + " %" : vg(v.toFixed(1)) + " %"; };
  const barre = (o, c, cl) => `<span class="${cl}">${o > 0 ? `<i style="width:${(o / E * 100).toFixed(2)}%;background:${c}"></i>` : ""}</span>`;
  const nomD = n => esc(NOMS_DOSSIER[n] || n);
  const ligne = (n, o, c, pre) => `<div class="ln"><span class="nm">${n}${pre ? `<small>${esc(pre)}</small>` : ""}</span>`
    + `<span class="mm">${taille(o)}</span><span class="sw">${pct(o)}</span>${barre(o, c, "tr")}</div>`;
  const groupe = (id, c, n, k, o, lignes, cl) =>
    `<details class="grp${cl ? " " + cl : ""}" data-g="${esc(id)}"${ouverts.includes(id) ? " open" : ""}>`
    + `<summary class="grp-h ln"><span class="nm"><span class="chev" aria-hidden="true"></span>`
    + `<i style="background:${c}"></i><b>${esc(n)}</b>${k ? `<small>${k}</small>` : ""}</span>`
    + `<span class="mm">${taille(o)}</span><span class="sw">${pct(o)}</span>`
    + barre(o, c, "gb") + `</summary><div class="grp-l">${lignes}</div></details>`;
  /* ⚠️ SOUS 100 MO, UNE SEULE LIGNE. Sur le vrai NAS, « Applications » alignait
     quinze dossiers a 0 Go et les partages des fichiers de quelques Ko : du
     bruit qui noyait ce qui prend vraiment la place (06/10/2026). Ce qui
     partage des fichiers (`p`) reste toujours visible. */
  const SEUIL = 100 * 1048576;
  const tamis = (l) => {
    const g = [], petits = { n: 0, o: 0 };
    for (const x of l || []) {
      if (x.o >= SEUIL || x.p) g.push(x);
      else { petits.n += x.g ? (parseInt(x.n, 10) || 1) : 1; petits.o += x.o; }
    }
    return { g, petits };
  };
  /* Sous 1 Mo, la ligne de regroupement elle-meme disparait : « 1 petit
     dossier · 0 Mo » n apprend rien. */
  const ligneP = (p, c, mot) => p.n && p.o >= 1048576 ? ligne(`<s>${p.n} ${mot}</s>`, p.o, c) : "";
  /* Dossiers internes d UGOS (vignettes, index, flux video) : leurs enfants
     portent des noms hexadecimaux sans signification. On ne les deplie pas. */
  const HEX = /^[0-9a-f]{2}$|^[0-9a-f-]{16,}(\.[\w.-]+)?$/i;
  const codes = (l) => { const g = tamis(l).g; return g.length > 2 && g.filter(y => HEX.test(y.n)).length >= g.length * .6; };
  /* Enfants d un dossier : une ligne chacun, avec ce qu il partage. */
  const enfants = (l, c) => { const t = tamis(l);
    return t.g.map(x => ligne(x.g ? `<s>${esc(x.n)}</s>` : nomD(x.n), x.o, c,
        x.p ? "et " + taille(x.p) + " en commun avec un autre dossier" : "")).join("")
      + ligneP(t.petits, c, t.petits.n > 1 ? "petits fichiers et dossiers" : "petit fichier ou dossier"); };
  /* Un disque iSCSI : sa place sur le volume, et ce que Windows y a ecrit. */
  const ligneLun = (x, c) => {
    const lu = x.fs > 0 && x.used != null, p = lu ? Math.min(100, x.used / x.fs * 100) : 0;
    return `<div class="ln"><span class="nm">${esc(x.nom || "Disque " + x.id)}<small>${lu
        ? esc(taille(x.used) + " pris · " + taille(Math.max(0, x.fs - x.used)) + " libres") : "occupation illisible"}</small></span>`
      + `<span class="mm">${taille(x.alloc || x.tot)}</span><span class="sw">${pct(x.alloc || x.tot)}</span>`
      + `<span class="tr lunb">${lu ? `<i style="width:${p.toFixed(1)}%;background:${c}"></i>`
        + `<u style="width:${(100 - p).toFixed(1)}%;background:${c}"></u>` : ""}</span></div>`;
  };

  const parts = cats.map(([k, o]) => {
    const t = tamis(det[k]);
    return { k, o, ds: t.g, petits: t.petits, nu: nuances(cat(k)[1], Math.max(1, t.g.length)) };
  });
  /* « Autres », decompose par le collecteur d apres btrfs (06/10/2026). Un
     GROUPE comme les autres categories, pour la meme hauteur de ligne. */
  const AU = e.autres;
  const autres = (o, c) => {
    if (!AU) return groupe("c:autres", c, cat("autres")[0], "", o,
      `<div class="note">Détail après la prochaine mesure de nuit</div>`);
    const nu = nuances(c, 4);
    const l = [
      ["Métadonnées btrfs", AU.meta, "l'index des fichiers, gardé en double par sécurité"],
      [AU.snap > 0 ? "Instantanés et blocs conservés" : "Blocs conservés par la copie sur écriture", AU.cow,
       "fichiers réécrits par morceaux : disque iSCSI, torrents"],
      ["Réserve du système de fichiers", AU.reserve, ""],
    ].concat((AU.nc || []).map(x => [x.n, x.o, "dossier non classé"]))
      .filter(([, v]) => v >= 1048576).sort((a, b) => b[1] - a[1]);
    const dep = AU.depuis || 0;
    return groupe("c:autres", c, cat("autres")[0], "", o,
      l.map(([n, v, p], i) => ligne(esc(n), v, nu[Math.min(i, 3)], p)).join("")
      /* Ce qui a bouge depuis la mesure de nuit : ecrit (positif) ou efface. */
      + (Math.abs(dep) >= 104857600
        ? dep > 0 ? ligne("Écrit depuis la mesure de nuit", dep, nu[3], "mesuré à nouveau cette nuit")
          : `<div class="ln"><span class="nm">Effacé depuis la mesure de nuit<small>déjà retiré du total</small></span>`
            + `<span class="mm">−${taille(-dep)}</span><span class="sw"></span></div>`
        : ""));
  };
  /* Noms de partition du disque systeme, en clair. */
  const nomPart = n => MONTAGES[n] ? `${esc(MONTAGES[n])}<small>${esc(n)}</small>` : nomD(n);
  const corps = parts.map(({ k, o, ds, petits, nu }) => {
    const c = cat(k)[1];
    if (k === "autres") return autres(o, c);
    /* iSCSI : une ligne par disque, lue EN DIRECT (la mesure de nuit ne
       connait que des fichiers de la veille), sa barre sur toute la largeur
       pour le disque entier : pris en plein, libre a 38 %. */
    if (k === "iscsi" && luns.length) {
      const reste = o - luns.reduce((a, x) => a + (x.alloc || x.tot || 0), 0);
      return groupe("c:iscsi", c, cat(k)[0], luns.length > 1 ? luns.length + " disques" : "@iscsi", o,
        luns.map(x => ligneLun(x, c)).join("") + (reste >= 104857600 ? ligne("<s>autres fichiers</s>", reste, c) : ""));
    }
    if (!ds.length)
      return ligne(`<i class="pt" style="background:${c}"></i><b>${esc(cat(k)[0])}</b>`, o, c);
    /* Disque systeme : une ligne ou un groupe par partition. */
    if (g.sys)
      return groupe("s:" + k, c, cat(k)[0], ds.length > 1 ? ds.length + " parties" : "", o, ds.map((x, i) =>
        tamis(x.l).g.length > 1
          ? groupe("s:" + k + "/" + x.n, nu[i], MONTAGES[x.n] || x.n, esc(x.n), x.o, enfants(x.l, nu[i]), "sous")
          : ligne(nomPart(x.n), x.o, nu[i])).join(""));
    /* Un seul dossier (les medias : Jellyfin) : ses enfants directement, le
       dossier en precision. Plusieurs : un groupe emboite par dossier. Un
       dossier qui n a qu un enfant visible reste une simple ligne. */
    if (ds.length === 1)
      return groupe("c:" + k, c, cat(k)[0], esc(ds[0].n), o, enfants(ds[0].l, c));
    return groupe("c:" + k, c, cat(k)[0], ds.length + " dossier" + (ds.length > 1 ? "s" : ""), o, ds.map((x, i) =>
      tamis(x.l).g.length > 1 && !codes(x.l)
        ? groupe("d:" + k + "/" + x.n, nu[i], NOMS_DOSSIER[x.n] || x.n, "", x.o, enfants(x.l, nu[i]), "sous")
        : ligne(nomD(x.n), x.o, nu[i], codes(x.l) ? "données internes" : "")).join("")
      + ligneP(petits, c, petits.n > 1 ? "petits dossiers" : "petit dossier"));
  }).join("");

  /* Barre de tete : chaque categorie decoupee en ses dossiers, puis le libre.
     Survol : l infobulle commune (`data-lec="part"`). */
  const seg = (titre, n, o, c, vide) => `<i data-lec="part" data-t="${esc(titre)}" data-n="${esc(n)}"`
    + ` data-v="${esc(taille(o) + " · " + pct(o))}" data-c="${c}"${vide ? ' class="vide"' : ""} style="width:${(o / tot * 100).toFixed(2)}%;background:${c}"></i>`;
  const LIBRE = "rgba(255,255,255,.14)";
  const tete = `<div class="compo"><div class="cbar">`
    + parts.map(({ k, o, ds, petits, nu }) => k === "iscsi" && fI != null
        ? seg(cat(k)[0], "écrit dans les disques", o * fI, cat(k)[1])
          + seg(cat(k)[0], "libre dans les disques", o * (1 - fI), cat(k)[1], true)
        : ds.length > 1 && k !== "autres"
        ? ds.map((x, i) => seg(cat(k)[0], NOMS_DOSSIER[x.n] || x.n, x.o, nu[i])).join("")
          + (petits.o > 0 ? seg(cat(k)[0], "petits dossiers", petits.o, cat(k)[1]) : "")
        : seg(cat(k)[0], ds.length === 1 ? ds[0].n : "", o, cat(k)[1])).join("")
    + seg("Libre", "place disponible", Math.max(0, tot - used), LIBRE)
    + `</div><div class="clg">` + parts.map(({ k, o }) =>
        `<span><i style="background:${cat(k)[1]}"></i>${esc(cat(k)[0])} <b>${taille(o)}</b></span>`).join("")
    + `<span><i style="background:${LIBRE}"></i>Libre <b>${taille(Math.max(0, tot - used))}</b></span></div></div>`;

  const quand = (t) => { if (!t) return ""; const j = new Date(t * 1000);
    return "mesuré " + (j.toDateString() === new Date().toDateString() ? "aujourd'hui"
      : j.toDateString() === new Date(Date.now() - 864e5).toDateString() ? "hier"
      : "le " + j.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })) + " à " + hhmm(t); };
  const entete = `<div class="ln lnh"><span class="nm">dossier</span><span class="mm">taille</span><span class="sw">part</span></div>`;
  dl.innerHTML = `<h3>${esc(g.sys ? "Disque système" : g.nom)} · ce qui prend la place</h3>
    <div class="sub">${esc([surTotal(used, tot), taille(Math.max(0, tot - used)) + " libres", quand(e.mesure)].filter(Boolean).join(" · "))}</div>
    <div class="espw">${tete}${entete}<div class="scroll">${corps}${e.det ? ""
      : `<div class="note">Détail par dossier après la prochaine mesure de nuit</div>`}</div></div>`;
  dl.querySelectorAll("details.grp").forEach(el => el.addEventListener("toggle", () => {
    const o = [...dl.querySelectorAll("details.grp[open]")].map(x => x.dataset.g);
    try { localStorage.setItem("hl-pop-espace", JSON.stringify(o)); } catch (er) { /* navigation privee */ }
  }));
  dl.showModal();
}

/* Delegue : les lignes de disque et le bloc d espace sont redessines toutes les
   deux secondes. */
const ouvreStockage = (el) => el.dataset.disque ? popDisque(el.dataset.disque) : popEspace(el.dataset.espace);
addEventListener("click", (e) => {
  const el = e.target.closest && e.target.closest("[data-disque],[data-espace]");
  if (el) ouvreStockage(el);
});
addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const el = e.target.closest && e.target.closest("[data-disque],[data-espace]");
  if (el) { e.preventDefault(); ouvreStockage(el); }
});

/* Repli de toutes les cartes sur leur en-tête : on garde le logo, le nom,
   l'adresse et la pastille d'état, on masque le widget et les mesures. Réglage
   d'affichage propre à l'appareil, donc gardé en localStorage plutôt que dans
   shortcuts.json qui est partagé entre navigateurs.
   ⚠️ DEPUIS LE 17/10/2026, LE COMPACT EST UN RANGEMENT (tuiles par groupe,
   voir `tuiles`) : le bouton change `COMPACT` et redessine ; c est le dessin
   qui pose la classe sur #groups, APRES avoir lu ou sont les cartes (sinon
   l animation partirait de cartes deja habillees en tuiles). */
let COMPACT = false;
function replier(w) {
  const b = document.createElement("button");
  b.id = "compact"; b.type = "button";
  const ICO_LISTE = '<path d="M4 7h16M4 12h16M4 17h16"/>';
  const ICO_GRILLE = '<path d="M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z"/>';
  const pose = (on) => {
    COMPACT = on;
    b.classList.toggle("actif", on);
    b.innerHTML = svg(on ? ICO_GRILLE : ICO_LISTE, 2) + "Compact";
    b.title = on ? "Afficher les widgets" : "Réduire les cartes à leur en-tête";
  };
  pose(localStorage.getItem("compact") === "1");
  b.onclick = () => {
    const on = !COMPACT;
    localStorage.setItem("compact", on ? "1" : "0");
    pose(on);
    dessineGroupes();   // bento <-> tuiles : la disposition change, les cartes glissent
  };
  w.appendChild(b);
}

function filters() {
  const w = document.getElementById("filters");
  /* ⚠️ `#soucis` est deja dans la barre (index.html) : la barre n est plus vide
     avant construction, d ou le test sur le menu. */
  if (w.querySelector("#menu")) return;
  const soucis = document.getElementById("soucis");
  const panneau = document.createElement("div"); panneau.className = "panneau";
  const mk = (t, i, on) => { const b = document.createElement("button");
    b.textContent = t; if (on) b.className = "on";
    b.onclick = () => { w.classList.remove("ouvert");
      const nom = w.querySelector(".menu-nom"); if (nom) nom.textContent = t;
      w.querySelectorAll("button:not(#compact):not(#menu)").forEach(x => x.classList.remove("on")); b.classList.add("on");
      // le groupe choisi est RANGE seul, sur toute la largeur (bento comme tuiles)
      dessineGroupes(); };
    panneau.appendChild(b); };
  // Bouton du menu déroulant, masqué au-dessus du seuil par le CSS.
  const menu = document.createElement("button");
  menu.id = "menu"; menu.type = "button"; menu.title = "Groupes";
  menu.innerHTML = '<span class="menu-nom">Tout</span>' + svg('<path d="M6 9l6 6 6-6"/>', 2);
  /* Le menu s ouvre 6 px sous SON bouton. Avec les pastilles dans la barre,
     le bouton n est plus en haut de celle-ci (il est centre sur leur hauteur),
     et une position fixee en CSS l aurait recouvert. */
  menu.onclick = (e) => { e.stopPropagation();
    panneau.style.top = (menu.offsetTop + menu.offsetHeight + 6) + "px";
    w.classList.toggle("ouvert"); };
  w.insertBefore(menu, soucis);
  addEventListener("click", () => w.classList.remove("ouvert"));
  addEventListener("keydown", (e) => { if (e.key === "Escape") w.classList.remove("ouvert"); });

  mk("Tout", null, true); GROUPS.forEach((g, i) => mk(g.n, i));
  w.insertBefore(panneau, soucis);
  /* LA CLOCHE (09/10/2026) : masque ou rend les pastilles, et
     compte les cartes allumees a la couleur de la plus grave, pour qu une
     alerte se voie encore pastilles masquees. Le choix est garde dans le
     navigateur : un confort d affichage, sans stockage la page les montre.
     ⚠️ Un `<span role="button">` et non un `<button>` : les regles du menu
     prennent tout `#filters button` pour un onglet, et le cacheraient. */
  const al = document.createElement("span");
  al.id = "alertes"; al.setAttribute("role", "button"); al.tabIndex = 0;
  try { if (localStorage.getItem("homelab.notifs") === "0") w.classList.add("sans-notifs"); } catch (x) { /* stockage refuse */ }
  /* ⚠️ LES PASTILLES CHANGENT LA HAUTEUR DE LA BARRE (17/10/2026, saccade
     constatee) : tout ce qui suit sautait de 50 px, et sur grand ecran les
     coins restaient decales jusqu au tour suivant, qui les remettait en place
     d un second saut. La page se remet en place sur-le-champ (`dessineGroupes`
     mesure l en-tete, voir `mesureTete`) et chaque bloc glisse de son ancienne
     place a la nouvelle ; les pastilles qui reviennent apparaissent en fondu. */
  al.onclick = () => {
    const blocs = ["#bar", "main > .racc", "main > .search", "#nav", "#groups"].map((s) => document.querySelector(s)).filter(Boolean);
    const avant = blocs.map((b) => b.getBoundingClientRect().top);
    const cache = !w.classList.contains("sans-notifs");
    w.classList.toggle("sans-notifs", cache);
    try { localStorage.setItem("homelab.notifs", cache ? "0" : "1"); } catch (x) { /* stockage refuse */ }
    majAlertes();
    placeEtSerre();
    if (document.querySelector("main.coins")) dessineGroupes();
    if (doux()) return;
    const trajet = { duration: 260, easing: "cubic-bezier(.22,.8,.24,1)" };
    blocs.forEach((b, i) => {
      const dy = avant[i] - b.getBoundingClientRect().top;
      if (Math.abs(dy) > .5) b.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], trajet);
    });
    if (!cache) document.getElementById("soucis")?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
  };
  w.appendChild(al);
  majAlertes();
  replier(w);
  /* La barre vient d etre construite autour des pastilles : leur place a change. */
  placeEtSerre();
}

/* Cadence de chaque fichier, en secondes : celle de son collecteur, ou moins.
   `live.json` bouge toutes les 2 s, le reste bien plus lentement. */
const CADENCE = { "data.json": 10, "live.json": 0, "history.json": 60,
                  "containers.json": 60, "smart.json": 600 };
let TOUR = false;           // un tour de rafraichissement en cours
/* Les cartes, depuis `DATA`. A part de `refresh` pour qu un selecteur de
   periode redessine sa carte sur-le-champ, sans attendre ni relire le NAS. */
/* ============ BENTO (17/10/2026) ============
   Les cartes ne suivent plus une grille de 4 colonnes : `rangement.js` range
   chaque groupe en un rectangle sans trou, et les groupes en rangees, d apres
   les formes de chaque carte (cartes.js). Le HTML porte la place de chaque
   carte (`card(s, d, p)`) : la fusion du DOM (`fondre`) retire tout attribut
   absent du nouveau HTML, une place posee apres coup ne survivrait pas.
   ⚠️ LE RANGEMENT N EST PAS REFAIT A CHAQUE TOUR (toutes les 2 s) : seulement
   quand ce qui le decide change (largeur, alertes, releves absents, formes
   ecartees, groupe choisi). Sinon, le dernier est repris tel quel.
   ⚠️ APRES COUP, LA PAGE REGARDE SES CARTES (`RANGEMENT.verifie`) : les formes
   viennent du pire contenu des scenarios, le contenu reel peut etre plus long
   ou bien plus court. Une carte qui deborde, ou qui garde deux demi-rangees
   vides, voit sa forme ecartee et la page se range de nouveau (trois passes au
   plus). L ecart dure tant que le contenu de la carte garde la meme forme
   (`sig` : son HTML, chiffres confondus, a 16 caracteres pres). */
let BENTO = null;               // dernier rangement : { cle, page }
/* nom de carte → { sig, formes: Set("3x5") vues trop vides, minH: Map(largeur →
   demi-rangees) mesuree quand la carte debordait } */
const ECARTEES = new Map();
const SANS_RELEVE_HTML = /<div class="vizb">\s*<div class="note[^"]*">[^<]*<\/div>\s*<\/div>/;
const carteDe = (el) => GROUPS.flatMap((g) => g.s).find((s) => slug(s.n) === el.dataset.carte);

/* LES SIX DERNIERS RANGEMENTS SONT GARDES DANS LE NAVIGATEUR : au rechargement,
   ou en revenant a une largeur deja vue (fenetre agrandie puis remise), le
   rangement est repris tel quel au lieu d etre recalcule. */
const GARDES = "homelab.bento";
const gardes = () => { try { const v = JSON.parse(localStorage.getItem(GARDES) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const retrouver = (cle) => gardes().find((x) => x.cle === cle) || null;
const garder = (b) => { try { localStorage.setItem(GARDES, JSON.stringify([b, ...gardes().filter((x) => x.cle !== b.cle)].slice(0, 6))); } catch (e) { /* stockage refuse */ } };

/* UNE LARGEUR NOUVELLE SE CALCULE EN ARRIERE-PLAN (Web Worker : rangement.js,
   charge une seconde fois). Sur grand ecran, ce calcul figeait la page pres
   d une seconde apres un redimensionnement. En attendant (`PROVISOIRE`),
   l ancien rangement reste affiche, etire a la nouvelle largeur ; a la reponse,
   les cartes glissent a leur nouvelle place. Sans travailleur, comme avant. */
let TRAVAIL = null, ATTENDU = null, PROVISOIRE = false;

/* LES LARGEURS VOISINES SONT PREPAREES D AVANCE (17/10/2026 :
   « regle la latence au premier passage a une largeur nouvelle »). Une fois la
   page affichee, le travailleur range, une par une et en arriere-plan, les
   largeurs que la fenetre peut prendre : une par tranche de 4 px de module
   (le rangement change a peine a l interieur d une tranche), les plus proches
   d abord. Sur ecran tactile, seulement l autre orientation. Au
   redimensionnement, la page prend le rangement tout pret de sa tranche, sans
   rien calculer. Une demande reelle passe toujours avant. Tout est a refaire
   quand l etat des cartes change (alerte, releve absent, forme ecartee).
   `PRETS` : tranche (« 16:22|etat stable des cartes ») → { page, excl }.
   ⚠️ LES FORMES ECARTEES (`excl`) NE SONT PAS DANS LA CLE : la page en apprend
   en route (une carte qui deborde a une largeur jamais vue), et chacune rendait
   toutes les largeurs preparees introuvables. Un rangement prepare AVANT une
   forme ecartee est donc affiche quand meme, sur-le-champ, pendant que le
   travailleur calcule la version qui en tient compte. */
const PRETS = new Map();
let A_PREPARER = [], PREPARE_EN_COURS = false, PREPARE_ETAT = null, PREPARE_BASE = null, PREPARE_GROUPES = null, PREPARE_EXCL = null, PREPARE_PERMIS = false;
let AFFICHEE = null;   // le rangement a l ecran (`BENTO.page`, ou un rangement prepare en attendant)
const trancheDe = (W, etat) => { const { P, m } = RANGEMENT.grille(W); return P + ":" + Math.round(m / 4) + "|" + etat; };
// les largeurs a preparer, des plus proches de `W` aux plus lointaines
function cibles(W, ecart) {
  const sw = screen.availWidth || innerWidth, sh = screen.availHeight || innerHeight;
  if (TACTILE()) return [Math.min(sw, sh) - ecart, Math.max(sw, sh) - ecart].filter((w) => Math.abs(w - W) > 8);
  // au moins 1 920 px : un ecran qui ne dit pas sa taille (ou une fenetre sur un second ecran)
  const max = Math.max(innerWidth, sw, screen.width || 0, 1920) - ecart, l = [];
  for (const P of [4, 8, 12, 16, 20, 24]) {
    const de = P === 4 ? 300 : P * 92 - 12, a = P === 24 ? 2400 : (P + 4) * 92 - 13;  // la plage ou il y a P modules
    for (let w = de; w <= Math.min(a, max); w += 4 * P) l.push(w);                   // 4 px de module par pas
  }
  return l.filter((w) => Math.abs(w - W) > 2).sort((x, y) => Math.abs(x - W) - Math.abs(y - W));
}
// `etat` : l etat stable des cartes ; `excl` : leurs formes ecartees (a refaire si elles changent)
function preparer(etat, excl, groupes, W, ecart, permis) {
  // les coins font partie de l etat a preparer : leur hauteur depend de l en-tete
  const e = etat + "|" + permis + "|" + TETE_H;
  if (!TRAVAIL || (e === PREPARE_ETAT && excl === PREPARE_EXCL)) return;
  PREPARE_ETAT = e; PREPARE_BASE = etat; PREPARE_EXCL = excl; PREPARE_PERMIS = permis;
  PREPARE_GROUPES = groupes.map((g) => ({ id: g.id, cartes: g.cartes.map(({ s, ...c }) => c) }));
  A_PREPARER = cibles(W, ecart);
  preparerSuite();
}
function preparerSuite() {
  while (TRAVAIL && !PREPARE_EN_COURS && !ATTENDU && A_PREPARER.length) {
    // la meme cle que `bento()` : l etat des cartes, et les coins de CETTE largeur
    const W = A_PREPARER.shift(), coins = coinsPour(W, PREPARE_PERMIS);
    const tranche = trancheDe(W, PREPARE_BASE) + marqueCoins(coins), p = PRETS.get(tranche);
    if (p && p.excl === PREPARE_EXCL) continue;
    PREPARE_EN_COURS = true;
    TRAVAIL.postMessage({ prepare: true, tranche, excl: PREPARE_EXCL, W, coins, groupes: PREPARE_GROUPES });
  }
}
const pret = (tranche, page, excl) => {
  PRETS.delete(tranche); PRETS.set(tranche, { page, excl });
  if (PRETS.size > 150) PRETS.delete(PRETS.keys().next().value);
};

try {
  TRAVAIL = new Worker("rangement.js");
  TRAVAIL.onmessage = (e) => {
    const d = e.data;
    if (d.prepare) { pret(d.tranche, d.page, d.excl); PREPARE_EN_COURS = false; return preparerSuite(); }
    if (d.cle !== ATTENDU) return preparerSuite();   // une demande plus recente est partie
    ATTENDU = null;
    BENTO = { cle: d.cle, W: d.W, page: d.page };
    pret(d.tranche, d.page, d.excl);
    garder(BENTO);
    dessineGroupes();
    preparerSuite();
  };
  TRAVAIL.onerror = () => { TRAVAIL = null; ATTENDU = null; };
} catch (e) { TRAVAIL = null; }

/* OPTION A, LES COINS (17/10/2026, pour un ecran de 2 560 px). Sur tres
   grand ecran, l en-tete (barre, raccourcis, recherche, menu) laissait deux
   grands vides de part et d autre. Il se resserre a la place laissee entre
   les coins (1 134 px a 2 560 px, la barre reste sur une ligne) et les deux
   premiers groupes se logent dans les coins, A SA HAUTEUR (`rangerPage`,
   option `coins`). L en-tete occupe toute la hauteur de leurs cartes : ses
   ecarts s allongent d autant (`mesureTete`). Ni en
   Compact, ni avec un groupe choisi, ni sous 2 100 px de large : les coins y
   sont trop etroits (mesure : a 1 920 px, 320 px pour des groupes qui en
   demandent 580 de haut).
   `TETE_H` : la hauteur de l en-tete resserre (haut de la barre -> bas du
   menu), mesuree au dessin (`mesureTete`) ; elle decide de la hauteur des
   coins. ⚠️ LES CARTES DES COINS COMMENCENT AU HAUT DE LA BARRE
   (17/10/2026) : leur titre, `TITRE` px (25 de titre, 7 de marge, base.css), est
   au-dessus, et la rangee des coins doit couvrir titre + en-tete. Une section
   de H demi-rangees fait `56 H + 20` px, titre compris. */
// `px` : la place minimale de l en-tete, ou la barre tient sur une ligne
const COINS = { min: 2100, px: 1100 }, TITRE = 32;
let TETE_H = 425;
/* `Hplancher` : la hauteur de l en-tete aux ecarts resserres au minimum
   (`ECARTS_MIN`), si les coins ne peuvent pas atteindre `Hmin`. */
const ECARTS_TETE = [18, 16, 18], ECARTS_MIN = [8, 6, 8];   // sous la barre, les raccourcis, la recherche (base.css)
const hauteurCoins = (h) => Math.max(1, Math.ceil((h + TITRE - 20) / (RANGEMENT.RANGEE + RANGEMENT.ESPACE)));
const coinsPour = (W, permis) => permis && W >= COINS.min
  ? { px: COINS.px, Hmin: hauteurCoins(TETE_H),
      Hplancher: hauteurCoins(TETE_H - ECARTS_TETE.reduce((s, x) => s + x, 0) + ECARTS_MIN.reduce((s, x) => s + x, 0)) } : null;
// dans les cles des rangements : la version du code de rangement, et les coins
const marqueCoins = (co) => "|" + RANGEMENT.VERSION + "|c" + (co ? co.Hmin + "-" + co.Hplancher : 0);

/* `asynchrone` : un nouveau rangement peut attendre le travailleur (passe de
   verification, redimensionnement). Une LARGEUR qui a change part aussi au
   travailleur, quel que soit l appelant : le tour de 2 s passe souvent avant
   l observateur de taille. Seul le tout premier rangement se calcule sur-le-champ. */
/* LE CONTENU DES CARTES NE CHANGE QU AVEC LES DONNEES (nouveau tour) ou la
   periode d un graphe : un rangement refait entre deux tours (largeur, groupe
   choisi, passe de verification) reprend celui du tour au lieu de le recalculer.
   `sig` : sa forme, chiffres confondus, a 16 caracteres pres (voir `ECARTEES`). */
let CORPS = { d: null, per: "", m: new Map() };
function corpsDu(s) {
  const per = JSON.stringify(PERIODES);
  if (CORPS.d !== DATA || CORPS.per !== per) CORPS = { d: DATA, per, m: new Map() };
  let c = CORPS.m.get(s.n);
  if (!c) { c = corpsCarte(s, DATA); c.sig = c.body.replace(/\d+/g, "0").length >> 4; CORPS.m.set(s.n, c); }
  return c;
}

function bento(racine, visibles, asynchrone) {
  const usage = RANGEMENT.usage();
  const groupes = visibles.map((i) => ({ id: i, cartes: RANGEMENT.ordonne(GROUPS[i].s.map((s) => {
    // le contenu, calcule une fois : il juge la carte ici, et se dessine plus bas
    const c = corpsDu(s), sig = c.sig;
    let e = ECARTEES.get(s.n);
    if (!e || e.sig !== sig) ECARTEES.set(s.n, e = { sig, formes: new Set(), minH: new Map() });
    return { id: s.n, s, t: tailleDe(s, SANS_RELEVE_HTML.test(c.body)), niveau: s.niveau,
             alerte: !!etatCarte(s, DATA), exclues: e.formes, minH: e.minH };
  }), usage) }));
  const W = racine.clientWidth;
  // l etat STABLE des cartes (ce qui decide du rangement, sauf la largeur et les
  // formes ecartees en route) et leurs formes ecartees
  const etat = JSON.stringify(groupes.map((g) => [g.id, g.cartes.map((c) => [c.id, c.t.h[1], c.t.formes, c.alerte])]));
  const excl = JSON.stringify(groupes.map((g) => g.cartes.map((c) => [[...c.exclues].join(), [...c.minH].join()])));
  // les coins : la vraie page, en bento, tous ses groupes affiches
  const permis = racine.id === "groups" && !COMPACT && visibles.length === GROUPS.length;
  /* ⚠️ LA HAUTEUR DE L EN-TETE, MESUREE AVANT DE RANGER : estimee, elle pouvait
     rendre les coins impossibles des le premier rangement ; sans coins a
     l ecran, `mesureTete` ne passait jamais, et ils ne revenaient plus
     (« Relevés absents », 17/10/2026). */
  if (permis && W >= COINS.min) TETE_H = hauteurTete() || TETE_H;
  const coins = coinsPour(W, permis);
  const cle = W + "|" + etat + "|" + excl + marqueCoins(coins), tranche = trancheDe(W, etat) + marqueCoins(coins), pr = PRETS.get(tranche);
  PROVISOIRE = false;
  if (!BENTO || BENTO.cle !== cle) {
    /* ⚠️ UN RANGEMENT REPRIS (garde dans le navigateur, ou prepare pour une
       largeur VOISINE de la meme tranche) doit avoir des coins quand on en
       demande, et aucun sinon : a quelques pixels pres les coins tiennent ou
       non, et un rangement sans coins garde sous une cle qui en demande les
       faisait disparaitre pour de bon (mode sain, 17/10/2026). Sinon, on
       recalcule ; un rangement calcule a l instant, lui, fait foi. */
    const conforme = (page) => !!(page && page.rangees[0] && page.rangees[0].coins) === !!coins;
    const g0 = retrouver(cle);
    const garde = (g0 && conforme(g0.page) && g0) || (pr && pr.excl === excl && conforme(pr.page) && { cle, W, page: pr.page });
    if (garde) { BENTO = garde; garder(BENTO); }
    else if (TRAVAIL && BENTO && (asynchrone || ATTENDU === cle || BENTO.W !== W)) {
      // en attendant le travailleur (sans les definitions des cartes : des
      // fonctions ne passent pas au travailleur)
      if (ATTENDU !== cle) {
        ATTENDU = cle;
        TRAVAIL.postMessage({ cle, W, tranche, excl, coins, groupes: groupes.map((g) => ({ id: g.id, cartes: g.cartes.map(({ s, ...c }) => c) })) });
      }
      PROVISOIRE = true;
    } else { BENTO = { cle, W, page: RANGEMENT.rangerPage(groupes, W, { coins }) }; pret(tranche, BENTO.page, excl); garder(BENTO); }
  }
  // a l ecran : le rangement retenu ; en attendant le travailleur, le rangement
  // prepare pour cette largeur s il existe (d avant une forme ecartee), sinon
  // l ancien, etire
  AFFICHEE = PROVISOIRE && pr ? pr.page : BENTO.page;
  // une fois la page rangee, les largeurs voisines se preparent en arriere-plan
  if (!PROVISOIRE && racine.id === "groups") preparer(etat, excl, groupes, W, innerWidth - W, permis);
  /* La grille de la vraie page est posee au dessin (`dessineGroupes`), pas
     ici : posee avant, elle remettait en page l ancien rangement sur la
     nouvelle grille (11 a 28 ms) avant que l animation lise ou sont les cartes,
     et l animation partait de cette disposition que personne n a vue. */
  if (racine.id !== "groups") racine.style.setProperty("--P", AFFICHEE.P);
  /* Dans l ordre de la grille : rangee, puis gauche a droite (clavier, lecteurs
     d ecran). Une rangee de groupes est une ligne `flex` : chaque groupe
     grandit en proportion de ses modules, `RANGEMENT.ENTRE` (28 px) entre deux
     groupes (le `gap` de #groups), et `.saut` passe a la rangee suivante. Ses
     cartes gardent leur grille de modules, `ESPACE` (12 px) entre elles. */
  const G = RANGEMENT.ESPACE;
  return AFFICHEE.rangees.map((r, ri) => r.groupes.map((gp) => {
    // la place de l en-tete, entre les deux coins : vide, l en-tete est au-dessus (voir `mesureTete`)
    if (gp.id === "tete") return `<div class="tete-place" data-g="tete" aria-hidden="true" style="flex:${gp.w} 0 ${(gp.w - 1) * G}px"></div>`;
    const g = GROUPS[gp.id], par = new Map(groupes.find((x) => x.id === gp.id).cartes.map((c) => [c.id, c]));
    return `<section class="sec" data-g="${gp.id}" style="flex:${gp.w} 0 ${(gp.w - 1) * G}px"><h2>${svg(ICONS[g.i])}${esc(g.n)}</h2>`
      + `<div class="grid" style="grid-template-columns:repeat(${gp.w},minmax(0,1fr));grid-template-rows:repeat(${gp.H},${RANGEMENT.RANGEE}px)">`
      + [...gp.places].sort((a, b) => a.y - b.y || a.x - b.x).map((p) => {
          const c = par.get(p.id);
          return card(c.s, DATA, { ...p, haute: p.h > c.t.h[1] }, corpsDu(c.s));
        }).join("")
      + `</div></section>`;
  }).join("") + `<i class="saut" data-g="saut-${ri}" aria-hidden="true"></i>`).join("");
}

/* L ANIMATION DU RANGEMENT (17/10/2026, etape 6). Quand la disposition change
   VRAIMENT (une alerte fait monter une carte, un releve manque, un groupe est
   choisi, la fenetre change de largeur : demande), les cartes glissent
   vers leur nouvelle place et prennent leur nouvelle taille, au lieu de sauter.
   METHODE « FLIP » (`envol`) : on note ou est chaque carte a l ecran, on dessine
   la nouvelle page, puis chaque carte repart de son ancienne place et de son
   ancienne taille vers la nouvelle, par une transformation que la carte
   graphique anime seule, sans recalculer la page a chaque image.
   ⚠️ PAS DE `document.startViewTransition` (essaye le 17/10) : la photographie
   de toute la page, cartes floutees comprises, figeait 130 a 140 ms au depart de
   chaque animation (la saccade constatee), et une animation interrompue
   (fenetre qu on continue d agrandir) repartait d un saut.
   ⚠️ JAMAIS a chaque tour (toutes les 2 s) : la disposition est comparee a celle
   deja a l ecran (`PLACES_VUES`), et seule une difference anime. Ni au premier
   dessin, ni si le systeme demande moins d animations, ni dans un onglet cache.
   Une animation interrompue repart de la ou la carte se trouve vraiment. */
let PLACES_VUES = null;
const placesDe = (page) => JSON.stringify(page.rangees.map((r) => r.groupes.map((g) =>
  [g.id, g.x, g.w, g.places.map((p) => [p.id, p.x, p.y, p.w, p.h])])));
let VOL = [];   // les animations du dernier changement de disposition
const enVol = () => VOL.some((a) => a.playState === "running");
const arrete = () => { VOL.forEach((a) => a.cancel()); VOL = []; };
// les cartes et les titres de groupe, chacun sous un repere stable
const reperes = (racine) => [...racine.querySelectorAll(".sec>h2, .grid>.card[data-carte]")]
  .map((el) => [el.tagName === "H2" ? "#" + el.parentElement.dataset.g : el.dataset.carte, el]);
// ou chacun se trouve A L ECRAN, en plein trajet compris
const posees = (racine) => new Map(reperes(racine).map(([k, el]) => [k, el.getBoundingClientRect()]));

/* Chaque carte part de `avant` (sa place a l ecran avant le dessin) vers celle
   qu elle a maintenant. Sa taille change par une mise a l echelle ; pour que son
   contenu ne s etire pas, ses enfants recoivent l echelle INVERSE, autour du
   coin de la carte : le texte garde sa taille et sa place, et se decouvre a
   mesure que la carte s agrandit (`overflow: clip` pendant le trajet). Les
   titres de groupe glissent seulement. Une carte apparue se fond (`marque`). */
function envol(racine, avant) {
  const trajet = { duration: 450, easing: "cubic-bezier(.22,.8,.24,1)" };
  // toutes les lectures d abord, puis toutes les animations : une seule mise en page
  const vols = [];
  for (const [k, el] of reperes(racine)) {
    const a = avant.get(k), b = el.getBoundingClientRect();
    if (!a || !b.width || !b.height) continue;
    const dx = a.left - b.left, dy = a.top - b.top;
    const sx = el.tagName === "H2" ? 1 : a.width / b.width, sy = el.tagName === "H2" ? 1 : a.height / b.height;
    const taille = Math.abs(sx - 1) > .004 || Math.abs(sy - 1) > .004;
    if (!taille && Math.abs(dx) < .5 && Math.abs(dy) < .5) continue;
    vols.push({ el, b, dx, dy, sx, sy, enfants: taille ? [...el.children].map((c) => [c, c.getBoundingClientRect()]) : null });
  }
  for (const { el, b, dx, dy, sx, sy, enfants } of vols) {
    if (!enfants) { VOL.push(el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], trajet)); continue; }
    // autour du centre (l origine par defaut des transformations), ecrit pour que
    // le coin haut-gauche parte de l ancien coin
    const cx = b.width / 2, cy = b.height / 2;
    VOL.push(el.animate([
      { transform: `translate(${dx - cx}px,${dy - cy}px) scale(${sx},${sy}) translate(${cx}px,${cy}px)` },
      { transform: `translate(${-cx}px,${-cy}px) scale(1,1) translate(${cx}px,${cy}px)` }], trajet));
    VOL.push(el.animate([{ overflow: "clip" }, { overflow: "clip" }], trajet));
    // 1 / echelle n avance pas en ligne droite : 12 etapes, sur la meme courbe de
    // temps que la carte, pour rester accordees a elle
    for (const [c, r] of enfants) {
      const ox = r.left - b.left + r.width / 2, oy = r.top - b.top + r.height / 2, kf = [];
      for (let i = 0; i <= 12; i++) {
        const e = i / 12;
        kf.push({ transform: `translate(${-ox}px,${-oy}px) scale(${1 / (sx + (1 - sx) * e)},${1 / (sy + (1 - sy) * e)}) translate(${ox}px,${oy}px)` });
      }
      VOL.push(c.animate(kf, trajet));
    }
  }
}

function dessineGroupes(passe = 0, anime = true, largeur = false) {
  /* Mode atelier (`?atelier`, voir atelier.js) : il dessine les cartes a sa
     facon, chacune seule et a toutes ses tailles. */
  if (window.ATELIER?.actif) return window.ATELIER.dessine(DATA);
  const racine = document.getElementById("groups");
  filters();   // avant le dessin : « Compact » et le groupe choisi en dependent
  const compact = COMPACT;
  const a = [...document.querySelectorAll("#filters button:not(#menu):not(#compact)")].findIndex(b => b.classList.contains("on"));
  const vis = a > 0 ? [a - 1] : GROUPS.map((_, i) => i);
  const html = compact ? tuiles(racine, vis) : bento(racine, vis, largeur || passe > 0);
  // la disposition qu on va dessiner, comparee a celle a l ecran (`PLACES_VUES`)
  const places = compact ? TUILES_VUES : placesDe(AFFICHEE);
  const peindre = () => {
    racine.classList.toggle("bento", !compact);
    racine.classList.toggle("compact", compact);
    if (!compact) racine.style.setProperty("--P", AFFICHEE.P);
    // les coins : l en-tete se resserre et les groupes remontent (voir `COINS`)
    const coins = !compact && !!(AFFICHEE && AFFICHEE.rangees[0] && AFFICHEE.rangees[0].coins);
    racine.parentElement.classList.toggle("coins", coins);
    fondre(racine, html);
    // l en-tete n a pas la hauteur prevue : les coins se rangent de nouveau
    if (coins && mesureTete(racine) && passe < 3) return dessineGroupes(passe + 1, false);
    document.querySelectorAll(".card.clic").forEach(c => c.onclick = ev => {
      if (ev.target.closest("a")) return;
      if (c.dataset.pop === "conteneurs") popConteneurs();
      else if (c.dataset.pop === "acces") popAcces();
      else if (c.dataset.pop === "journal") popJournal();
      else { document.getElementById("dlg").classList.remove("large"); popUpdates(); }
    });
    // des tuiles toutes pareilles : rien a verifier apres coup
    if (compact) { PLACES_VUES = places; return; }
    // les passes de verification se dessinent sans animation, DANS celle-ci ;
    // pas sur un rangement provisoire, etire en attendant le travailleur ; ni
    // pendant un trajet : les cartes transformees fausseraient la mesure (le
    // tour suivant verifiera)
    if (!PROVISOIRE && !enVol() && ecarte(racine) && passe < 3) return dessineGroupes(passe + 1, false);
    PLACES_VUES = placesDe(AFFICHEE);
  };
  const change = passe === 0 && PLACES_VUES !== null && places !== PLACES_VUES;
  if (!change) return peindre();
  // les trajets en cours visaient l ancienne disposition : on part de la ou ils en sont
  const avant = anime && !doux() && !document.hidden && typeof Element.prototype.animate === "function" ? posees(racine) : null;
  arrete();
  peindre();
  if (avant) envol(racine, avant);
}

/* LE MODE COMPACT, RANGE PAR GROUPE (17/10/2026, option A retenue) : voir
   `RANGEMENT.rangerTuiles`. Seules les cartes qui menent quelque part (un lien
   ou une fenetre) deviennent des tuiles, dans l ordre du bento (alerte,
   niveau, usage). Une rangee pleine couvre la largeur : ses groupes grandissent
   en proportion de leurs colonnes (`flex`), et leurs tuiles suivent la fenetre
   sans recalcul. Une rangee courte prend la largeur de tuile de la rangee
   pleine la plus serree, centree. `.saut` passe a la rangee suivante.
   ⚠️ AUCUNE CASE VIDE (demande, 17/10) : quand un groupe n a pas de
   quoi remplir toutes ses lignes, la ligne incomplete s elargit pour couvrir
   la largeur, et c est la PREMIERE : les tuiles en tete (alerte, niveau,
   usage) sont les plus grandes, comme dans le bento. Tuiles jusqu a 220 px
   (160 laissait des rangees courtes, centrees entre deux vides). */
const TUILE = { min: 100, max: 220 };
let TUILES_VUES = null;
/* Largeur des titres de groupe, icone comprise : le groupe garde au moins
   autant de colonnes. MESUREE dans la page, une fois par titre (et par regle
   d ecran : le telephone grossit les textes) : un titre est en capitales,
   espacees de 0,22 em, ce qu une mesure au canevas ignorait (titres coupes au
   telephone). Tous les titres manquants d un coup : une seule mise en page. */
const TITRES = new Map();
function mesureTitres(racine, ids) {
  const tel = matchMedia("(max-width: 600px)").matches, cle = (i) => i + "|" + tel;
  const manque = ids.filter((i) => !TITRES.has(cle(i)));
  if (manque.length) {
    const s = document.createElement("section");
    s.className = "sec";
    s.style.cssText = "position:absolute;visibility:hidden;left:0;top:0";
    s.innerHTML = manque.map((i) => `<h2 style="width:max-content;white-space:nowrap;margin:0">${svg(ICONS[GROUPS[i].i])}${esc(GROUPS[i].n)}</h2>`).join("");
    racine.append(s);
    [...s.children].forEach((h, k) => TITRES.set(cle(manque[k]), Math.ceil(h.getBoundingClientRect().width)));
    s.remove();
  }
  return (i) => TITRES.get(cle(i));
}
function tuiles(racine, visibles) {
  const W = racine.clientWidth, G = RANGEMENT.ESPACE, usage = RANGEMENT.usage();
  const Cmax = Math.max(1, Math.floor((W + G) / (TUILE.min + G))), tC = (W - (Cmax - 1) * G) / Cmax;
  const titre = mesureTitres(racine, visibles);
  const groupes = visibles.map((i) => {
    const cartes = RANGEMENT.ordonne(GROUPS[i].s.filter((s) => s.u || s.x || s.pop)
      .map((s) => ({ id: s.n, s, niveau: s.niveau, alerte: !!etatCarte(s, DATA) })), usage);
    return { id: i, n: cartes.length, cartes, kmin: Math.ceil((titre(i) + G) / (tC + G)) };
  });
  // un seul groupe (filtre) : sa rangee peut rester courte, centree, plutot qu une tuile de toute la largeur
  const { rangs } = RANGEMENT.rangerTuiles(groupes.map(({ cartes, ...g }) => g), W,
    { tmin: TUILE.min, tmax: TUILE.max, court: visibles.length === 1 });
  // l ordre des tuiles compte aussi : une alerte qui fait monter une tuile anime
  TUILES_VUES = "tuiles:" + JSON.stringify(rangs.map((r) => [r.C, r.L, r.court,
    r.groupes.map(({ id, k }) => [id, k, groupes.find((g) => g.id === id).cartes.map((c) => c.id)])]));
  /* La tuile de la rangee pleine la plus serree, que reprennent les rangees
     courtes : `ENTRE` entre ses groupes, `G` entre ses tuiles. */
  const ref = rangs.filter((r) => !r.court).sort((a, b) => b.C - a.C)[0];
  const pleine = ref ? `((100% - ${(ref.C - ref.groupes.length) * G + (ref.groupes.length - 1) * RANGEMENT.ENTRE}px) / ${ref.C})` : null;
  const par = new Map(groupes.map((g) => [g.id, g]));
  return rangs.map((r, ri) => r.groupes.map(({ id, k }) => {
    const g = GROUPS[id];
    const flex = !r.court ? `${k} 0 ${(k - 1) * G}px`
      : pleine ? `0 0 calc(${pleine} * ${k} + ${(k - 1) * G}px)`
      : `0 0 ${k * TUILE.max + (k - 1) * G}px`;
    // `r` tuiles en tete, elargies a toute la ligne ; les autres a `k` par ligne (--k)
    const cs = par.get(id).cartes, reste = cs.length % k;
    const large = reste && { style: `flex-basis:calc((100% - ${(reste - 1) * G}px) / ${reste} - .5px)` };
    return `<section class="sec" data-g="${id}" style="flex:${flex}"><h2>${svg(ICONS[g.i])}${esc(g.n)}</h2>`
      + `<div class="grid" style="--k:${k}">`
      + cs.map((c, i) => card(c.s, DATA, i < reste ? large : null, corpsDu(c.s))).join("") + `</div></section>`;
  }).join("") + `<i class="saut" data-g="saut-${ri}" aria-hidden="true"></i>`).join("");
}

/* L en-tete dans sa place, entre les coins (bento/base.css, « Option A ») :
   - sa LARGEUR, celle de la place (`--tete-l`) ;
   - sa hauteur NATURELLE (barre, raccourcis, recherche, menu et leurs ecarts
     de base), qui decide de la hauteur des coins (`TETE_H`) ;
   - l ALLONGEMENT de ses trois ecarts (`--tete-ecart`) pour qu il couvre toute
     la hauteur des cartes des coins : la barre en haut de leurs cartes, le bas
     du menu au bas de leurs cartes (demande) ;
   - la REMONTEE des groupes (`--tete-h`) : la rangee des coins commence au
     titre de ses groupes, au-dessus de la barre.
   Calcule d apres les tailles des elements, pas leur position : le menu est
   COLLANT, sa place a l ecran change au defilement. Vrai si la hauteur des
   coins doit changer. */
/* La hauteur naturelle de l en-tete : barre, bandeau des donnees figees (0
   quand il ne s affiche pas), raccourcis, recherche, menu, et leurs ecarts de
   base. Hauteurs exactes (fractionnaires) : arrondies au pixel, les coins se
   decalaient d un pixel. Les memes avec ou sans coins (la barre tient sur une
   ligne des deux facons). 0 si un element manque. */
function hauteurTete() {
  const el = [document.getElementById("bar"), document.querySelector("main > .racc"), document.querySelector("main > .search"), document.getElementById("nav")];
  if (el.some((e) => !e)) return 0;
  // le bandeau, s il s affiche : sa hauteur et 8 px au-dessus (base.css)
  const fige = document.getElementById("fige"), haut = (e) => e.getBoundingClientRect().height;
  const bandeau = fige && fige.offsetHeight ? haut(fige) + 8 : 0;
  return el.reduce((s, e) => s + haut(e), 0) + bandeau + ECARTS_TETE.reduce((s, x) => s + x, 0);
}
function mesureTete(racine) {
  const main = racine.parentElement, place = racine.querySelector(".tete-place");
  const h = hauteurTete(), nav = document.getElementById("nav");
  if (!place || !h) return false;
  main.style.setProperty("--tete-l", Math.floor(place.getBoundingClientRect().width) + "px");
  const H = AFFICHEE.rangees[0].H, cartes = H * RANGEMENT.RANGEE + (H - 1) * RANGEMENT.ESPACE;
  // allonges, ou resserres (sans descendre sous `ECARTS_MIN`) si les coins sont moins hauts
  const ecart = Math.max(Math.max(...ECARTS_MIN.map((x, i) => x - ECARTS_TETE[i])), (cartes - h) / ECARTS_TETE.length);
  main.style.setProperty("--tete-ecart", ecart.toFixed(2) + "px");
  const navBas = parseFloat(getComputedStyle(nav).marginBottom) || 0;
  main.style.setProperty("--tete-h", (h + ecart * ECARTS_TETE.length + navBas + TITRE).toFixed(2) + "px");
  const avant = hauteurCoins(TETE_H);
  TETE_H = h;
  return hauteurCoins(h) !== avant;
}

/* Regarde les cartes posees dans `racine` et retient ce qui ne va pas : une
   carte trop VIDE ecarte sa forme ; une carte qui DEBORDE retient, pour sa
   largeur, la hauteur qu il lui faut (ce qui manque, en demi-rangees). Vrai si
   quelque chose a change : il faut alors ranger de nouveau. */
function ecarte(racine) {
  let change = false;
  for (const el of racine.querySelectorAll(".grid > .card")) {
    const v = RANGEMENT.verifie(el);
    const s = v && carteDe(el), e = s && ECARTEES.get(s.n);
    if (!e) continue;
    const w = +el.dataset.l, h = +el.dataset.h, px = Math.round(el.getBoundingClientRect().width);
    if (v.etat === "vide") {
      if (!e.formes.has(w + "x" + h)) { e.formes.add(w + "x" + h); change = true; }
    } else {
      // retenu par largeur en PIXELS : 4 modules ne font pas 4 modules partout
      const n = h + Math.ceil(v.manque / (RANGEMENT.RANGEE + RANGEMENT.ESPACE));
      if ((e.minH.get(px) || 0) < n) { e.minH.set(px, n); change = true; }
    }
  }
  return change;
}

/* La largeur change (fenetre, rotation) : la page se range de nouveau. La
   hauteur, elle, change a chaque rangement : on ne regarde que la largeur. */
{
  const racine = document.getElementById("groups");
  let largeurVue = 0, attente = 0;
  const surLargeur = () => {
    if (racine.clientWidth === largeurVue) return;
    largeurVue = racine.clientWidth;
    clearTimeout(attente);
    // anime aussi : les cartes glissent vers leur place a la nouvelle largeur
    attente = setTimeout(() => { if (BENTO || COMPACT) dessineGroupes(0, true, true); }, 100);
  };
  new ResizeObserver(surLargeur).observe(racine);
  // l evenement de la fenetre en plus : l observateur ne se declenche pas
  // toujours (onglet en arriere-plan, fenetre emulee)
  addEventListener("resize", surLargeur, { passive: true });
  /* L USAGE : une ouverture = un clic qui ouvre le service ou la fenetre d une
     carte (voir `RANGEMENT.usage`). Compte dans le navigateur seulement. */
  racine.addEventListener("click", (e) => {
    const c = e.target.closest(".card");
    if (!c || !(c.matches("a[href]") || c.classList.contains("clic") || e.target.closest("a, [data-lien]"))) return;
    const s = carteDe(c);
    if (s) RANGEMENT.noter(s.n);
  }, true);
}

async function refresh() {
  if (document.querySelector("dialog[open]")) return;   // ne pas redessiner sous une fenetre ouverte
  /* ⚠️ ONGLET CACHE : RIEN NE PART. Un onglet oublie en arriere-plan tirait
     autant qu un onglet regarde. Le retour au premier plan relance un tour
     aussitot (voir `visibilitychange`). */
  if (document.hidden) return;
  /* Un seul tour a la fois : un NAS lent ne doit pas voir s empiler les
     requetes de tours qui se chevauchent. */
  if (TOUR) return;
  TOUR = true;
  try {
    const [d, l, h, k, sm] = await Promise.all([
      lire("data.json", CADENCE["data.json"]),
      lireOuRien("live.json", CADENCE["live.json"]),
      lireOuRien("history.json", CADENCE["history.json"]),
      lireOuRien("containers.json", CADENCE["containers.json"]),
      lireOuRien("smart.json", CADENCE["smart.json"])
    ]);
    d.hist = h; d.cont = k; d.smart = sm;
    d.fin = await histFin();
    const sy = await lireSysteme();
    fusionSysteme(d, sy);
    /* Horodatages des autres fichiers, ranges dans `d` AVANT `demo()` : un
       scenario peut ainsi les vieillir, et la demonstration les resout. */
    d.tLive = l ? l.t : undefined;
    if (sy) { d.tSys = sy.t; d.problemes = sy.problemes; }
    // live.json prime sur data.json : ses valeurs sont rafraichies toutes les 2 s.
    if (l) {
      // chaque objet verifie avant d y ecrire : un objet absent de data.json
      // (possible en demonstration) arretait tout le tour (17/10/2026)
      if (d.nas) { d.nas.cpu = l.cpu; d.nas.ram = l.ram; d.nas.net = l.net; }
      if (l.qbit && d.qbit) { d.qbit.dl = l.qbit.dl; d.qbit.ul = l.qbit.ul; }
      if (d.jellyfin) d.jellyfin.now = l.jnow;
    }
    DATA = demo(d);
    DERNIER_OK = Date.now();
    fondre(document.getElementById("fige"), figeHtml(DATA));
    fondre(document.getElementById("bar"), bar(DATA));
    fondre(document.getElementById("soucis"), pastilles(DATA));
    majAlertes();
    placeEtSerre();
    /* Les raccourcis d abord (18/10/2026) : leur hauteur entre dans celle de
       l en-tete, qui decide de celle des coins. Arrives apres le premier
       dessin, ils faisaient ranger la page une seconde fois. */
    await RACCOURCIS;
    dessineGroupes();
    sante();
    suisAncre();
  } catch (e) {
    console.error("data.json illisible", e);
    /* Rien de neuf a dessiner : on garde la page, mais on dit depuis quand. */
    fondre(document.getElementById("fige"), figeHtml(null));
    if (DATA.nas) fondre(document.getElementById("bar"), bar(DATA));
  } finally { TOUR = false; }
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { refresh(); checkVersion(); }
});
const RACCOURCIS = load(); refresh();

// Champ de recherche vide et actif a CHAQUE affichage.
// `pageshow` est le seul evenement declenche aussi au retour arriere, quand le
// navigateur restaure la page depuis son cache sans rejouer le chargement.
addEventListener("pageshow", () => {
  const q = document.querySelector(".search input");
  if (!q) return;
  q.value = "";
  if (!document.querySelector("dialog[open]")) q.focus({ preventScroll: true });
});
setInterval(refresh, 2000);
/* l horloge bat chaque seconde, independamment des donnees */
setInterval(() => {
  const b = document.querySelector(".clock b");
  if (b) b.textContent = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}, 1000);

/* ---- Rechargement automatique quand le code ou les styles changent ---- */
let VER = null;
async function checkVersion() {
  // Pas de rechargement pendant une saisie : ce serait pénible en pleine édition.
  if (document.getElementById("dlg")?.open) return;
  try {
    const sig = [];
    for (const f of ["app.js", "cartes.js", "style.css", "fond.css"]) {
      const r = await fetch(f, { method: "HEAD", cache: "no-store" });
      /* ⚠️ Une reponse en erreur (502 pendant un redemarrage de nginx) n a pas
         d ETag : la signature changeait et la page se rechargeait sur une page
         d erreur, sans jamais en revenir. On attend le tour suivant. */
      if (!r.ok) return;
      sig.push(r.headers.get("etag") || r.headers.get("last-modified") || "");
    }
    const now = sig.join("|");
    if (VER && now !== VER) return location.reload();
    VER = now;
  } catch (e) { /* hors ligne : on réessaiera au prochain tour */ }
}
/* Toutes les 60 s, et plus chaque seconde (08/10/2026) : trois requetes par
   seconde, soit 10 800 par heure, plus que toutes les donnees reunies, pour un
   deploiement qui arrive au plus quelques fois par jour. */
setInterval(() => { if (!document.hidden) checkVersion(); }, 60000);
checkVersion();

/* ============ Transitions douces (17/08/2026) ============
   La page se redessinait entièrement toutes les 2 s. Chaque nœud étant neuf à
   chaque tour, aucune transition CSS ne pouvait s'appliquer : les valeurs
   sautaient. `fondre` écrit le nouveau rendu DANS l'arbre existant et ne touche
   que ce qui a changé, donc les éléments survivent et peuvent être animés.
   Effets de bord bienvenus : le survol, le défilement et le focus ne sautent
   plus, les icônes ne sont plus réinsérées 30 fois par minute, et le navigateur
   ne reconstruit plus 23 cartes pour en changer trois chiffres. */

function fondre(cible, html) {
  const neuf = document.createElement("div");
  neuf.innerHTML = html;
  fusionne(cible, neuf);
}

/* PAR REPERE (17/10/2026, bento) : des freres qui portent tous un repere
   (`data-carte` pour une carte, `data-g` pour un groupe) se retrouvent par lui,
   et non par leur rang. Quand le rangement change l ordre des cartes, chacune
   garde son element et son contenu, qui est seulement deplace. Par rang, la 4e
   carte devenait une autre : tout son contenu etait reecrit, en fondu, au
   moment meme ou les cartes glissent. */
const repere = (n) => n.nodeType === 1 ? n.getAttribute("data-carte") ?? n.getAttribute("data-g") : null;
function parRepere(anc, A, B) {
  const ks = B.map(repere);
  if (!B.length || ks.includes(null) || A.some((a) => repere(a) === null) || new Set(ks).size !== ks.length) return false;
  const vus = new Map(A.map((a) => [a.nodeName + "|" + repere(a), a])), gardes = new Set();
  B.forEach((b, i) => {
    const a = vus.get(b.nodeName + "|" + ks[i]);
    let n = b;
    if (a && !gardes.has(a)) {
      // meme empreinte (`data-v`, voir `card`) : meme contenu, rien a comparer dessous
      const meme = b.hasAttribute("data-v") && a.getAttribute("data-v") === b.getAttribute("data-v");
      gardes.add(a); majAttributs(a, b); if (!meme) fusionne(a, b); n = a;
    } else marque(b);
    if (anc.childNodes[i] !== n) anc.insertBefore(n, anc.childNodes[i] || null);
  });
  A.forEach((a) => { if (!gardes.has(a)) a.remove(); });
  return true;
}

function fusionne(anc, nou) {
  const A = [...anc.childNodes], B = [...nou.childNodes];
  if (parRepere(anc, A, B)) return;
  // Structure différente : on remplace ce niveau-là, sans descendre plus bas.
  if (A.length !== B.length) { B.forEach(marque); anc.replaceChildren(...B); return; }
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = B[i];
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { marque(b); a.replaceWith(b); continue; }
    if (a.nodeType === 3) { majTexte(a, b.nodeValue); continue; }
    if (a.nodeType !== 1) continue;
    majAttributs(a, b);
    fusionne(a, b);
  }
}

function majAttributs(a, b) {
  for (const at of [...b.attributes]) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
  for (const at of [...a.attributes]) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
}

// Un élément qui vient d'apparaître se fond au lieu de surgir.
function marque(n) {
  if (n.nodeType !== 1 || doux()) return;
  n.classList.add("neuf");
  n.addEventListener("animationend", () => n.classList.remove("neuf"), { once: true });
}

function doux() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }

/* ---- Glissement des nombres ------------------------------------------------
   Un texte qui ne change que par ses chiffres (« 43 % », « 1,79 », « 2,1 / 12
   cœurs ») est interpolé sur 420 ms au lieu de sauter. Tout autre changement de
   texte reçoit un fondu très bref, pour que l'œil le remarque sans sursaut. */
const MOTIF = /-?\d+(?:[.,]\d+)?/g;
const ENCOURS = new Map();
const JOKER = String.fromCharCode(1);

function chiffres(s) { return (s.match(MOTIF) || []).map(x => parseFloat(x.replace(",", "."))); }
function squelette(s) { return s.replace(MOTIF, JOKER); }

// On recopie la forme du nombre visé : décimales, virgule, zéro de tête (09:05).
function calque(modele, v) {
  const dec = (modele.split(/[.,]/)[1] || "").length;
  const ent = modele.replace("-", "").split(/[.,]/)[0];
  let s = Math.abs(v).toFixed(dec);
  if (ent.length > 1 && ent.startsWith("0")) {
    const m = s.split(".");
    s = m[0].padStart(ent.length, "0") + (m[1] ? "." + m[1] : "");
  }
  if (modele.includes(",")) s = s.replace(".", ",");
  return (v < 0 ? "-" : "") + s;
}

function glisse(noeud, avant, apres) {
  const a = chiffres(avant), b = chiffres(apres), cibles = apres.match(MOTIF);
  const t0 = performance.now();
  const pas = (t) => {
    const p = Math.min(1, (t - t0) / 420);
    const k = 1 - Math.pow(1 - p, 3);
    let i = 0;
    noeud.nodeValue = apres.replace(MOTIF, () => { const j = i++; return p >= 1 ? cibles[j] : calque(cibles[j], a[j] + (b[j] - a[j]) * k); });
    if (p < 1) ENCOURS.set(noeud, requestAnimationFrame(pas)); else ENCOURS.delete(noeud);
  };
  const en = ENCOURS.get(noeud); if (en) cancelAnimationFrame(en);
  ENCOURS.set(noeud, requestAnimationFrame(pas));
}

function majTexte(noeud, apres) {
  const avant = noeud.nodeValue;
  if (avant === apres) return;
  const a = chiffres(avant), b = chiffres(apres);
  if (!doux() && a.length && a.length === b.length && squelette(avant) === squelette(apres)) { glisse(noeud, avant, apres); return; }
  noeud.nodeValue = apres;
  const p = noeud.parentElement;
  if (p && !doux()) { p.classList.remove("chg"); void p.offsetWidth; p.classList.add("chg"); }
}


/* ============ Fenêtres modales : croix, verrou de fond (22/08/2026) ============
   Un observateur plutôt que trois appels : le contenu des fenêtres est réécrit
   en cours de route (paintUpd se rappelle après une mise à jour) et le bouton
   serait perdu à chaque redessin. Toute fenêtre future en hérite sans rien
   avoir à faire. */
const CROIX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

/* FOCUS D OUVERTURE SUR LA FENETRE ELLE-MEME (06/10/2026). `showModal()` le
   donnait au premier element cliquable (un groupe depliable, la zone defilante)
   et, le focus venant du champ de recherche, le navigateur l entourait d un
   contour a chaque ouverture. La fenetre le prend a sa place, sans contour
   (`dialog.dlg:focus-visible`), et Tab entre ensuite dans son contenu.
   ⚠️ Pose UNE FOIS sur l element : toutes les fenetres passent par lui. Une
   fenetre qui veut son champ (l ajout de raccourci) le focalise APRES, ce qui
   reste valable. */
{
  const d = dlg(), ouvre = d.showModal;
  d.showModal = function () { ouvre.call(this); this.focus({ preventScroll: true }); };
}

new MutationObserver(() => {
  const d = dlg();
  // La croix est posée en DERNIER : premier enfant, elle recevait le focus
  // d'ouverture et le navigateur l'entourait d'un liseré clair.
  if (!d.firstElementChild || d.querySelector(":scope > .dlg-x")) return;
  d.insertAdjacentHTML("beforeend",
    `<button type="button" class="dlg-x" aria-label="Fermer">${CROIX}</button>`);
  d.querySelector(".dlg-x").onclick = () => d.close("no");
}).observe(dlg(), { childList: true, attributes: true, attributeFilter: ["open"] });

/* ============ La recherche accepte les adresses (23/08/2026) ============
   Saisir « media.exemple.fr » ou « nas.local:3000 » lançait une
   recherche Google. Le formulaire reconnaît désormais une adresse et y navigue
   directement.

   Heuristique volontairement prudente : un schéma explicite, une IP, localhost,
   ou un domaine sans espace dont le dernier segment fait au moins deux lettres
   et n'est pas une extension de fichier courante. Tout le reste part chez
   Google, « node.js » et « config.yml » compris. */
const RE_SCHEMA = /^[a-z][a-z0-9+.-]*:\/\//i;
const RE_LOCAL = /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:[/?#]|$)/i;
const RE_DOMAINE = /^[\w-]+(?:\.[\w-]+)*\.([a-z]{2,})(?::\d+)?(?:[/?#]|$)/i;
const RE_FICHIER = /^(?:js|ts|py|md|txt|json|css|html?|php|log|conf|ya?ml|env|xml|csv|sql|zip|pdf|png|jpe?g|gif|svg|exe|bak)$/i;

function adresseSaisie(q) {
  q = (q || "").trim();
  if (!q || /\s/.test(q)) return null;
  if (RE_SCHEMA.test(q)) return /^https?:\/\//i.test(q) ? q : null;   // ni javascript: ni file:
  if (RE_LOCAL.test(q)) return "http://" + q;   // le LAN n'est pas en HTTPS
  const m = q.match(RE_DOMAINE);
  return m && !RE_FICHIER.test(m[1]) ? "https://" + q : null;
}

/* ============ Le moteur de recherche au choix (17/10/2026) ============
   Demande : choisir le moteur, Google restant celui par defaut. Le
   choix est propre a l appareil (`homelab.moteur`, comme « Compact »).
   ⚠️ LE FORMULAIRE NE PART QUE VERS GOOGLE : la politique de securite de la
   page (`form-action https://www.google.com`, nginx) bloquerait tout autre
   moteur. Pour eux, la page ouvre l adresse de recherche elle-meme
   (`location.href`), ce que `form-action` ne regarde pas : rien a changer
   cote nginx, et sans JavaScript la recherche part toujours chez Google.
   LOGOS : Simple Icons (CC0), dessins `d` sur 24 x 24 (Bing pris dans la
   version 9.0.0, Microsoft les a retires depuis), dans la couleur de chaque
   marque ; Qwant (#282B2F) et Ecosia (#008009) eclaircies, illisibles sur le
   fond sombre. En ligne : la page ne charge aucune image d ailleurs (CSP). */
const MOTEURS = [
  { id: "google", n: "Google", url: "https://www.google.com/search?q=", c: "#4285F4",
    d: "M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" },
  { id: "duckduckgo", n: "DuckDuckGo", url: "https://duckduckgo.com/?q=", c: "#DE5833",
    d: "M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 23C5.925 23 1 18.074 1 12S5.926 1 12 1s11 4.925 11 11-4.925 11-11 11zm10.219-11c0 4.805-3.317 8.833-7.786 9.925-.27-.521-.53-1.017-.749-1.438.645.249 1.93.718 2.208.615.376-.144.282-3.149-.14-3.245-.338-.075-1.632.837-2.141 1.209l.034.156c.078.397.144.993.03 1.247-.001.004-.002.01-.004.013a.218.218 0 0 1-.068.088c-.284.188-1.081.284-1.503.188a.516.516 0 0 1-.064-.02c-.694.396-2.01 1.109-2.25.971-.329-.188-.377-2.676-.329-3.288.035-.46 1.653.286 2.442.679.174-.163.602-.272.98-.31-.57-1.389-.99-2.977-.733-4.105 0 .002.002.002.002.002.356.248 2.73 1.05 3.91 1.027 1.18-.024 3.114-.743 2.903-1.323-.212-.58-2.135.51-4.142.324-1.486-.138-1.748-.804-1.42-1.29.414-.611 1.168.116 2.411-.256 1.245-.371 2.987-1.035 3.632-1.397 1.494-.833-.625-1.177-1.125-.947-.474.22-2.123.637-2.889.82.428-1.516-.603-4.149-1.757-5.3-.376-.376-.951-.612-1.603-.736-.25-.344-.654-.671-1.225-.977a5.772 5.772 0 0 0-3.595-.584l-.024.004-.034.004.004.002c-.148.028-.237.08-.357.098.148.016.705.276 1.057.418-.174.068-.412.108-.596.184a.828.828 0 0 0-.204.056c-.173.08-.303.375-.3.515.84-.086 2.082-.026 2.991.246-.644.09-1.235.258-1.661.482-.016.008-.03.018-.048.028-.054.02-.106.042-.152.066-1.367.72-1.971 2.405-1.611 4.424.323 1.824 1.665 8.088 2.29 11.064-3.973-1.4-6.822-5.186-6.822-9.639C1.781 6.356 6.356 1.781 12 1.781S22.219 6.356 22.219 12zM9.095 9.581a.758.758 0 1 0 0 1.516.758.758 0 0 0 0-1.516zm.338.702a.196.196 0 1 1 0-.392.196.196 0 0 1 0 .392zm4.724-1.043a.65.65 0 1 0 0 1.299.65.65 0 0 0 0-1.3zm.29.601a.168.168 0 1 1 0-.336.168.168 0 0 1 0 .336zM9.313 8.146s-.571-.26-1.125.09c-.554.348-.534.704-.534.704s-.294-.656.49-.978c.786-.32 1.17.184 1.17.184zm5.236-.052s-.41-.234-.73-.23c-.654.008-.831.296-.831.296s.11-.688.945-.55a.84.84 0 0 1 .616.484z" },
  { id: "qwant", n: "Qwant", url: "https://www.qwant.com/?q=", c: "#E8EAED",
    d: "M9.313 5.163c4.289 0 7.766 2.589 7.766 7.616 0 4.759-3.072 7.301-7.003 7.59 1.87 1.142 4.693 1.143 6.45-.348l.547.297-.615 3.074-.226.285c-3.118.918-5.947-.099-7.921-3.329-3.816-.37-6.765-2.9-6.765-7.568 0-5.03 3.477-7.617 7.766-7.617zm0 13.88c2.756 0 4.08-2.804 4.08-6.264 0-3.46-1.148-6.264-4.08-6.264-2.85 0-4.08 2.805-4.08 6.264 0 3.46 1.182 6.264 4.08 6.264zm8.719-16.319L18.734 0h.263l.703 2.725 2.754.71v.248l-2.754.71-.703 2.725h-.263l-.702-2.725-2.696-.695V3.42z" },
  { id: "bing", n: "Bing", url: "https://www.bing.com/search?q=", c: "#258FFA",
    d: "M20.176 15.406a6.48 6.48 0 01-1.736 4.414c1.338-1.47.803-3.869-1.003-4.635-.862-.305-2.488-.85-3.367-1.158a1.834 1.834 0 01-.932-.818c-.381-.975-1.163-2.968-1.548-3.948-.095-.285-.31-.625-.265-.938.046-.598.724-1.003 1.276-.754l3.682 1.888c.621.292 1.305.692 1.796 1.172a6.486 6.486 0 012.097 4.777zm-1.44 1.888c-.264-1.194-1.135-1.744-2.216-2.028-1.527.902-4.853 2.878-6.952 4.13-1.103.68-2.13 1.35-2.919 1.242a2.866 2.866 0 01-2.77-2.325c-.012-.048-.008-.03-.001.01a6.4 6.4 0 00.947 2.653 6.498 6.498 0 005.486 3.022c1.908.062 3.536-1.153 5.099-2.096.292-.188.804-.496 1.332-.831l1.423-1.51c.553-.577.764-1.426.571-2.267zm-12.04 2.97c.422 0 .822-.1 1.173-.29.355-.215.964-.579 1.7-1.018L9.57 4.502c0-.99-.497-1.864-1.257-2.382-.08-.059-2.91-1.901-2.99-1.956-.605-.432-1.523.045-1.5.797v14.887l.417 2.36a2.488 2.488 0 002.455 2.056z" },
  { id: "ecosia", n: "Ecosia", url: "https://www.ecosia.org/search?q=", c: "#3DB34A",
    d: "M15.198 6.818H8.786v10.48h6.412v-3.342h-3.98v-1.262H13.8V11.42h-2.584v-1.261h3.981zM11.972.06A12.003 12.003 0 0 0 0 12.064a12.003 12.003 0 0 0 10.083 11.848c.068-1.277.196-2.723.434-3.652v-.014c0-.005 0-.007-.01-.012 0-.005-.01-.007-.012-.009 0-.002-.01-.002-.014-.002h-.356c-2.307 0-5.943-.333-6.916-3.45-1.458-4.642 2.025-6.314 3.484-4.97 0 .004.012.008.019.008.01 0 .014 0 .02-.005.01-.005.013-.009.015-.016v-.021c-.322-.945-2.148-6.867 2.64-8.496 4.08-1.369 8.07 1.491 7.461 5.265v.017c0 .007.01.012.012.014 0 .002.012.005.016.005 0 0 .012-.002.016-.005.298-.246 1.603-1.186 2.919-.148 1.247.982.844 3.73-1.627 5.003-.01.002-.014.007-.02.014v.023c0 .01.01.014.015.02.01.004.016.004.023.001 1.596-.239 4.316 1.193 2.11 4.375-1.447 2.1-4.71 2.365-6.168 2.365h-1.071s-.01 0-.012.002c0 .002-.01.005-.012.007 0 .002 0 .005-.01.009v.012c-.021.751.331 2.304.693 3.688A12.003 12.003 0 0 0 24 12.063 12.003 12.003 0 0 0 11.997.06a12.003 12.003 0 0 0-.03 0z" },
  { id: "brave", n: "Brave", url: "https://search.brave.com/search?q=", c: "#FB542B",
    d: "M15.68 0l2.096 2.38s1.84-.512 2.709.358c.868.87 1.584 1.638 1.584 1.638l-.562 1.381.715 2.047s-2.104 7.98-2.35 8.955c-.486 1.919-.818 2.66-2.198 3.633-1.38.972-3.884 2.66-4.293 2.916-.409.256-.92.692-1.38.692-.46 0-.97-.436-1.38-.692a185.796 185.796 0 01-4.293-2.916c-1.38-.973-1.712-1.714-2.197-3.633-.247-.975-2.351-8.955-2.351-8.955l.715-2.047-.562-1.381s.716-.768 1.585-1.638c.868-.87 2.708-.358 2.708-.358L8.321 0h7.36zm-3.679 14.936c-.14 0-1.038.317-1.758.69-.72.373-1.242.637-1.409.742-.167.104-.065.301.087.409.152.107 2.194 1.69 2.393 1.866.198.175.489.464.687.464.198 0 .49-.29.688-.464.198-.175 2.24-1.759 2.392-1.866.152-.108.254-.305.087-.41-.167-.104-.689-.368-1.41-.741-.72-.373-1.617-.69-1.757-.69zm0-11.278s-.409.001-1.022.206-1.278.46-1.584.46c-.307 0-2.581-.434-2.581-.434S4.119 7.152 4.119 7.849c0 .697.339.881.68 1.243l2.02 2.149c.192.203.59.511.356 1.066-.235.555-.58 1.26-.196 1.977.384.716 1.042 1.194 1.464 1.115.421-.08 1.412-.598 1.776-.834.364-.237 1.518-1.19 1.518-1.554 0-.365-1.193-1.02-1.413-1.168-.22-.15-1.226-.725-1.247-.95-.02-.227-.012-.293.284-.851.297-.559.831-1.304.742-1.8-.089-.495-.95-.753-1.565-.986-.615-.232-1.799-.671-1.947-.74-.148-.068-.11-.133.339-.175.448-.043 1.719-.212 2.292-.052.573.16 1.552.403 1.632.532.079.13.149.134.067.579-.081.445-.5 2.581-.541 2.96-.04.38-.12.63.288.724.409.094 1.097.256 1.333.256s.924-.162 1.333-.256c.408-.093.329-.344.288-.723-.04-.38-.46-2.516-.541-2.961-.082-.445-.012-.45.067-.579.08-.129 1.059-.372 1.632-.532.573-.16 1.845.009 2.292.052.449.042.487.107.339.175-.148.069-1.332.508-1.947.74-.615.233-1.476.49-1.565.986-.09.496.445 1.241.742 1.8.297.558.304.624.284.85-.02.226-1.026.802-1.247.95-.22.15-1.413.804-1.413 1.169 0 .364 1.154 1.317 1.518 1.554.364.236 1.355.755 1.776.834.422.079 1.08-.4 1.464-1.115.384-.716.039-1.422-.195-1.977-.235-.555.163-.863.355-1.066l2.02-2.149c.341-.362.68-.546.68-1.243 0-.697-2.695-3.96-2.695-3.96s-2.274.436-2.58.436c-.307 0-.972-.256-1.585-.461-.613-.205-1.022-.206-1.022-.206z" },
];
let MOTEUR = MOTEURS[0];
try { MOTEUR = MOTEURS.find((m) => m.id === localStorage.getItem("homelab.moteur")) || MOTEURS[0]; } catch (e) { /* stockage refuse : Google */ }

document.querySelector("form.search")?.addEventListener("submit", (e) => {
  const q = (e.target.querySelector('input[name="q"]')?.value || "").trim();
  const url = adresseSaisie(q);
  if (url) { e.preventDefault(); location.href = url; return; }   // une adresse : on y va
  if (MOTEUR.id === "google" || !q) return;                        // Google : le formulaire part tel quel
  e.preventDefault();
  location.href = MOTEUR.url + encodeURIComponent(q);
});

/* Le bouton du moteur, au bout de la barre, et sa liste (posee sur la page,
   comme les propositions : la barre a son propre flou). Clavier : Entree ou
   Espace l ouvre, fleches pour choisir, Echap pour fermer. */
{
  const form = document.querySelector("form.search"), champ = form?.querySelector('input[name="q"]');
  if (form && champ) {
    const CHEVRON = '<path d="M6 9l6 6 6-6"/>', COCHE = '<path d="M5 12l5 5L20 7"/>';
    const logo = (m) => `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="${m.c}" d="${m.d}"/></svg>`;
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "moteur";
    bouton.setAttribute("aria-haspopup", "listbox");
    bouton.setAttribute("aria-expanded", "false");
    bouton.setAttribute("aria-controls", "moteurs");
    form.append(bouton);
    const liste = document.createElement("ul");
    liste.id = "moteurs";
    liste.hidden = true;
    liste.setAttribute("role", "listbox");
    liste.setAttribute("aria-label", "Moteur de recherche");
    document.body.append(liste);
    let actif = 0;
    const pose = () => {
      bouton.innerHTML = logo(MOTEUR) + `<span>${esc(MOTEUR.n)}</span>` + svg(CHEVRON, 2);
      bouton.setAttribute("aria-label", "Moteur de recherche : " + MOTEUR.n);
      champ.placeholder = "Rechercher sur " + MOTEUR.n + "…";
      champ.setAttribute("aria-label", "Rechercher sur " + MOTEUR.n);
    };
    // un titre, puis chaque moteur : son logo sur une pastille, son nom, la coche du moteur choisi
    const dessine = () => {
      liste.innerHTML = `<li class="titre" role="presentation">Moteur de recherche</li>`
        + MOTEURS.map((m, i) => `<li id="mot-${m.id}" role="option" data-i="${i}" aria-selected="${m === MOTEUR}"${i === actif ? ' class="actif"' : ""}>`
        + `<span class="pastille">${logo(m)}</span><span class="nom">${esc(m.n)}</span>${m === MOTEUR ? svg(COCHE, 2.4) : ""}</li>`).join("");
      liste.setAttribute("aria-activedescendant", "mot-" + MOTEURS[actif].id);
    };
    const ferme = (rendre) => {
      liste.hidden = true;
      bouton.setAttribute("aria-expanded", "false");
      if (rendre) bouton.focus();
    };
    // sous la barre, son bord droit sur celui du bouton ; un court fondu a l ouverture
    const ouvre = () => {
      actif = MOTEURS.indexOf(MOTEUR);
      dessine();
      const r = form.getBoundingClientRect(), b = bouton.getBoundingClientRect();
      liste.hidden = false;
      Object.assign(liste.style, { top: r.bottom + scrollY + 8 + "px", left: Math.max(8, b.right + scrollX - liste.offsetWidth) + "px" });
      bouton.setAttribute("aria-expanded", "true");
      liste.focus();
      if (!doux()) liste.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: 140, easing: "ease-out" });
    };
    const choisit = (i) => {
      MOTEUR = MOTEURS[i];
      try { localStorage.setItem("homelab.moteur", MOTEUR.id); } catch (e) { /* stockage refuse : pour cette visite seulement */ }
      pose();
      ferme(false);
      champ.focus();
    };
    liste.tabIndex = -1;
    pose();
    bouton.addEventListener("click", () => (liste.hidden ? ouvre() : ferme(true)));
    liste.addEventListener("pointerdown", (e) => e.preventDefault());
    liste.addEventListener("click", (e) => {
      const li = e.target.closest("li[data-i]");
      if (li) choisit(+li.dataset.i);
    });
    liste.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        actif = (actif + (e.key === "ArrowDown" ? 1 : MOTEURS.length - 1)) % MOTEURS.length;
        dessine();
      } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choisit(actif); }
      else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); ferme(true); }
    });
    document.addEventListener("pointerdown", (e) => {
      if (!liste.hidden && !liste.contains(e.target) && !bouton.contains(e.target)) ferme(false);
    });
    addEventListener("resize", () => { if (!liste.hidden) ferme(false); }, { passive: true });
  }
}

/* ============ Propositions sous la recherche (17/10/2026) ============
   Pendant la saisie, comme Google : tes SERVICES et tes RACCOURCIS dont le nom
   (un de ses mots) ou l adresse commence comme le texte, puis les suggestions
   de Google. Choix retenu : pas d historique des recherches.
   ⚠️ GOOGLE PASSE PAR LE NAS : la page ne parle qu a son propre serveur (CSP
   `connect-src 'self'`) ; `/suggestions` (nginx) relaie la saisie SANS aucun
   en-tete du navigateur. Sans ce relais (demonstration publique), seules les
   propositions locales s affichent, et la page cesse de le demander.
   ⚠️ LA LISTE EST HORS DU FORMULAIRE, posee sur la page a sa hauteur : la barre
   a son propre flou, et une liste floutee DANS elle ne verrait pas la page.
   Clavier : fleches pour choisir (une suggestion Google remplit le champ),
   Entree pour ouvrir le service ou chercher, Echap pour fermer. */
{
  const form = document.querySelector("form.search"), champ = form?.querySelector('input[name="q"]');
  if (champ) {
    const liste = document.createElement("ul");
    liste.id = "propositions";
    liste.hidden = true;
    liste.setAttribute("role", "listbox");
    liste.setAttribute("aria-label", "Propositions");
    document.body.append(liste);
    for (const [k, v] of [["role", "combobox"], ["aria-autocomplete", "list"], ["aria-controls", "propositions"], ["aria-expanded", "false"]])
      champ.setAttribute(k, v);
    const plat = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const LOUPE = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>';
    const CACHE = new Map();
    let tape = "", items = [], actif = -1, ctrl = null, delai = 0, relais = true;

    // le nom commence comme le texte (3), un de ses mots (2), ou l adresse (1)
    const locaux = (q) => {
      const p = plat(q), vus = new Set();
      const note = (n, url) => plat(n).startsWith(p) ? 3 : plat(n).split(/[\s.-]+/).some((m) => m.startsWith(p)) ? 2 : plat(hst(url)).startsWith(p) ? 1 : 0;
      return [...GROUPS.flatMap((g) => g.s).filter((s) => s.u || s.x).map((s) => ({ type: "service", n: s.n, url: s.u || s.x, ic: s.ic })),
              ...rd().filter((r) => /^https?:\/\//i.test(r.url || "")).map((r) => ({ type: "raccourci", n: r.name || hst(r.url), url: r.url }))]
        .map((x) => ({ ...x, note: note(x.n, x.url) }))
        .filter((x) => x.note && !vus.has(x.url) && vus.add(x.url))
        .sort((a, b) => b.note - a.note || a.n.localeCompare(b.n, "fr")).slice(0, 4);
    };
    const icone = (x) => x.type === "google" ? svg(LOUPE, 2)
      : x.type === "service" && x.ic ? `<img src="icons/${x.ic.includes(".") ? x.ic : x.ic + ".svg"}" alt="">`
      : ICONES && ICONES[hst(x.url)] ? `<img src="icons/sites/${ICONES[hst(x.url)]}" alt="">`
      : `<span class="pa">${esc(x.n.slice(0, 2).toUpperCase())}</span>`;
    // comme Google : ce qui a ete tape en clair, la suite en gras
    const texte = (x) => x.type !== "google" || !plat(x.n).startsWith(plat(tape)) ? esc(x.n)
      : esc(x.n.slice(0, tape.length)) + "<b>" + esc(x.n.slice(tape.length)) + "</b>";
    const place = () => {
      const r = form.getBoundingClientRect();
      Object.assign(liste.style, { left: r.left + scrollX + "px", top: r.bottom + scrollY + 8 + "px", width: r.width + "px" });
    };
    const dessine = () => {
      liste.innerHTML = items.map((x, i) =>
        (x.type === "google" && i && items[i - 1].type !== "google" ? '<li class="sep" role="presentation"></li>' : "")
        + `<li id="prop-${i}" role="option" aria-selected="${i === actif}" data-i="${i}"><span class="pi">${icone(x)}</span>`
        + `<span class="pt">${texte(x)}</span>`
        + (x.type !== "google" ? `<span class="pk">${x.type === "service" ? "service" : esc(hst(x.url))}</span>` : "") + `</li>`).join("");
      const ouvert = items.length > 0 && document.activeElement === champ;
      liste.hidden = !ouvert;
      champ.setAttribute("aria-expanded", String(ouvert));
      if (actif >= 0) champ.setAttribute("aria-activedescendant", "prop-" + actif);
      else champ.removeAttribute("aria-activedescendant");
      if (ouvert) place();
    };
    const cherche = (q) => {
      tape = q; actif = -1;
      const k = plat(q.trim());
      items = k ? [...locaux(q.trim()), ...(CACHE.get(k) || [])].slice(0, 11) : [];
      dessine();
      clearTimeout(delai);
      if (!k || !relais || CACHE.has(k)) return;
      delai = setTimeout(async () => {
        ctrl?.abort();
        ctrl = new AbortController();
        try {
          const r = await fetch("suggestions?q=" + encodeURIComponent(q.trim()), { signal: ctrl.signal });
          if (r.status === 404) { relais = false; return; }   // pas de relais ici : on ne le redemande plus
          const j = r.ok ? await r.json() : null;
          CACHE.set(k, (Array.isArray(j) && Array.isArray(j[1]) ? j[1] : [])
            .filter((s) => typeof s === "string" && s.trim()).slice(0, 7).map((n) => ({ type: "google", n })));
          if (champ.value === q) cherche(q);   // toujours la meme saisie : on complete la liste
        } catch (e) { /* relais coupe ou saisie plus recente : les propositions locales restent */ }
      }, 120);
    };
    const choisit = (x) => {
      if (x.type !== "google") { location.href = x.url; return; }
      champ.value = x.n;
      form.requestSubmit();   // passe par le test des adresses, puis Google
    };
    champ.addEventListener("input", () => cherche(champ.value));
    champ.addEventListener("focus", () => { if (champ.value.trim()) cherche(champ.value); });
    champ.addEventListener("blur", () => { liste.hidden = true; champ.setAttribute("aria-expanded", "false"); });
    champ.addEventListener("keydown", (e) => {
      if (liste.hidden || !items.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = items.length;
        actif = e.key === "ArrowDown" ? (actif + 1 >= n ? -1 : actif + 1) : (actif <= -1 ? n - 1 : actif - 1);
        champ.value = actif >= 0 && items[actif].type === "google" ? items[actif].n : tape;
        dessine();
      } else if (e.key === "Escape") {
        e.preventDefault();
        champ.value = tape; items = []; actif = -1; dessine();
      } else if (e.key === "Enter" && actif >= 0 && items[actif].type !== "google") {
        e.preventDefault();
        choisit(items[actif]);
      }
    });
    // le champ garde le focus pendant le clic (sinon la liste se ferme avant)
    liste.addEventListener("pointerdown", (e) => e.preventDefault());
    liste.addEventListener("mousedown", (e) => e.preventDefault());
    liste.addEventListener("click", (e) => {
      const li = e.target.closest("li[data-i]");
      if (li) choisit(items[+li.dataset.i]);
    });
    addEventListener("resize", () => { if (!liste.hidden) place(); }, { passive: true });
    // un clic ailleurs ferme aussi la liste (le champ peut garder le focus)
    document.addEventListener("pointerdown", (e) => {
      if (!liste.hidden && !form.contains(e.target) && !liste.contains(e.target)) { liste.hidden = true; champ.setAttribute("aria-expanded", "false"); }
    });
  }
}

/* ============ Le fond suit l etat du NAS ============
   Aucun couplage avec le calcul interne : on relit ce que la page vient d
   afficher. `fond.css` se charge de la couleur et du fondu.

   ⚠️ TOUTES LES PASTILLES NE SE VALENT PAS. Compter n importe quel `.dot.warn`
   laissait le fond ambre en permanence : le CRM signale des leads non lus,
   Radarr des films manquants, Mises a jour des versions en attente. Ce sont des
   TACHES, vraies en continu, pas des incidents — et une alerte allumee tout le
   temps ne signale plus rien.

   ⚠️ La liste enumere les TACHES A IGNORER, et non les incidents a surveiller.
   Ce sens compte : une carte ajoutee plus tard sera comptee comme un incident
   par defaut, donc vue au pire a tort plutot que passee sous silence.

   ⚠️ La correspondance se fait sur le NOM AFFICHE de la carte. Renommer une
   carte de cette liste la ferait de nouveau compter comme un incident. */
/* TACHES : dans `site.js`, charge avant ce fichier. */

function sante() {
  /* Rien a juger avant le premier rendu : sans cette garde, le fond passait au
     bleu « tout va bien » le temps que data.json arrive. */
  if (!document.querySelector("#bar .hp")) return;
  /* Rouge : conteneur arrete OU incident grave, que la pastille de la barre
     porte toutes les deux (`crit`). */
  const grave = !!document.querySelector(".hp .line i.crit, .card .dot.crit");
  /* `.dot.incident` est pose par `card()`, avec la meme regle que les
     pastilles : taches ignorees, sauf incident declare, services muets compris. */
  const incidents = document.querySelectorAll(".card .dot.incident").length;
  const e = grave ? "crit" : incidents ? "warn" : "ok";
  if (document.body.dataset.sante === e) return;
  document.body.dataset.sante = e;
  try { localStorage.setItem("homelab.sante", e); } catch (x) { /* stockage refuse : sans gravite */ }
}
setInterval(sante, 2000);


/* ============ LECTURE AU POINTEUR ============
   Un panneau suit le pointeur et donne l instant vise et la valeur de chaque
   serie : les graphes montraient une forme sans jamais donner un chiffre.

   ⚠️ RIEN N EST AJOUTE DANS L ARBRE DESSINE. `fusionne` remplace les enfants d
   un noeud des que leur NOMBRE change, et `majAttributs` reecrit les attributs
   toutes les deux secondes : un repere injecte dans le SVG serait detruit au
   rafraichissement suivant. Le panneau et le trait de visee vivent donc dans
   `<body>`, en `position: fixed`, hors de toute zone rendue.

   ⚠️ CHAQUE GRAPHE PORTE UN RECTANGLE DE CAPTURE. Un `<path>` en `fill="none"`
   ne recoit aucun evenement, et les barres d un ruban ne couvrent que 0,74 unite
   sur 1 : sans lui, rien ne repondrait au-dessus d une courbe et l infobulle
   clignoterait entre deux barres. ⚠️ Sa transparence tient a une regle de
   `fond.css` et NON a son attribut `fill`, que `.batt rect { fill: … }`
   l emporterait et peindrait en vert par-dessus le ruban.

   ⚠️ LA CONVERSION SOURIS → DONNEES PASSE PAR `getScreenCTM()`. Les rubans sont
   etires (`preserveAspectRatio="none"`), les graphes non : une regle de trois
   sur la largeur serait juste pour les uns et fausse pour les autres. */

const TIPV = document.createElement("div"); TIPV.id = "tipv";
const TIPP = document.createElement("div"); TIPP.id = "tip";
document.body.append(TIPV, TIPP);

const hhmm = (s) => new Date(s * 1000)
  .toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/* Un formateur ne peut pas voyager dans un attribut : la carte annonce une
   unité, le lecteur la traduit. */
const fmtv = (v, u) => u === "dbt" ? Mo(v)
  : u === "°C" ? (v > 0 ? Math.round(v) + " °C" : "—")
  : Math.round(v) + " %";

/* Le repère d'un ruban reprend LA COULEUR DE LA CASE au lieu d'un voile blanc,
   qui éclaircissait pareillement une case verte et une case rouge et effaçait
   donc ce que la case dit. Superposée à elle-même, la case vise 0,83 d'opacité
   au lieu de 0,62 : la teinte ne change pas, elle s'affirme. */
const teinte = (h, a) => {
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const svgX = (svg, e) => {
  const m = svg.getScreenCTM();
  if (!m) return null;
  const p = svg.createSVGPoint();
  p.x = e.clientX; p.y = e.clientY;
  return p.matrixTransform(m.inverse()).x;
};

const cliX = (svg, x) => {
  const m = svg.getScreenCTM();
  if (!m) return null;
  const p = svg.createSVGPoint();
  p.x = x; p.y = 0;
  return p.matrixTransform(m).x;
};

function litGraphe(svg, e) {
  const ss = [...svg.querySelectorAll(".serie")];
  if (!ss.length) return null;
  const vs = ss.map(s => (s.dataset.v || "").split(",").map(Number));
  const n = Math.max(0, ...vs.map(v => v.length));
  if (n < 2) return null;
  const x = svgX(svg, e);
  if (x == null) return null;
  const x0 = +svg.dataset.x0, x1 = +svg.dataset.x1, u = svg.dataset.u || "%";
  const i = Math.max(0, Math.min(n - 1, Math.round((x - x0) / (x1 - x0) * (n - 1))));
  const t0 = +svg.dataset.t0, t1 = +svg.dataset.t1;
  /* Sur 7 jours, l heure seule ne dit pas QUEL jour : « mar. 14:00 ». */
  const ti = t0 + (t1 - t0) * i / (n - 1);
  return {
    vx: x0 + i / (n - 1) * (x1 - x0),
    titre: !(t0 && t1) ? "" : t1 - t0 > 2 * 86400
      ? new Date(ti * 1000).toLocaleDateString("fr-FR", { weekday: "short" }) + " " + hhmm(ti) : hhmm(ti),
    lignes: ss.map((s, k) => ({
      n: s.dataset.n || "",
      c: s.getAttribute("stroke") || "#8a94a6",
      /* Une série qui démarre en cours de route n'a pas de passé : « — » et
         non « 0 °C », qui se lirait comme un capteur tombé à zéro. */
      v: i < +s.dataset.k ? "—" : fmtv(vs[k][i] || 0, u)
    })).filter(r => r.n)
  };
}

const ETATB = {
  "": ["joignable", "#34c759"],
  wn: ["par intermittence", "#ffb340"],
  dn: ["injoignable", "#ff453a"],
  nd: ["sans relevé", "#8a94a6"]
};

/* SONDES EN CAUSE SOUS UNE CASE DU RUBAN KUMA (05/10/2026). Le ruban disait
   QU une sonde avait lache, jamais LAQUELLE. Le collecteur garde, sonde par
   sonde, ses periodes hors ligne ou en attente sur 7 jours (`kuma.inc`, 24 h
   avant le 18/10/2026 : la vue « 7 j » ne nommait personne) ; on
   retient celles qui chevauchent la case visee, avec le temps passe DANS la
   case. Hors ligne d abord, puis par duree.
   ⚠️ Au-dela de cinq on abrege : passe cinq, c est un groupe entier qui tombe,
   pas une sonde qu on irait chercher par son nom. */
const ENCAUSE = { 0: ["hors ligne", "#ff453a"], 2: ["en attente", "#ffb340"] };
function sondesEnCause(a, b) {
  const l = (((DATA || {}).kuma || {}).inc || [])
    /* Le groupe suit le nom : « API » seul ne dit pas de quel service il s agit. */
    .map(x => ({ n: x.g ? x.n + " · " + x.g : x.n, s: x.s, d: Math.min(b, x.t1) - Math.max(a, x.t0) }))
    .filter(x => x.d > 0);
  /* Une sonde peut avoir plusieurs periodes dans la meme case : on les cumule. */
  const m = new Map();
  for (const x of l) {
    const k = x.n + "|" + x.s;
    m.set(k, Object.assign(m.get(k) || { n: x.n, s: x.s, d: 0 }, { d: (m.get(k) || { d: 0 }).d + x.d }));
  }
  const t = [...m.values()].sort((p, q) => (p.s === 0 ? 0 : 1) - (q.s === 0 ? 0 : 1) || q.d - p.d);
  const out = t.slice(0, 5).map(x => ({ n: x.n, c: (ENCAUSE[x.s] || ENCAUSE[0])[1],
    v: (ENCAUSE[x.s] || ENCAUSE[0])[0] + " · " + duree(x.d / 60) }));
  if (t.length > 5) out.push({ n: "et " + (t.length - 5) + " autres", c: "#8a94a6", v: "" });
  return out;
}

function litBatt(svg, e) {
  const rs = [...svg.querySelectorAll("rect:not(.capt)")];
  if (!rs.length) return null;
  const x = svgX(svg, e);
  if (x == null) return null;
  const k = Math.max(0, Math.min(rs.length - 1, Math.floor(x)));
  const t0 = +svg.dataset.t0, ps = +svg.dataset.ps;
  const cl = rs[k].getAttribute("class") || "";
  const et = ETATB[cl] || ETATB[""];
  const enCause = svg.dataset.col === "kumaup" && (cl === "wn" || cl === "dn") && t0 && ps
    ? sondesEnCause(t0 + k * ps, t0 + (k + 1) * ps) : [];
  return {
    vx0: k + 0.13, vx1: k + 0.87,
    titre: t0 && ps ? hhmm(t0 + k * ps) + " → " + hhmm(t0 + (k + 1) * ps) : "",
    lignes: [{ n: et[0], c: et[1], v: "" }].concat(enCause)
  };
}

/* La description d un ratio, retiree de la ligne pour rendre sa largeur au
   trace. ⚠️ Aucun repere a positionner : contrairement aux courbes et aux
   rubans, il n y a pas d abscisse a viser, seulement un panneau a poser pres
   du pointeur. C est pourquoi `cliX` est ecarte plus bas pour ce cas, comme il
   l est pour les barres de visites : il appellerait `getScreenCTM` sur un
   element HTML, qui n en a pas. */
function litRatio(el) {
  const n = el.querySelector(".n"), v = el.querySelector("b");
  return {
    titre: (n ? n.textContent : "") + (v ? " · " + v.textContent : ""),
    lignes: [{ n: el.dataset.q || "", c: "#8a94a6", v: "" }]
  };
}

/* Segment de la barre de la fenetre Memoire : tout est deja dans ses attributs.
   Aucun repere a poser, comme pour les barres de visites. */
function litPart(el) {
  return { titre: el.dataset.t, lignes: [{ n: el.dataset.n, c: el.dataset.c, v: el.dataset.v }] };
}

/* Colonne de l histogramme des acces : qui s est connecte dans l heure, les
   plus nombreux d abord. */
function litAcc(el) {
  const b = ACC_H[+el.dataset.i];
  if (!b) return null;
  const l = [...b.g.values()].sort((p, q) => q.c - p.c);
  const lignes = l.slice(0, 6).map(x => ({ n: [x.s, x.u, x.n, x.r].join(" · "), c: x.col, v: "×" + nb(x.c) }));
  if (l.length > 6) lignes.push({ n: "et " + (l.length - 6) + " autres", c: "#8a94a6", v: "" });
  return {
    titre: hhmm(b.t0) + " → " + hhmm(b.t1),
    lignes: lignes.length ? lignes : [{ n: "Aucune connexion", c: "#8a94a6", v: "" }]
  };
}

/* Pastille de la barre : le nom de la carte, et sa raison a la couleur de son
   niveau. */
function litRaison(el) {
  const c = el.classList.contains("crit") ? "#ff453a" : el.classList.contains("inc") ? "#ff9f0a" : "#7fb2f0";
  return { titre: el.dataset.carte, lignes: [{ n: el.dataset.r || "", c, v: "" }] };
}

function litJour(el) {
  const v = +el.dataset.v, i = +el.dataset.i, n = +el.dataset.n;
  const j = new Date();
  j.setDate(j.getDate() - (n - 1 - i));
  return {
    titre: j.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
    lignes: [{ n: v + " visite" + (v > 1 ? "s" : ""), c: "#4d97ee", v: "" }]
  };
}

const cacheTip = () => { TIPP.classList.remove("on"); TIPV.classList.remove("on"); };

function montreTip(e) {
  const el = e.target && e.target.closest && e.target.closest("[data-lec]");
  if (!el) return cacheTip();
  const t = el.dataset.lec;
  const r = t === "batt" ? litBatt(el, e) : t === "jour" ? litJour(el)
    : t === "ratio" ? litRatio(el) : t === "part" ? litPart(el) : t === "acc" ? litAcc(el)
    : t === "raison" ? litRaison(el) : litGraphe(el, e);
  if (!r || !r.lignes.length) return cacheTip();

  /* ⚠️ UNE FENETRE OUVERTE PASSE AU-DESSUS DE TOUT (couche superieure du
     navigateur), quel que soit le `z-index` : l infobulle, logee dans <body>,
     resterait cachee derriere. Elle entre donc dans la fenetre le temps du
     survol, et en ressort au premier survol de la page. `position: fixed` reste
     relatif a l ecran : la fenetre n a ni transformation ni filtre. */
  const hote = el.closest("dialog[open]") || document.body;
  if (TIPP.parentNode !== hote) hote.append(TIPV, TIPP);

  TIPP.innerHTML = (r.titre ? `<b>${esc(r.titre)}</b>` : "")
    + r.lignes.map(l => `<span><i style="background:${l.c}"></i>${esc(l.n)}`
        + (l.v ? `<em>${esc(l.v)}</em>` : "") + `</span>`).join("");
  TIPP.classList.add("on");

  const b = el.getBoundingClientRect();
  /* Le panneau se replie à gauche du pointeur quand il toucherait le bord, et
     passe sous le graphe quand il n'y a pas la place au-dessus. */
  let gx = e.clientX + 14;
  if (gx + TIPP.offsetWidth > innerWidth - 8) gx = e.clientX - 14 - TIPP.offsetWidth;
  let gy = b.top - TIPP.offsetHeight - 10;
  if (gy < 8) gy = b.bottom + 10;
  TIPP.style.transform = `translate(${Math.round(Math.max(8, gx))}px, ${Math.round(gy)}px)`;

  /* Deux repères pour deux natures de graphe : un TRAIT sur une courbe, qui
     désigne un instant, un BLOC sur un ruban, où la case visée est elle-même
     l'unité de lecture et où un trait se confondrait avec la gouttière.
     Les bornes du bloc reprennent celles du rectangle dessiné, 0,13 à 0,87
     d'unité, pour éclaircir la barre et pas la gouttière voisine. */
  const cx = (t === "jour" || t === "ratio" || t === "part" || t === "acc" || t === "raison") ? null
    : cliX(el, r.vx0 != null ? r.vx0 : r.vx);
  if (cx == null) { TIPV.classList.remove("on"); return; }
  if (r.vx1 != null) {
    TIPV.style.width = Math.max(2, Math.round(cliX(el, r.vx1) - cx)) + "px";
    TIPV.style.background = teinte(r.lignes[0].c, .62);
    TIPV.classList.add("bloc");
  } else {
    TIPV.style.width = "1px";
    TIPV.style.background = "";
    TIPV.classList.remove("bloc");
  }
  TIPV.style.transform = `translate(${Math.round(cx)}px, ${Math.round(b.top)}px)`;
  TIPV.style.height = Math.round(b.height) + "px";
  TIPV.classList.add("on");
}
addEventListener("pointermove", montreTip);

/* ---- AU DOIGT (09/10/2026, etape 5) ----
   Sur iPhone il n y a pas de survol : les infobulles des courbes, rubans,
   ratios et pastilles ne s ouvraient jamais. Un toucher les ouvre la ou il
   tombe, et elles RESTENT apres le lever du doigt, jusqu au toucher suivant
   ailleurs ou au defilement.
   ⚠️ `pointerleave` n efface plus au doigt : il tombe au lever du doigt, et
   refermait l infobulle aussitot ouverte.
   ⚠️ Glisser le doigt le long d une courbe la parcourt (`touch-action: pan-y`
   dans fond.css) ; un geste vertical fait defiler la page comme avant. */
let TOUCHE = null, TOUCHE_PREC = null, AU_DOIGT = false;
addEventListener("pointerdown", (e) => {
  AU_DOIGT = e.pointerType === "touch";
  if (!AU_DOIGT) return;
  TOUCHE_PREC = TOUCHE;
  TOUCHE = e.target.closest && e.target.closest("[data-lec]");
  if (!TOUCHE) return cacheTip();
  montreTip(e);
}, true);
addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") cacheTip(); });
addEventListener("pointercancel", cacheTip);
addEventListener("scroll", cacheTip, true);


/* ALLER A UNE CARTE : les pastilles y menent au clic, les notifications du NAS
   par l adresse (`#carte=Mémoire`, voir `alerts.sh`). La carte defile au
   centre et s entoure un instant d un liseré.
   ⚠️ La correspondance se fait sur le NOM AFFICHE, comme `sante()` et comme la
   liste `TACHES`. Renommer une carte casse les trois d un coup, ce qui est au
   moins coherent ; cote NAS, la table `CARTES` d `alerts.sh` suit les memes noms.
   ⚠️ LE LISERE EST UNE ANIMATION, PAS UNE CLASSE : `fusionne` recopie l attribut
   `class` a chaque rendu et l aurait efface en deux secondes au plus.
   ⚠️ Une carte cachee par un filtre de groupe ramene le filtre sur « Tout » :
   sans cela, le defilement ne montrait rien. */
function vaACarte(nom) {
  const cible = [...document.querySelectorAll(".card")].find(c =>
    (c.querySelector(".nom") || {}).textContent === nom);
  if (!cible) return false;
  if (!cible.offsetParent) {
    const tout = document.querySelector("#filters .panneau button");
    if (tout) tout.click();
  }
  cible.scrollIntoView({ behavior: defilementDoux(), block: "center" });
  cible.animate([{ outline: "2px solid rgba(255,255,255,.85)", outlineOffset: "3px" },
                 { outline: "2px solid rgba(255,255,255,0)", outlineOffset: "3px" }],
                { duration: 2400, easing: "ease-in" });
  return true;
}

/* La carte demandee par l adresse, lue au chargement et a chaque changement
   d ancre. Tentee une seule fois, au premier rendu qui suit (voir `refresh`) :
   un nom inconnu ne doit pas faire defiler la page plus tard, au hasard d un
   rendu. L ancre est ensuite effacee, pour qu un rechargement ne ramene pas
   a la carte. */
let CARTE_DEMANDEE = null;
function lisAncre() {
  CARTE_DEMANDEE = new URLSearchParams(location.hash.slice(1)).get("carte");
  if (CARTE_DEMANDEE && document.querySelector(".card")) suisAncre();
}
function suisAncre() {
  if (!CARTE_DEMANDEE) return;
  const nom = CARTE_DEMANDEE; CARTE_DEMANDEE = null;
  history.replaceState(null, "", location.pathname + location.search);
  requestAnimationFrame(() => vaACarte(nom));
}
lisAncre();
addEventListener("hashchange", lisAncre);

/* Cliquer le nom d une carte en alerte y amene (01/09/2026).
   ⚠️ Delegue sur `document` : la barre du haut est reconstruite toutes les deux
   secondes, un ecouteur pose sur le noeud disparaitrait au premier rendu.
   ⚠️ LES PASTILLES SEULES (`.pil`, 17/10/2026) : les cartes portent elles aussi
   `data-carte` depuis le bento (leur repere, voir `card`) ; ce clic leur
   retirait leur lien et leur fenetre, plus aucune carte ne s ouvrait. */
addEventListener("click", (e) => {
  const el = e.target.closest && e.target.closest(".pil[data-carte]");
  if (!el) return;
  e.preventDefault();
  /* ⚠️ AU DOIGT, UNE PASTILLE SE TOUCHE DEUX FOIS (09/10/2026) : le premier
     toucher ouvre sa raison (l infobulle), le second mene a la carte. Sans
     survol, la raison n aurait sinon jamais ete lisible sur iPhone. */
  if (AU_DOIGT && el.matches(".pil") && TOUCHE === el && TOUCHE_PREC !== el) return;
  cacheTip(); TOUCHE = null;
  vaACarte(el.dataset.carte);
});

/* Entree ou Espace sur une carte a fenetre : ce qu un clic ferait. */
addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const c = e.target;
  if (!c.classList || !c.classList.contains("card") || !c.classList.contains("clic")) return;
  e.preventDefault();
  c.click();
});


/* ============ ALLUMER ET ETEINDRE LE POSTE ============
   Meme mecanique que le bouton des mises a jour : la page DEPOSE une demande,
   un veilleur du NAS la consomme. Elle n execute rien elle-meme.

   ⚠️ PAR DELEGATION, et c est impose par `fusionne` : les boutons vivent dans
   une carte redessinee toutes les deux secondes, un gestionnaire pose dessus
   serait detruit au rendu suivant. Le bouton des mises a jour, lui, peut se
   permettre un `onclick` direct parce qu il vit dans une fenetre modale, hors
   de l arbre rendu.

   ⚠️ Le retour d etat ne vient PAS de la reponse HTTP, qui ne dit que « fichier
   ecrit ». La preuve qu une action a abouti est que la sonde change d avis, ce
   qui prend une dizaine de secondes pour un demarrage. D ou le message d attente
   et le desarmement temporaire des deux boutons. */
/* ⚠️ L ATTENTE VIT HORS DE LA CARTE, et elle n a pas le choix. `fusionne`
   reconstruit les boutons a chaque rendu depuis `d.pc` : desactiver le bouton
   clique ne tenait pas deux secondes, le rendu suivant le recreait actif. C est
   donc la fonction de rendu qui doit connaitre l attente, et elle la lit ici.
   Meme raison pour l ancienne note ajoutee sous les boutons : elle faisait
   passer `.pcb` de deux enfants a trois, ce que `fusionne` remplace en bloc.
   L etat se dit maintenant dans le LIBELLE des boutons, dont le nombre ne
   bouge jamais. */
let pcAttente = null;   /* { action, depuis } */

/* ⚠️ SIMULATION, MODE DEMONSTRATION SEULEMENT. Une demonstration statique n a
   aucun veilleur derriere elle : la demande n est jamais consommee, l etat ne
   change jamais, et l attente tournerait jusqu a son plafond de quatre minutes.
   On fait donc repondre la machine, ce qui montre la fonction au lieu de la
   laisser paraitre cassee. Reste `null` en production. */
let pcDemo = null;

/* ⚠️ UNE ATTENTE PREND FIN QUAND LA SONDE CONFIRME, pas apres un delai devine.
   Un demarrage prend une trentaine de secondes, une extinction vingt de plus,
   et le collecteur ne repasse que deux fois par minute : tout delai fixe serait
   soit trop court, soit une immobilisation gratuite.
   ⚠️ Un plafond reste indispensable. Si l action echoue — paquet perdu, poste
   debranche — rien ne viendra jamais confirmer, et les deux boutons resteraient
   gris pour toujours. Quatre minutes couvrent largement un demarrage complet. */
const pcEnCours = (p) => {
  if (!pcAttente) return null;
  const confirme = pcAttente.action === "on" ? p.on === true : p.on === false;
  if (confirme || Date.now() - pcAttente.depuis > 240000) { pcAttente = null; return null; }
  return pcAttente.action;
};

/* ============ ALLUMER ET ETEINDRE LE POSTE ============
   Meme mecanique que le bouton des mises a jour : la page DEPOSE une demande,
   un veilleur du NAS la consomme. Elle n execute rien elle-meme.

   ⚠️ PAR DELEGATION, et c est impose par `fusionne` : les boutons vivent dans
   une carte redessinee toutes les deux secondes, un gestionnaire pose dessus
   serait detruit au rendu suivant. Le bouton des mises a jour, lui, peut se
   permettre un `onclick` direct parce qu il vit dans une fenetre modale, hors
   de l arbre rendu. */
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-pc]");
  if (!b || b.disabled || pcAttente) return;
  e.preventDefault();
  popPc(b.dataset.pc);
});

/* La confirmation passe par une fenetre de la page, et non plus par `confirm()`
   du navigateur (08/10/2026) : elle porte aussi le champ du mot de passe, et
   dit dans la meme fenetre pourquoi une demande est refusee.
   ⚠️ L ATTENTE NE COMMENCE QU UNE FOIS LA DEMANDE ECRITE. Commencee avant, un
   refus laissait les boutons en « Reveil en cours » pour rien.
   ⚠️ `fetch` ne leve pas sur un code d erreur : c est `ecritDepuis` qui lit le
   statut, la carte n en voit que le resultat. */
function popPc(action) {
  const on = action === "on";
  const d = dlg();
  d.innerHTML = `<form><h3>${on ? "Allumer le PC fixe" : "Éteindre le PC fixe"}</h3>
    <div class="sub">${on ? "Le NAS envoie le signal de réveil. Le poste démarre en une trentaine de secondes."
      : "Le NAS demande au poste de s'éteindre. Pense à enregistrer ton travail."}</div>
    ${champMdp()}
    <div class="row"><span class="sp"></span><button type="button" id="pcn">Annuler</button>
      <button type="submit" class="pri${on ? "" : " danger"}">${on ? "Allumer" : "Éteindre"}</button></div></form>`;
  d.querySelector("#pcn").addEventListener("click", () => d.close("no"));
  d.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!(await ecritDepuis(d, "data/pc.json", { action, at: Date.now() }))) return;
    d.close("ok");
    pcAttente = { action, depuis: Date.now() };
    if (DEMO) {
      /* Le delai n est pas cosmetique : sans lui le bouton changerait d etat
         dans la meme image que le clic, et on ne verrait jamais l attente que
         cette carte sert justement a montrer. */
      setTimeout(() => {
        pcDemo = { on, vu: Math.floor(Date.now() / 1000) };
        refresh();
      }, 2600);
    }
    refresh();                     /* pour que le libelle change tout de suite */
  });
  d.showModal();
  (d.querySelector("#mdpv") || d.querySelector("button.pri")).focus();
}

/* ============ MODE DEMONSTRATION ============
   Les memes fichiers que le NAS, remplis de donnees inventees. Par-dessus, un
   CALQUE ecrase quelques champs pour montrer un etat degrade sans maintenir une
   copie complete du jeu de donnees : celui du port VPN injoignable fait quarante
   octets.

   ⚠️ ACTIVE PAR LA PRESENCE D UN FICHIER, jamais par une constante ni un
   drapeau. Le NAS n a pas `fixtures/scenarios.json` : la requete echoue, `DEMO`
   reste null, le selecteur n est jamais construit et `demo()` rend son argument
   tel quel. Rien a desactiver avant un deploiement, donc rien a oublier.

   ⚠️ FUSION PROFONDE et surtout pas `Object.assign`, qui remplacerait `nas` en
   entier : un calque voulant changer la seule valeur `nas.ram` effacerait les
   dix-neuf autres mesures. Les TABLEAUX sont en revanche remplaces en bloc, et
   c est voulu — un calque qui redefinit les groupes de sondes les redefinit tous.

   ⚠️ LE SELECTEUR VIT DANS `<body>`, comme le panneau de survol et pour la meme
   raison : un `<select>` place dans une zone rendue perdrait le focus a chaque
   rafraichissement. */

let DEMO = null, DEMO_ID = null, DEMO_CALQUE = null;

const fusion = (a, b) => {
  if (b === null || typeof b !== "object" || Array.isArray(b)) return b;
  const o = (a && typeof a === "object" && !Array.isArray(a)) ? { ...a } : {};
  for (const k in b) o[k] = fusion(o[k], b[k]);
  return o;
};

/* ⚠️ HORODATAGES RELATIFS. Une fixture qui fige une date vieillit : ecrite
   aujourd hui, elle annoncerait « il y a trois ans » dans trois ans, et la
   carte Sauvegarde serait rouge a perpetuite. Les fixtures ecrivent donc un
   DECALAGE, "@-13h", "@-4j" ou "@-90min", resolu ici a chaque rendu.
   ⚠️ Le parcours ne se fait qu en mode demonstration : `DEMO` est null sur le
   NAS, `demo()` rend son argument sans rien inspecter. */
const RELATIF = /^@-(\d+(?:\.\d+)?)(min|h|j)$/;
const horodate = (o) => {
  if (typeof o === "string") {
    const m = RELATIF.exec(o);
    return m ? Math.floor(Date.now() / 1000 - parseFloat(m[1]) * { min: 60, h: 3600, j: 86400 }[m[2]]) : o;
  }
  /* Un tableau de nombres ne peut pas contenir de sentinelle : on le rend
     tel quel. Sans ce raccourci, les 1754 lignes de mesures seraient
     recopiees a chaque rendu, soit toutes les deux secondes. */
  if (Array.isArray(o)) return typeof o[0] === "number" ? o : o.map(horodate);
  if (o && typeof o === "object") {
    const r = {};
    for (const k in o) r[k] = horodate(o[k]);
    return r;
  }
  return o;
};

/* ⚠️ REBASAGE DES SERIES D HISTORIQUE. Les fixtures portent des horodatages
   absolus, figes a leur generation : une demonstration publiee en mars
   afficherait six mois plus tard des courbes vieilles d autant, avec une echelle
   horaire fausse et une carte Sauvegarde rouge a perpetuite. On decale donc
   toute la fenetre pour que son dernier point tombe sur maintenant.

   ⚠️ UN SEUL DECALAGE POUR TOUTES LES SERIES, calcule sur le point le plus
   recent de l ensemble. Rebaser chaque serie sur son propre dernier point les
   ferait glisser les unes par rapport aux autres, et les incidents que le
   generateur a pris soin de correler se decaleraient entre le ruban du VPN et
   celui de Kuma — ce que ces rubans servent justement a recouper.

   ⚠️ Modifie les tableaux EN PLACE, sans danger : la page retelecharge ses
   fichiers a chaque tour et l objet rebase est jete apres le rendu. */
function rebase(d) {
  const series = [d.hist && d.hist.j, d.hist && d.hist.s, d.fin && d.fin.m, d.wan && d.wan.h, d.wan && d.wan.h7];
  let dernier = 0;
  for (const s of series)
    if (Array.isArray(s) && s.length) dernier = Math.max(dernier, s[s.length - 1][0] || 0);
  if (d.cont && d.cont.t) dernier = Math.max(dernier, d.cont.t);
  if (!dernier) return d;

  const ecart = Math.floor(Date.now() / 1000) - dernier;
  if (Math.abs(ecart) < 120) return d;        // fixtures fraiches, rien a faire

  for (const s of series) if (Array.isArray(s)) for (const r of s) r[0] += ecart;
  if (d.cont) {
    if (d.cont.t) d.cont.t += ecart;
    if (Array.isArray(d.cont.ev)) for (const e of d.cont.ev) if (e.t) e.t += ecart;
  }
  if (d.smart && d.smart.ts) d.smart.ts += ecart;
  return d;
}

/* ⚠️ `_tronque` : COUPER LES SERIES, ce qu un calque ne peut pas exprimer.
   Un scenario « premier demarrage » devrait montrer une page qui vient de
   naitre, historique presque vide et messages d attente. Or ecrire 145 lignes
   de mesures tronquees dans un calque serait absurde. La cle dit simplement
   combien de points garder, et la coupe se fait ici.
   ⚠️ AVANT le rebasage : celui-ci cale le dernier point sur maintenant, et
   couper apres deplacerait toute la fenetre dans le passe. */
function tronque(d) {
  const n = d._tronque;
  if (!n) return d;
  delete d._tronque;
  const coupe = (s) => (Array.isArray(s) && s.length > n) ? s.slice(-n) : s;
  if (d.hist) { d.hist.j = coupe(d.hist.j); d.hist.s = coupe(d.hist.s); }
  if (d.fin)  { d.fin.m  = coupe(d.fin.m); }
  return d;
}

/* ⚠️ `pcDemo` s applique APRES le calque, et c est indispensable : le calque
   d un scenario porte lui aussi un `pc`, et il ecraserait la simulation a
   chaque rendu. Ce qu on vient de demander doit primer sur le scenario. */
/* ⚠️ LES DATES DES MISES A JOUR SUIVENT L HORLOGE EN DEMONSTRATION (09/10/2026).
   `maj.json` et `versions.json` portent des dates absolues : la fenetre annoncait
   « derniere passe le 14/03 » des mois apres, et la carte « controle du 14/03 »
   pour un controle vieux de 8 h. Tout est decale pour que la derniere passe tombe
   `updates.age` heures avant maintenant, comme en production. */
const passeDemo = () => Date.now() - (((DATA.updates || {}).age > 0 ? DATA.updates.age : 8) * 3600000);
const deux = (n) => String(n).padStart(2, "0");
const isoLocal = (ms) => { const d = new Date(ms), z = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}T${deux(d.getHours())}:${deux(d.getMinutes())}:${deux(d.getSeconds())}`
    + (z >= 0 ? "+" : "-") + deux(Math.trunc(Math.abs(z) / 60)) + ":" + deux(Math.abs(z) % 60); };
function majDemo(m) {
  if (!DEMO || !m || !m.derniere_passe || !m.derniere_passe.fin) return m;
  const ecart = passeDemo() - Date.parse(m.derniere_passe.fin);
  const decale = (o) => { for (const k in o) { const v = o[k];
    if (typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v) && !isNaN(Date.parse(v))) o[k] = isoLocal(Date.parse(v) + ecart);
    else if (v && typeof v === "object") decale(v); } };
  decale(m);
  return m;
}
function versionsDemo(v) {
  if (!DEMO || !v || !Array.isArray(v.items) || !v.items.length) return v;
  const ecart = Math.round(passeDemo() / 1000) - Math.max(...v.items.map(x => x.ts || 0));
  for (const x of v.items) if (x.ts) {
    x.ts += ecart;
    const d = new Date(x.ts * 1000);
    x.d = deux(d.getDate()) + "/" + deux(d.getMonth() + 1);
  }
  return v;
}

const demo = (d) => {
  if (!DEMO) return d;
  const o = rebase(tronque(horodate(DEMO_CALQUE ? fusion(d, DEMO_CALQUE) : d)));
  if (o.updates && o.updates.age >= 0) {
    const t = new Date(Date.now() - o.updates.age * 3600000);
    o.updates.maj = deux(t.getDate()) + "/" + deux(t.getMonth() + 1) + " " + deux(t.getHours()) + ":" + deux(t.getMinutes());
  }
  if (pcDemo) o.pc = { ...(o.pc || {}), ...pcDemo };
  return o;
};

async function demoCharge(id) {
  const e = DEMO.liste.find(x => x.id === id)
         || DEMO.liste.find(x => x.id === DEMO.defaut)
         || DEMO.liste[0];
  DEMO_ID = e.id;
  try { localStorage.setItem("hl-demo", DEMO_ID); } catch (err) { /* navigation privee */ }
  /* Le scenario par defaut EST la base : pas de calque a charger. */
  DEMO_CALQUE = e.id === DEMO.defaut ? null
    : await fetch("fixtures/scenarios/" + e.id + ".json?" + Date.now())
        .then(r => r.ok ? r.json() : null).catch(() => null);
}

function demoSelecteur() {
  const b = document.createElement("div");
  b.id = "demo";
  b.innerHTML = `<label for="demo-sel">Scénario de démonstration</label>`
    + `<select id="demo-sel">` + DEMO.liste.map(s =>
        `<option value="${esc(s.id)}"${s.id === DEMO_ID ? " selected" : ""}>${esc(s.nom)}</option>`
      ).join("") + `</select><p></p>`;
  document.body.appendChild(b);

  const sel = b.querySelector("select"), note = b.querySelector("p");
  const dit = () => { note.textContent = (DEMO.liste.find(s => s.id === sel.value) || {}).note || ""; };
  sel.addEventListener("change", async () => {
    await demoCharge(sel.value);
    dit();
    /* L adresse suit le choix : le lien devient partageable, et un recruteur
       peut ouvrir directement le tableau de bord en etat de crise. */
    const u = new URL(location);
    u.searchParams.set("demo", DEMO_ID);
    history.replaceState(null, "", u);
    refresh();
  });
  dit();
}

async function demoInit() {
  try {
    DEMO = await fetch("fixtures/scenarios.json?" + Date.now())
      .then(r => r.ok ? r.json() : null);
  } catch (e) { DEMO = null; }
  if (!DEMO || !Array.isArray(DEMO.liste) || !DEMO.liste.length) return;  // production
  let choix = null;
  try { choix = localStorage.getItem("hl-demo"); } catch (e) { /* ignore */ }
  await demoCharge(new URLSearchParams(location.search).get("demo") || choix || DEMO.defaut);
  demoSelecteur();
  refresh();
}
demoInit();
