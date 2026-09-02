/* ===== Homelab — tableau de bord maison ===== */
/* IP et go : deplace dans `services.js`, charge avant ce fichier. */
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

   - 48 cases et non 96. Kuma occupe la pleine largeur ; sur une carte d une
     colonne, 340 px interieurs, les 95 gouttieres de 3 px en mangeraient 285
     et les cases tomberaient a 0,6 px. Un `gap` ne se comprime pas en flex.
   - un quatrieme etat, `nd`, pour un creneau SANS MESURE. Sans lui le ruban
     serait ecarlate pendant ses 24 premieres heures, la colonne n existant
     pas dans l historique anterieur.

   Chaque case prend le PIRE des creneaux qu elle couvre : une panne de dix
   minutes ne doit pas se diluer dans une moyenne de demi-heure. */
/* ⚠️ SVG ETIRE, PAS UNE RANGEE DE DIVS. La version en flex donnait des barres
   INEGALES et, en dessous d une certaine largeur, inexistantes. Mesure du
   28/08 sur un ruban de 317 px : les cases faisaient 2,42 ou 2,44 px sur la
   carte VPN — donc 2 ou 3 px une fois peintes, d ou l irregularite visible — et
   0,19 px sur la carte Kuma, ou les 144 gouttieres de 2 px mangeaient 288 des
   317 px disponibles.
   La cause est structurelle : UNE GOUTTIERE FIXE NE SE COMPRIME PAS, et le
   rapport barre/gouttiere se degrade avec la largeur. Le commentaire de la
   section 14 de `fond.css` l avertissait deja pour la carte Site.
   Dans un viewBox de n unites etire par `preserveAspectRatio="none"`, chaque
   barre occupe exactement une unite : les largeurs sont egales PAR
   CONSTRUCTION et la gouttiere devient proportionnelle. Meme technique que
   `.courbe`, qui ignore ce probleme depuis le debut. */
const ruban = (v, n, alt, ts) => {
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
        : "")
    + `><rect class="capt" x="0" y="0" width="${n}" height="10"/>`
    + c.map((x, k) => `<rect x="${(k + 0.13).toFixed(2)}" width="0.74" height="10"${
        x ? ` class="${x}"` : ""}/>`).join("")
    + `</svg>`;
};

/* ECHELLE HORAIRE D UN RUBAN (28/08/2026).

   Le ruban disait QUE le port avait lache, jamais QUAND. Or c est la premiere
   question devant une case rouge, et la reponse doit pouvoir se recouper avec
   `watchdog.log`, qui horodate ses constats a la seconde.

   ⚠️ LES HEURES VIENNENT DES HORODATAGES REELS, colonne `t` de l historique,
   et non d un « maintenant moins 24 h ». La serie couvre 23,83 h et pas 24,
   et elle est plus courte encore dans les heures qui suivent un redemarrage :
   une echelle supposee decalerait tous les reperes sans que rien ne le dise.

   ⚠️ Les reperes tombent sur des HEURES RONDES LOCALES, pas a intervalle
   regulier depuis le bord. « 14 h » se recoupe avec un journal ; « il y a
   6 h » demande un calcul mental a chaque lecture.

   ⚠️ Rien au-dela de 90 % : l etiquette y chevaucherait « maintenant », et une
   echelle illisible est pire qu absente. */
const echelle = (ts, pas, n) => {
  if (!ts || ts.length < 2) return "";
  const t0 = ts[0], t1 = ts[ts.length - 1], d = t1 - t0;
  if (!(d > 0)) return "";
  const m = [];
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

/* RUBAN HORODATÉ : légende, ruban à pas fixe, échelle. Facteur commun aux
   cartes VPN et Kuma, qui ne différaient que par la colonne lue.

   ⚠️ UNE CASE = UNE DURÉE FIXE. `ruban` découpe par INDEX : 96 cases pour
   145 relevés donnaient 1,5 relevé par case, soit — mesuré — 47 cases de
   10 min et 49 de 20 min. Une case rouge valait le simple ou le double, ce qui
   vide de son sens l'échelle horaire. On fixe donc le NOMBRE DE RELEVÉS PAR
   CASE et le nombre de cases s'en déduit.

   ⚠️ Le reste de la division est retiré au DÉBUT : l'alignement est exact du
   côté le plus récent, celui qu'on regarde, et c'est la case la plus ancienne
   qui est sacrifiée. La même troncature s'applique aux horodatages, sans quoi
   l'échelle serait décalée d'un relevé par rapport au ruban qu'elle légende.

   ⚠️ Deux relevés et pas trois : à 30 min les trous de cinq à dix minutes se
   fondraient tous en ambre. À 20 min, un trou de 10 min reste ambre et un
   créneau entièrement mort devient rouge. */
const rubanH = (d, col, alt, par) => {
  const v = Hn(d, col), PAR = par || 2;
  const dec = v.length % PAR;
  const vc = v.slice(dec), tsc = Hn(d, "t").slice(dec);
  const n = Math.max(1, Math.floor(vc.length / PAR));
  const pc = tsc.length > PAR ? (tsc[PAR] - tsc[0]) / 60 : 0;
  return `<div class="rleg"><span>${pc ? "1 barre = " + esc(duree(pc)) : ""}</span>`
    + `<span>maintenant</span></div>`
    + ruban(vc, n, alt + (pc ? ", une case par " + duree(pc) : ""), tsc)
    // ⚠️ Pas de 3 h et non 6. Sur 24 h cela fait huit reperes espaces de
    // 12,5 %, soit 66 px sur un ruban de 530 et 35 px sur un de 278, pour
    // des etiquettes de ~24 px. C est la limite basse : a 2 h elles se
    // toucheraient sur une demi-carte.
    + echelle(tsc, 3, n);
};

/* ETAT PAR GROUPE DE SONDES (28/08/2026).

   La carte annonçait « 3 sondes hors ligne » sans dire lesquelles : il fallait
   ouvrir Kuma pour savoir par où commencer. Elle NOMME désormais les fautives,
   groupe par groupe.

   ⚠️ Aucun ruban par groupe, et c'est délibéré. Trois rubans tripleraient
   l'encre pour trois lignes vertes en permanence — la raison même qui a fait
   retirer celui de la carte Site le jour même.

   ⚠️ Au-delà de trois noms on abrège. Une ligne qui déborde ne se lit pas, et
   passé le troisième c'est le groupe entier qui est en cause, pas une sonde
   qu'on irait chercher par son nom. */
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

/* Acces a l historique PAR NOM de colonne (24/08/2026).

   `history.json` publie la liste `champs` : s en servir plutot que de compter
   les colonnes a la main supprime toute une classe de bug. La page a trace
   pendant des semaines la colonne 12 sous l etiquette « swap » alors que le
   swap etait en 11 — parfaitement invisible, parce que 43 % et 46 °C
   dessinent la meme ligne au meme endroit du graphique.

   Consequence heureuse : `collect.sh` peut desormais ajouter ses colonnes en
   FIN de ligne, dans l ordre d apparition plutot que dans l ordre logique, ce
   qui evite de deplacer une colonne existante et de rendre faux tout
   l historique deja enregistre. La page ne s en apercoit pas. */
const col = (d, n) => (((d.hist || {}).champs) || []).indexOf(n);
const Hn = (d, n) => { const i = col(d, n); return i < 0 ? [] : H(d, i); };

/* Meme lecture par nom, sur la serie de SEPT JOURS au pas d une heure. */
const Hs = (d, n) => { const i = col(d, n);
  return i < 0 ? [] : (((d.hist || {}).s) || []).map(p => +p[i] || 0); };

/* Colonnes de temperature par disque, triees, quel qu en soit le nombre. La
   machine a quatre emplacements M.2 dont deux libres : un SSD ajoute plus tard
   apparaitra tout seul, sans toucher ni au collecteur ni a la page. */
const disquesHist = (d) => (((d.hist || {}).champs) || [])
  .filter(n => /^nvme\d+$/.test(n)).sort();

/* ---- Série FINE, au pas d'une minute (30/08/2026) -------------------------

   `history.json` résume 24 h en 145 points de 10 minutes : une pointe de
   processeur d'une minute y disparaît dans la moyenne, et le survol ne pouvait
   pas répondre mieux qu'au créneau. `history-min.json` publie les mêmes 24 h au
   pas d'UNE MINUTE, pour les onze colonnes que tracent les trois cartes
   concernées.

   ⚠️ IL N'ENTRE PAS DANS LA BOUCLE DE 2 s. Il pèse le triple de
   `history.json` et ne change qu'une fois par minute : le retélécharger trente
   fois par minute serait du trafic pur. Il est mis en cache ici et renouvelé
   toutes les 30 s, la boucle courte réutilisant la copie.

   ⚠️ LES DEUX SÉRIES N'ONT PAS LES MÊMES COLONNES. Chercher un indice dans
   l'une pour lire dans l'autre rendrait une température à la place d'un débit.
   `colf` interroge les champs de la série fine, et `Hf` retombe proprement sur
   la série à 10 min tant que le fichier n'existe pas — au premier démarrage,
   ou si le cron n'est pas encore passé. */
let FIN = null, FINT = 0;
async function histFin() {
  if (FIN && Date.now() - FINT < 30000) return FIN;
  try {
    FIN = await fetch("history-min.json?" + Date.now()).then(r => r.json());
    FINT = Date.now();
  } catch (e) { /* le tracé retombe sur la série à 10 min */ }
  return FIN;
}
const colf = (d, n) => (((d.fin || {}).champs) || []).indexOf(n);
const Hf = (d, n) => { const i = colf(d, n);
  return i < 0 ? Hn(d, n) : (((d.fin || {}).m) || []).map(p => +p[i] || 0); };

/* MOYENNE PAR PAQUETS, POUR LE TRACÉ SEULEMENT (30/08/2026).

   La série fine compte 1440 points sur 24 h. L'aire de tracé d'un graphe fait
   272 unités sur 300, soit environ 480 px à l'écran : cela fait trois points
   par pixel, sous un trait de 1,8 unité qui en vaut 3,2. Le résultat n'était
   plus une courbe mais une bande pleine — et la silhouette de qBittorrent
   était pire encore, 1440 points sur 256 px. On vise donc environ UN POINT
   PAR PIXEL, et le trait descend à 1,2 unité.

   ⚠️ ON RÉDUIT CE QU'ON DESSINE, PAS CE QU'ON LIT. `data-v` conserve la série
   entière et le survol continue de répondre à la minute. Conséquence assumée :
   la courbe montre une moyenne de trois minutes là où l'infobulle donne la
   valeur d'une seule, et les deux peuvent s'écarter de quelques points sur une
   pointe brève. C'est le prix d'un tracé lisible.

   ⚠️ Sans la série fine, `p` vaut 1 et la fonction rend le tableau intact :
   les 145 points de la série à 10 min ne sont jamais degrades. */
const reduis = (v, cible) => {
  const p = Math.max(1, Math.ceil(v.length / cible));
  if (p === 1) return v;
  const o = [];
  for (let i = 0; i < v.length; i += p) {
    const s = v.slice(i, i + p);
    o.push(s.reduce((a, b) => a + b, 0) / s.length);
  }
  return o;
};

/* Aire empilable : une ou plusieurs series sur la meme echelle. */
const aire = (series, mx, o) => {
  o = o || {};
  const ts = o.ts || [];
  const ok = series.filter(x => x.v.length > 1);
  if (!ok.length) return "";
  /* ⚠️ LE PLAFOND SE CALCULE SUR LA SERIE REDUITE, celle qu on trace, et non
     sur la serie fine. Sinon il vaut la pointe d une minute que la moyenne sur
     six minutes ecrete, et la courbe ne peut jamais atteindre le haut du
     cadre : mesure le 02/09/2026, sommet a 58,4 % de la hauteur, quinze unites
     de vide sur trente-six.
     ⚠️ On reduit UNE SEULE FOIS, ici, pour les deux usages. `tr` recevait
     la serie brute et la reduisait a chaque appel, soit deux fois par serie
     puisqu il sert au remplissage puis au trait. */
  const red = ok.map(x => Object.assign({}, x, { r: reduis(x.v, 240) }));
  const M = mx || Math.max(1, ...red.flatMap(x => x.r));
  const tr = (v) => v.map((y, i) =>
    (i / (v.length - 1) * 236).toFixed(1) + "," + (44 - Math.min(y / M, 1) * 36).toFixed(1)).join(" L ");
  return `<div class="silh"><svg class="courbe" viewBox="0 0 236 48" preserveAspectRatio="none" role="img" aria-label="Historique sur 24 heures"`
    + ` data-lec="gr" data-x0="0" data-x1="236" data-u="${esc(o.u || "%")}"`
    + (ts.length > 1 ? ` data-t0="${ts[0]}" data-t1="${ts[ts.length - 1]}"` : "")
    + `><rect class="capt" x="0" y="0" width="236" height="48"/>`
    + red.map(x => `<path d="M ${tr(x.r)} L 236,48 L 0,48 Z" fill="${x.c}" fill-opacity=".16"/>`
        + `<path class="serie" data-n="${esc(x.n || "")}" data-k="0" data-v="${x.v.map(z => Math.round(z)).join(",")}" d="M ${tr(x.r)}" fill="none" stroke="${x.c}" stroke-width="1.4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`).join("")
    /* Le repere du haut annonce le SOMMET REEL du trace : depuis que le
       plafond se calcule sur la serie reduite, la courbe atteint
       exactement cette valeur au point le plus haut du cadre. */
    + `</svg><span class="vmax">${esc(fmtv(M, o.u || "%"))}</span><span class="vmin">0</span></div>`;
};

/* Debut de la periode reellement couverte par l historique. */
const depuis = (d) => {
  const j = (d.hist && d.hist.j) || [];
  if (!j.length) return "";
  const h = Math.round((Date.now() / 1000 - j[0][0]) / 3600);
  return "il y a " + (h >= 24 ? "24 h" : Math.max(1, h) + " h");
};

/* Dernier point de l historique. C est la SEULE source pour les mesures qui ne
   transitent pas par data.json : les temperatures par disque et celle du
   controleur reseau ne sont ecrites que dans history.csv. Au pas de 10 min,
   c est assez frais pour une temperature. */
const dern = (d) => (((d.hist || {}).j) || []).slice(-1)[0] || [];

/* Graphique : echelle chiffree a gauche, axe de temps en bas, point terminal,
   seuil optionnel en pointille. Gouttiere de 26 px pour les etiquettes.

   Deux options ajoutees le 24/08/2026 pour la carte Temperatures :

   - `o.min` deplace le BAS de l echelle. Quatre capteurs vivant entre 40 et
     72 degres etaient ecrases dans le tiers superieur d un axe partant de
     zero ; l axe se lit desormais de 30 a 90 et les ecarts se voient. Les
     trois etiquettes suivent automatiquement.
   - `x.d0` sur une serie la fait demarrer LA OU SES DONNEES COMMENCENT, au
     lieu du bord gauche. Une mesure ajoutee aujourd hui n a pas d historique
     hier : sans ca elle tracerait une ligne plate a zero sur vingt-trois
     heures, ce qui ressemble beaucoup a une panne. La courbe s allonge d
     elle-meme au fil des passages.
     ⚠️ A n activer que la ou zero signifie « pas de donnee ». Pour un
     pourcentage de processeur, zero est une valeur parfaitement legitime et
     l option masquerait de vraies mesures. */
const graphe = (series, o) => {
  o = o || {};
  const ok = series.filter(x => x.v && x.v.length > 1
    && (!x.d0 || x.v.some(n => n > 0)));
  if (!ok.length) return `<div class="note">Historique en cours de constitution</div>`;
  const m = o.min || 0;
  const M = o.max || Math.max(1, ...ok.flatMap(x => x.v));
  const f = o.f || (v => String(Math.round(v)));
  const Y = y => (78 - Math.min(Math.max(y - m, 0) / (M - m), 1) * 66).toFixed(1);
  const X = (i, n) => (26 + i / (n - 1) * 272).toFixed(1);
  /* ⚠️ LE MOT « SEUIL » A ETE RETIRE, ce n est pas un oubli. Ecrit en entier
     l etiquette faisait 36,5 unites pour une gouttiere de 26 : elle debordait
     dans l aire de trace, ou elle a d abord traverse la courbe memoire a 67 %.
     Reduite au seul nombre, elle tient dans la gouttiere et se lit comme une
     QUATRIEME GRADUATION de l axe, entre « 100 % » et « 50 % ». C est la
     couleur et le trait pointille qui disent qu il s agit d un seuil.
     ⚠️ Le `Math.min` retient l etiquette dans le cadre : un seuil bas — 15 %
     par exemple sur un futur graphique — la ferait sinon sortir sous l aire de
     trace, jusque dans l axe du temps. */
  const sl = o.seuil == null ? "" :
    `<line x1="26" y1="${Y(o.seuil)}" x2="298" y2="${Y(o.seuil)}" stroke="#ff453a"
       stroke-width=".9" stroke-dasharray="3 3" opacity=".75"/>
     <text x="0" y="${Math.min(+Y(o.seuil) + 2, 77).toFixed(1)}" text-anchor="start"
       style="fill:#ff8f88;font-size:6.5px">${esc(f(o.seuil))}</text>`;
  /* Trois series se superposent depuis la fusion Systeme + swap : on allege
     le remplissage, sinon les aires s additionnent en une soupe. */
  const op = ok.length >= 3 ? ".11" : ".16";
  const ts = o.ts || [];
  return `<svg class="gr" viewBox="0 0 300 84" role="img" aria-label="${esc(o.alt || "historique")}" data-lec="gr" data-x0="26" data-x1="298" data-u="${esc(o.u || "%")}"${ts.length > 1 ? ` data-t0="${ts[0]}" data-t1="${ts[ts.length - 1]}"` : ""}>
    <rect class="capt" x="26" y="6" width="272" height="78"/>
    <text x="0" y="14">${esc(f(M))}</text><text x="0" y="47">${esc(f((M + m) / 2))}</text><text x="0" y="80">${esc(f(m))}</text>
        <g stroke="rgba(255,255,255,.10)" stroke-width=".7">
      <line x1="26" y1="12" x2="298" y2="12"/><line x1="26" y1="45" x2="298" y2="45"/><line x1="26" y1="78" x2="298" y2="78"/>
    </g>${sl}
    ${ok.map(x => { const vd = reduis(x.v, 480), n = vd.length;
      const k = x.d0 ? Math.max(0, vd.findIndex(z => z > 0)) : 0;
      const kf = x.d0 ? Math.max(0, x.v.findIndex(z => z > 0)) : 0;
      const pts = vd.slice(k).map((y, i) => X(i + k, n) + "," + Y(y)).join(" L ");
      return `<path d="M ${pts} L 298,78 L ${X(k, n)},78 Z" fill="${x.c}" fill-opacity="${op}"/>
      <path class="serie" data-n="${esc(x.n || "")}" data-k="${kf}" data-v="${x.v.map(z => +(+z).toFixed(1)).join(",")}" d="M ${pts}" fill="none" stroke="${x.c}" stroke-width="1.2" stroke-linejoin="round"/>
      <circle cx="298" cy="${Y(vd[n - 1])}" r="2.6" fill="${x.c}"/>`; }).join("")}
  </svg>` + (ts.length > 1 ? `<div class="gech">${echelle(ts, 3)}</div>` : "");
};

const pct = v => Math.round(v) + " %";

/* Sept valeurs quotidiennes = sept barres. Une courbe suggererait une continuite
   qui n existe pas entre deux jours. */
const jours = (a) => {
  const v = (a || []).map(x => +x || 0);
  if (!v.length) return "";
  const M = Math.max(1, ...v);
  // Un jour a zero garde un talon visible : sans lui, la barre disparait et
  // la serie ressemble a un trait casse plutot qu a un jour sans visite.
  return `<div class="jours"><div class="b">${v.map((y, i) =>
      `<i class="${i === v.length - 1 ? "now" : ""}" data-lec="jour" data-v="${y}" data-i="${i}" data-n="${v.length}"
          style="height:${y === 0 ? 8 : Math.max(30, y / M * 100)}%"></i>`).join("")}</div>
    <em>7 derniers jours · max ${M}/jour</em></div>`;
};

/* Troisieme element optionnel : la VALEUR INSTANTANEE de la serie. Elle a
   remplace les trois anneaux de la carte Systeme, qui repetaient la barre du
   haut pour trente fois leur hauteur. Les appels a deux elements restent
   valides, `v` vaut alors undefined. */
const leg = (l) => `<div class="leg">${l.map(([t, c, v]) =>
  `<span><i style="background:${c}"></i>${esc(t)}${
    v != null ? `<b>${esc(v)}</b>` : ""}</span>`).join("")}</div>`;

/* On classe sur la memoire REELLE : residente + evacuee en zram. Sans le second
   terme, Jellyfin paraissait 6e alors qu il est 2e (102 Mo vus, 528 reels). */
const moC = (p, rt) => rt ? Math.round(p / 100 * rt / 1024) : 0;
const reelC = (x, rt) => moC(x.mem, rt) + (x.swap || 0);

/* Une ligne par conteneur, refonte du 24/08/2026.

   LA BARRE EST SCINDEE. Le plein est ce qui tient en memoire, le voile ce qui
   a ete evacue en zram. `reelC` additionnait les deux en un seul nombre, ce
   qui masquait le sujet meme de cette carte : Jellyfin affichait 524 Mo dont
   449 evacues, autrement dit 75 Mo reellement residents. Sur un NAS de 7,5 Go
   qui swappe a 42 %, c est precisement la distinction qui compte.

   LE REPERE FIN marque la moyenne de residence sur 24 h. `mem24` etait
   collecte depuis toujours et n avait jamais servi. Au-dela du repere le
   conteneur consomme plus que d habitude, en deca moins — c est la seule
   grandeur de cette carte qui BOUGE vraiment, le classement, lui, ne change
   quasiment jamais.

   ⚠️ Le repere se lit sur la meme echelle que les segments, mais il ne
   concerne que la RESIDENCE : il n existe pas de `swap24`, et melanger un
   total actuel avec une moyenne de residence donnerait un repere faux. */
const bars = (l, ramt) => {
  if (!l.length) return `<div class="note">Relevé en attente</div>`;
  const mx = Math.max(1, ...l.map(c => reelC(c, ramt)));
  const pc = (v) => Math.min(100, v / mx * 100).toFixed(1);
  return `<div class="bars">${l.map(c => {
    const res = moC(c.mem, ramt), sw = c.swap || 0;
    const moy = moC(c.mem24 != null ? c.mem24 : c.mem, ramt);
    return `<div class="br"><span>${esc(c.n)}</span><b>${res + sw} Mo</b>`
      + `<i><em style="width:${pc(res)}%"></em>`
      + (sw ? `<u style="width:${pc(sw)}%"></u>` : "")
      + `<s style="left:${pc(moy)}%"></s></i></div>`;
  }).join("")}</div>`;
};

/* Sante SMART : une ligne par disque, refonte du 24/08/2026.

   L anneau d endurance a ete retire. Il affichait 99 % et 100 %, deux
   valeurs qui ne bougent quasiment jamais et qui ne peuvent que baisser :
   un anneau plein en permanence occupe beaucoup de place pour ne rien
   apprendre. Il prenait a lui seul la moitie de la hauteur de la carte.

   Ce qui le remplace, ce sont les deux grandeurs qui VARIENT reellement :

   - LA TEMPERATURE, replacee sur son echelle de 25 a 75 degres. Le
     chiffre seul ne dit pas si 45 degres est tiede ou brulant ; le
     curseur sur la reglette le dit d un coup d oeil. Un repere marque le
     seuil d alerte a 65 degres.
   - LE RYTHME D ECRITURE en Go par jour, deduit du total ecrit et de
     l age du disque. C est la grandeur qui pilote l usure, donc la seule
     sur laquelle une action est possible.

   L usure reste presente, en chiffre, la ou elle a sa place, accompagnee
   d une DUREE DE VIE MINIMALE affichee pour chaque disque.

   Le calcul ne suppose aucune specification constructeur. Il repose sur
   une seule propriete du releve : la NVMe expose « Percentage Used »
   comme un ENTIER TRONQUE, un plancher. Un compteur a 0 signifie donc une
   usure reelle strictement inferieure a 1 %, un compteur a 1 une usure
   inferieure a 2 %, et ainsi de suite. Au rythme observe, la duree
   restante vaut par consequent AU MOINS 100 / (usure + 1) fois l age du
   disque.

   C est une borne basse, jamais une promesse : elle est donc annoncee
   avec un « au moins ». Elle a trois qualites — elle existe meme a 0 %
   d usure, ce qui etait justement le cas sans projection auparavant ;
   elle ne peut pas se reveler optimiste ; et elle se resserre toute
   seule a mesure que le disque vieillit.

   Mise en page prevue pour les cartes etroites : le modele se tronque
   avec des points de suspension, les pastilles passent a la ligne. */
const disques = (s) => {
  const l = (s && s.d) || [];
  if (!l.length) return `<div class="note">Relevé SMART en attente</div>`;
  const TMIN = 25, TMAX = 75;          // bornes de la reglette, en degres
  return `<div class="nvme">` + l.map(x => {
    const cap = x.go >= 1000 ? vg((x.go / 1000).toFixed(1)) + " To" : x.go + " Go";
    const j = Math.max(1, Math.round(x.heures / 24));
    const gj = x.ecrit * 1000 / j;     // Go ecrits par jour
    const rythme = gj >= 1000 ? vg((gj / 1000).toFixed(2)) + " To/j"
                              : vg(gj.toFixed(1)) + " Go/j";
    const ko = !x.ok || x.erreurs > 0;
    const tc = x.temp >= 65 ? "cr" : x.temp >= 55 ? "wn" : "ok";
    const pos = Math.min(100, Math.max(0, (x.temp - TMIN) / (TMAX - TMIN) * 100));
    // `usure + 1` : le compteur etant tronque, l usure reelle lui est
    // strictement inferieure. La borne vaut donc pour un disque a 0 %.
    const ans = 100 / (x.usure + 1) * j / 365;
    const vie = ans >= 2 ? "≥ " + Math.round(ans) + " ans"
                         : "≥ " + Math.max(1, Math.round(ans * 12)) + " mois";
    return `<div class="nv">
        <div class="nv-h">
          <i class="nv-p ${ko ? "cr" : "ok"}"></i>
          <b class="nv-n">${esc(x.modele.replace(/_/g, " "))}</b>
          <span class="nv-c">${cap}</span>
          <span class="nv-d ${tc}">${x.temp} °C</span>
        </div>
        <div class="nv-b"><i style="left:${pos.toFixed(1)}%"></i></div>`
      + past([["usure " + x.usure + " %"],
              [rythme],
              [vie],
              [x.erreurs + (x.erreurs > 1 ? " erreurs" : " erreur"), ko ? "wn" : "ok"],
              [x.brutaux + (x.brutaux > 1 ? " arrêts brutaux" : " arrêt brutal")]])
      + `</div>`;
  }).join("") + `</div>`;
};

/* ⚠️ La pastille etait DECLAREE dans style.css — `.etatv .ep` et sa variante
   `.ep.ko` en rouge — mais jamais emise : le troisieme argument etait ignore
   depuis l origine. La carte VPN le passait pour rien, son etat de tunnel n a
   donc jamais eu son point de couleur. Corrige le 24/08/2026, en meme temps
   que l arrivee du bandeau d etat de qBittorrent. */
const etatv = (v, sub, ok) => `<div class="etatv">
  <span class="ep${ok ? "" : " ko"}"></span>
  <span class="vv"><b>${esc(v)}</b><span>${esc(sub)}</span></span></div>`;

/* GROUPS : deplace dans `services.js`, charge avant ce fichier. */

const ICONS = {
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5z"/>',
  down: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  chart: '<path d="M3 17l5-6 4 4 4-7 5 9"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/>',
};
const svg = (p, k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${k || 2}">${p}</svg>`;
const esc = (s) => String(s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
const label = (u) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");

function card(s, d) {
  const stats = s.f ? s.f(d) : null;
  const viz = s.r ? s.r(d) : null;
  const note = s.note ? s.note(d) : null;
  const warn = s.warn ? s.warn(d) : false;
  const main = s.u || s.x;
  const logo = s.ic ? `<img src="icons/${s.ic.includes(".") ? s.ic : s.ic + ".svg"}" alt="">` : esc(s.n.slice(0, 2).toUpperCase());
  const adr = [s.x && `<span class="dom lien" data-lien="${esc(s.x)}" title="${esc(s.x)}">${esc(label(s.x))}</span>`, s.u && `<span class="port">:${esc(s.u.split(":").pop())}</span>`].filter(Boolean).join("");
  const kl = "card" + (viz ? " viz" : "")
    + (s.w === 4 ? " c4" : s.w === 3 ? " c3" : s.w === 2 ? " c2" : "") + (s.mini ? " mini" : "");
  const body = `<div class="head"><span class="chip">${logo}</span>
      <div class="txt"><h3><span class="nom">${esc(s.n)}</span>${adr ? `<span class="adr">${adr}</span>` : ""}</h3>
        <p>${esc(s.d)}</p></div>
      <i class="dot${warn ? " warn" : ""}"></i></div>
    ${viz ? `<div class="vizb">${viz}</div>` : ""}
    ${stats ? `<div class="stats">${stats.map(([v, l]) =>
      `<div class="st"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("")}</div>` : ""}
    ${note ? `<div class="note">${esc(note)}</div>` : ""}`;
  if (s.pop) return `<div class="${kl} clic" data-pop="${s.pop}">${body}</div>`;
  return main ? `<a class="${kl}" rel="noreferrer" href="${main}">${body}</a>` : `<div class="${kl}">${body}</div>`;
}

/* ⚠️ LA CARTE EST DEJA UN `<a>`, vers `s.u || s.x` — donc vers le service LOCAL
   des qu il en existe un. On ne peut pas y imbriquer un second lien : le
   navigateur fermerait le premier et casserait la structure de la carte.
   Le domaine public est donc un `<span>` rendu cliquable par DELEGATION.
   ⚠️ `stopPropagation` ET `preventDefault` : le premier empeche le clic
   d atteindre le lien de la carte, le second annule la navigation par defaut.
   Sans les deux, cliquer sur « media.exemple.fr » ouvrait le port
   local, exactement l inverse de ce qu on demande.
   ⚠️ Phase de CAPTURE : le gestionnaire doit passer avant que le lien de la
   carte ne prenne la main.
   ℹ️ Ouverture dans le MEME onglet, comme le lien de la carte : le tableau de
   bord n est pas un portail qu on garde ouvert derriere soi, et le retour se
   fait par le bouton precedent. */
addEventListener("click", (e) => {
  const el = e.target.closest("[data-lien]");
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  location.href = el.dataset.lien;
}, true);

function bar(d) {
  const now = new Date();
  const ok = d.nas.run === d.nas.all, off = d.nas.all - d.nas.run;
  /* LES CARTES EN ALERTE, NOMMEES (01/09/2026).
     Le fond passait a l ambre sans dire d ou ca venait, et il fallait parcourir
     les vingt-sept cartes pour trouver la coupable.
     ⚠️ MEME FILTRE QUE `sante()`, et surtout MEME LISTE `TACHES` : une carte
     qui ne fait pas virer le fond ne doit pas etre nommee ici, sinon la barre
     accuserait un innocent. Les deux ne divergeront pas tant qu elles lisent la
     meme liste et les memes predicats.
     ⚠️ Calcule sur les DONNEES et non sur le DOM. `sante()` tourne sur son
     propre intervalle : si elle ecrivait dans la barre, `fusionne` effacerait
     son texte au rendu suivant.
     ⚠️ `try` autour du predicat : une carte dont la donnee manque ne doit pas
     emporter toute la barre du haut avec elle. */
  const soucis = GROUPS.flatMap(g => g.s).filter(s => {
    if (!s.warn || TACHES.includes(s.n)) return false;
    try { return !!s.warn(d); } catch (e) { return false; }
  }).map(s => s.n);

  const dsk = d.nas.disk || 0, dtot = d.nas.disktot || 0;
  return `<div class="clock"><b>${now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</b>
      <span>${now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span></div>
    <div class="met">
      <div class="mi"><b>${(d.nas.cpu * (d.nas.cores || 1) / 100).toFixed(1).replace(".", ",")} / ${d.nas.cores || 1} <span class="u">cœurs</span></b><div class="tr"><i style="width:${d.nas.cpu}%"></i></div><small>processeur</small></div>
      <div class="mi"><b>${Gk(d.nas.ramu || 0)} / ${Gk(d.nas.ramt || 1)} <span class="u">Go</span></b><div class="tr"><i class="w" style="width:${d.nas.ram}%"></i></div><small>mémoire</small></div>
      <div class="mi"><b>${To(dtot * dsk / 100)} / ${To(dtot)} <span class="u">To</span></b><div class="tr"><i style="width:${dsk}%"></i></div><small>stockage</small></div>
      <div class="mi na"><b style="color:${(d.nas.temp || 0) >= 75 ? "var(--scr)" : (d.nas.temp || 0) >= 65 ? "var(--swn)" : "inherit"}">${Math.round(d.nas.temp || 0)} °C</b><small>température</small></div>
      <div class="mi na"><b>${d.nas.up} j</b><small>en service</small></div>
    </div>
    <div class="hp"><div class="line"><i class="${!ok ? "warn" : soucis.length ? "attention" : ""}"></i>${
        /* ⚠️ TROIS ETATS, et la classe de la pastille n est pas anodine.
           `sante()` cherche `.hp .line i.warn` pour decider de l etat CRITIQUE :
           reutiliser `warn` pour une alerte de carte ferait passer le fond au
           rouge au lieu de l ambre. D ou `attention`, que `sante()` ignore, le fond
           restant decide par le comptage des cartes. */
        !ok ? off + " service" + (off > 1 ? "s" : "") + " arrêté" + (off > 1 ? "s" : "")
        : soucis.length ? soucis.length + " point" + (soucis.length > 1 ? "s" : "") + " d'attention"
        : "Tout va bien"}</div>
      <div class="souci">${soucis.map(n =>
        `<span class="cible" data-carte="${esc(n)}">${esc(n)}</span>`).join("")}</div>
      <em><span>${d.nas.run} conteneurs</span><span>${d.updates.total || 0} MAJ en attente</span></em></div>`;
}

const KEY = "hl-sc";
/* DEF : deplace dans `services.js`, charge avant ce fichier. */
/* Les raccourcis vivent sur le NAS : identiques depuis tous les navigateurs. */
let SC = DEF.slice();
const rd = () => SC;
const wr = (l) => { SC = l; save(); };
async function load() {
  try {
    const r = await fetch("data/shortcuts.json?" + Date.now());
    if (r.ok) { const j = await r.json(); if (Array.isArray(j) && j.length) SC = j; }
  } catch (e) { console.warn("raccourcis illisibles, liste par défaut", e); }
  shortcuts();
}
async function save() {
  shortcuts();
  try {
    const r = await fetch("data/shortcuts.json", { method: "PUT",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(SC) });
    if (!r.ok) throw new Error(r.status);
  } catch (e) { console.error("enregistrement impossible", e); }
}
const hst = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
let editing = null;
const dlg = () => document.getElementById("dlg");

function editShortcut(i) {
  editing = i;
  const it = i === null ? { url: "", name: "" } : rd()[i];
  dlg().innerHTML = `<form method="dialog"><h3>${i === null ? "Nouveau raccourci" : "Modifier le raccourci"}</h3>
    <label for="du">Adresse</label><input id="du" value="${esc(it.url)}" placeholder="exemple.fr" required>
    <label for="dn">Nom</label><input id="dn" value="${esc(it.name)}" placeholder="Exemple">
    <div class="row">${i === null ? "" : '<button type="button" id="dsup" class="danger">Supprimer</button>'}
    <span class="sp"></span><button type="button" id="dann">Annuler</button>
    <button value="ok" class="pri">${i === null ? "Ajouter" : "Enregistrer"}</button></div></form>`;
  const d = dlg();
  d.querySelector("#dsup")?.addEventListener("click", () => d.close("del"));
  d.querySelector("#dann")?.addEventListener("click", () => d.close("no"));
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
dlg().addEventListener("close", (e) => {
  const l = rd(), v = e.target.returnValue;
  if (v === "del" && editing !== null) { l.splice(editing, 1); wr(l); return shortcuts(); }
  if (v !== "ok") return;
  const raw = e.target.querySelector("#du")?.value.trim(); if (!raw) return;
  const url = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
  const it = { url, name: e.target.querySelector("#dn").value.trim() || hst(url) };
  editing === null ? l.push(it) : (l[editing] = it); wr(l); shortcuts();
  // Le veilleur du NAS récupère l'icône du nouveau raccourci dès l'écriture du
  // fichier (inotify sur www/data) : on recharge la table quelques secondes
  // après, pour l'afficher sans avoir à recharger la page.
  setTimeout(() => { ICONES = null; shortcuts(); }, 6000);
});

/* Les icônes des raccourcis sont servies par le NAS. Chargées depuis les sites
   eux-mêmes, c'étaient des requêtes tierces : le bouclier du navigateur en
   bloquait une partie (ERR_BLOCKED_BY_CLIENT) et certains domaines les
   refusaient (ERR_BLOCKED_BY_RESPONSE.NotSameSite) — d'où des raccourcis sans
   icône alors que l'onglet du site en affichait une. `favicons.py` les rapatrie
   dans www/icons/ et décrit le résultat dans index.json (le nom de fichier
   dépend du format réel : un « .ico » est parfois un PNG). */
let ICONES = null;

function shortcuts() {
  const w = document.getElementById("shortcuts");
  w.innerHTML = rd().map((it, i) => `<a class="t" rel="noreferrer" href="${esc(it.url)}" title="${esc(it.url)}">
      <span class="i" data-h="${esc(hst(it.url))}">${esc((it.name || hst(it.url)).slice(0, 2).toUpperCase())}</span>
      <span class="l">${esc(it.name || hst(it.url))}</span>
      <button class="e" type="button" data-i="${i}">${svg('<path d="M4 20h4L20 8l-4-4L4 16z"/>', 2.4)}</button></a>`).join("")
    + `<button class="t add" type="button"><span class="i">${svg('<path d="M12 6v12M6 12h12"/>', 1.8)}</span><span class="l">Ajouter</span></button>`;
  // Premier passage : on va chercher la table des icônes locales, puis on
  // redessine. `{}` en attendant, pour ne pas empiler les requêtes.
  if (ICONES === null) {
    ICONES = {};
    fetch("icons/sites/index.json?" + Date.now()).then(r => r.json())
      .then(m => { ICONES = m; shortcuts(); }).catch(() => {});
  }
  w.querySelectorAll(".i[data-h]").forEach(s => {
    const f = ICONES[s.dataset.h];
    if (!f) return;                  // pas d'icône rapatriée : les initiales restent
    const im = new Image();
    im.onload = () => { s.textContent = ""; s.appendChild(im); };
    im.src = "icons/sites/" + f;
  });
  w.querySelectorAll(".e").forEach(b => b.onclick = ev => { ev.preventDefault(); editShortcut(+b.dataset.i); });
  w.querySelector(".add").onclick = () => editShortcut(null);
}

let majTimer = null;

async function getUpd() {
  try { return await (await fetch("updates.json?" + Date.now())).json(); }
  catch { return DATA.updates || {}; }
}
async function majState() {
  try { return await (await fetch("data/maj-status.json?" + Date.now())).text(); }
  catch { return ""; }
}

/* ⚠️ COLONNE DES VERSIONS. `x.v` est la version installee, `x.nv` la cible,
   toutes deux lues dans l etiquette `org.opencontainers.image.version` — la
   premiere sur le conteneur qui tourne, la seconde sur l image que Watchtower
   a deja telechargee pour comparer les identifiants.

   `x.nv` est VIDE quand elle n apporterait rien : cinq conteneurs n ont aucune
   etiquette de version, et celle d arr-gluetun vaut litteralement « latest ».
   La ligne n affiche alors que la version installee, barree par le CSS, ce qui
   suffit a dire qu elle est depassee. La version precedente ecrivait
   « 1.37.1 -> nouvelle » : une fleche pointant vers un mot.

   Les lignes en attente passent sur DEUX HAUTEURS (cf. `fond.css`) :
   « 5.2.3_v2.0.14-ls471 -> 5.2.3_v2.0.14-ls473 » fait 41 caracteres, environ
   250 px, quand la colonne en mesure 104. */
function paintUpd(u, note) {
  const it = u.items || [];
  const risque = (n) => /postgres|db$|broker/.test(n);
  // Les deux populations sont separees : ce qu il y a a faire d abord, le reste
  // en dessous et en retrait. L index d origine est conserve pour les cases.
  const idx = it.map((x, k) => [x, k]);
  const att = idx.filter(([x]) => x.upd), ajour = idx.filter(([x]) => !x.upd);
  const ligne = ([x, k]) => `<li class="${x.upd ? "att" : "ok"}">
      ${x.upd ? `<input type="checkbox" id="c${k}" value="${esc(x.n)}">`
              : `<span class="pastille"></span>`}
      <label ${x.upd ? `for="c${k}"` : ""}><span class="nm">${esc(x.n)}</span>
        ${x.upd && risque(x.n) ? '<span class="rq">base de données</span>' : ""}</label>
      <span class="vs">${x.upd && x.nv
        ? `<s>${esc(x.v)}</s><i>→</i><b>${esc(x.nv)}</b>`
        : `<s>${esc(x.v)}</s>`}</span></li>`;

  dlg().innerHTML = `<form method="dialog"><h3>Mises à jour manuelles</h3>
    <p class="sub">${u.total || 0} en attente sur ${u.verifies || 0} conteneurs surveillés · contrôle du ${esc(u.maj || "?")}</p>
    <p class="sub2">Les autres sont mis à jour automatiquement chaque nuit, ou construits localement.</p>
    <div class="scroll">
      ${att.length
        ? `<div class="majh">À mettre à jour<b>${att.length}</b></div>
           <ul class="majl">${att.map(ligne).join("")}</ul>`
        : `<div class="majv">Tout est à jour</div>`}
      ${ajour.length
        ? `<div class="majh discret">Déjà à jour<b>${ajour.length}</b></div>
           <ul class="majl discret">${ajour.map(ligne).join("")}</ul>`
        : ""}
      ${it.length ? "" : `<div class="majv">Aucun conteneur surveillé</div>`}
    </div>
    <p class="etat" id="mst">${esc(note || "")}</p>
    <div class="row centre">${att.length ? '<button type="button" id="mgo" class="go" disabled>Aucune mise à jour sélectionnée</button>' : ""}</div></form>`;

  const d = dlg(), st = d.querySelector("#mst"), go = d.querySelector("#mgo");
  const boxes = [...d.querySelectorAll('input[type="checkbox"]')];
  const sync = () => { const n = boxes.filter(b => b.checked).length;
    if (go) { go.disabled = !n; go.textContent = n ? `Mettre à jour (${n})` : "Aucune mise à jour sélectionnée"; } };
  boxes.forEach(b => b.onchange = sync); sync();

  if (!go) return;
  go.addEventListener("click", async () => {
    const items = boxes.filter(b => b.checked).map(b => b.value);
    if (!items.length) return;
    // On mémorise l état AVANT : on n acceptera un "terminé" que s il a changé.
    const avant = await majState();
    go.disabled = true; go.className = "go busy"; go.textContent = "Mise à jour en cours";
    boxes.forEach(b => b.disabled = true);   // plus de relance tant que ça tourne
    st.textContent = "Demande envoyée…";
    try {
      await fetch("data/trigger.json", { method: "PUT",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
    } catch {
      st.textContent = "Déclenchement impossible."; go.className = "go";
      go.disabled = false; go.textContent = "Réessayer";
      boxes.forEach(b => b.disabled = false); return;
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
        go.className = "go ok"; go.textContent = "Terminé"; go.disabled = true;
        st.textContent = "✅ " + s.msg;
        setTimeout(async () => { paintUpd(await getUpd(), "✅ " + s.msg); refresh(); }, 1500);
      }
    }, 2000);
  });
}

async function popUpdates() { paintUpd(await getUpd(), ""); dlg().showModal(); }

/* Liste complete des conteneurs, triee par memoire decroissante. */
/* Les piles se deduisent du prefixe du nom : aucune liste a maintenir,
   un service ajoute se range tout seul. */
/* PILES et AUTRES : deplace dans `services.js`, charge avant ce fichier. */
const pileDe = (n) => PILES.find(p => n.startsWith(p.k)) || AUTRES;

/* Derive : moyenne du dernier tiers comparee au premier. */
const tendance = (v) => {
  if (!v || v.length < 6) return { t: "—", c: "" };
  const q = Math.max(2, Math.floor(v.length / 3));
  const moy = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const a = moy(v.slice(0, q)), b = moy(v.slice(-q));
  if (a <= 0) return { t: "—", c: "" };
  const d = (b - a) / a * 100;
  if (Math.abs(d) < 5) return { t: "stable", c: "" };
  return { t: (d > 0 ? "+" : "") + Math.round(d) + " %", c: d >= 20 ? "wn" : d <= -20 ? "up" : "" };
};

async function popConteneurs() {
  const H = await fetch("containers-hist.json?" + Date.now()).then(r => r.json()).catch(() => null);
  const hc = (H && H.c) || {}, pas = (H && H.pas) || 1800, np = (H && H.n) || 0;
  const ok = np * pas >= 86400;
  const reste = Math.max(1, Math.ceil((86400 - np * pas) / 3600));

  const d = document.getElementById("dlg");
  const rt = DATA.nas.ramt || 0;
  const c = ((DATA.cont && DATA.cont.c) || []).slice();
  // Tout raisonne en Mo REELS : residente + evacuee en zram. Sans le second terme,
  // la fenetre contredisait la carte (Jellyfin 6e ici, 2e la-bas).
  const R = (x) => reelC(x, rt);
  const tot = Math.max(1, c.reduce((a, x) => a + R(x), 0));
  const comp = c.reduce((a, x) => a + (x.swap || 0), 0);

  const g = new Map();
  c.forEach(x => { const p = pileDe(x.n);
    if (!g.has(p.n)) g.set(p.n, { n: p.n, c: p.c, l: [], t: 0 });
    const e = g.get(p.n); e.l.push(x); e.t += R(x); });
  const piles = [...g.values()].sort((a, b) => b.t - a.t);
  piles.forEach(p => p.l.sort((a, b) => R(b) - R(a)));

  const compo = `<div class="compo"><div class="cbar">`
    + piles.map(p => `<i style="width:${(p.t / tot * 100).toFixed(1)}%;background:${p.c}"></i>`).join("")
    + `</div><div class="clg">` + piles.map(p =>
        `<span><i style="background:${p.c}"></i>${esc(p.n)} <b>${p.t} Mo</b></span>`).join("")
    + `</div></div>`;

  /* En-tete de colonnes (24/08/2026). La colonne « swap » n existait pas :
     l information ne vivait que dans une infobulle, alors qu elle represente
     la MOITIE de la memoire des conteneurs sur ce NAS. Sans en-tete, un
     nombre nu au milieu d une ligne serait indechiffrable.

     ⚠️ Il est place AU-DESSUS de la zone defilante, et son alignement se
     regle entierement dans `fond.css` : `.scroll` reserve 10 px de barre
     de defilement et 8 px de `padding-right`, l en-tete compense donc
     par 18 px de marge droite. Le placer DANS `.scroll` alignait aussi,
     mais imposait de le rendre collant, donc de lui donner un fond, qui
     dessinait une barre sombre en travers du verre. */
  const entete = `<div class="ln lnh"><span class="nm">service</span>`
    + `<span class="mm">réel</span><span class="sw">swap</span>`
    + `<span class="cp">proc.</span><span class="dv">dérive</span></div>`;

  const corps = piles.map(p => {
    const mx = Math.max(1, ...p.l.map(R));
    return `<div class="grp"><div class="grp-h"><i style="background:${p.c}"></i>`
      + `<b>${esc(p.n)}</b><em>${p.l.length} services · ${p.t} Mo</em></div>`
      + p.l.map(x => {
          const pre = PILES.find(q => x.n.startsWith(q.k));
          const nom = pre ? `<s>${esc(pre.k)}</s>${esc(x.n.slice(pre.k.length))}` : esc(x.n);
          const t = ok ? tendance(hc[x.n]) : null;
          const sw = x.swap || 0;
          /* ⚠️ MEME ECHELLE QUE LES SEGMENTS : `mx` est le maximum du GROUPE,
             pas du service. Un repere calcule sur une autre base se poserait
             a cote de la barre qu il commente. Le repli sur `mem` quand
             `mem24` manque reprend celui de la carte : un service qui vient
             de demarrer montre son repere sur sa valeur du moment plutot que
             de le voir tomber a zero. */
          const moy = Math.min(100,
            moC(x.mem24 != null ? x.mem24 : x.mem, rt) / mx * 100);
          return `<div class="ln"><span class="nm">${nom}</span>`
            + `<span class="mm">${R(x)} Mo</span>`
            + `<span class="sw">${sw ? sw + " Mo" : "—"}</span>`
            + `<span class="cp">${vg(x.cpu.toFixed(1))} %</span>`
            + (t ? `<span class="dv ${t.c}">${t.t}</span>` : `<span></span>`)
            + `<span class="tr">`
            + `<i style="width:${(moC(x.mem, rt) / mx * 100).toFixed(1)}%;background:${p.c}"></i>`
            + (sw ? `<u style="width:${(sw / mx * 100).toFixed(1)}%;background:${p.c}"></u>` : "")
            + `<s style="left:${moy.toFixed(1)}%"></s>`
            + `</span></div>`;
        }).join("") + `</div>`;
  }).join("");

  /* Le pied a ete supprime : sa barre de separation et sa mention « derive
     sur 24 h » coutaient 30 px pour une legende, qui a rejoint le sous-titre
     et l en-tete de colonnes. */
  d.classList.add("large");
  d.innerHTML = `<h3>Conteneurs</h3>
    <div class="sub">${c.length} services · ${vg((tot / 1024).toFixed(1))} Go réels,
      soit ${Math.round(tot * 1024 / (rt || 1) * 100)} % de la mémoire · dont ${comp} Mo en swap
      · ${ok ? "dérive sur 24 h" : "dérive disponible dans " + reste + " h"}
      · trait clair : moyenne 24 h</div>
    ${compo}${entete}<div class="scroll">${corps}</div>`;
  d.showModal();
}

/* Repli de toutes les cartes sur leur en-tête : on garde le logo, le nom,
   l'adresse et la pastille d'état, on masque le widget et les mesures. Réglage
   d'affichage propre à l'appareil, donc gardé en localStorage plutôt que dans
   shortcuts.json qui est partagé entre navigateurs.
   Le repli est purement CSS (une classe sur #groups) : rien n'est redessiné,
   et la fusion DOM de `fondre` ne touche pas aux attributs du conteneur. */
function replier(w) {
  const g = document.getElementById("groups");
  const b = document.createElement("button");
  b.id = "compact"; b.type = "button";
  const ICO_LISTE = '<path d="M4 7h16M4 12h16M4 17h16"/>';
  const ICO_GRILLE = '<path d="M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z"/>';
  const pose = (on) => {
    g.classList.toggle("compact", on);
    b.classList.toggle("actif", on);
    b.innerHTML = svg(on ? ICO_GRILLE : ICO_LISTE, 2) + "Compact";
    b.title = on ? "Afficher les widgets" : "Réduire les cartes à leur en-tête";
  };
  pose(localStorage.getItem("compact") === "1");
  b.onclick = () => {
    const on = !g.classList.contains("compact");
    localStorage.setItem("compact", on ? "1" : "0");
    pose(on);
  };
  w.appendChild(b);
}

function filters() {
  const w = document.getElementById("filters");
  if (w.childElementCount) return;
  const panneau = document.createElement("div"); panneau.className = "panneau";
  const mk = (t, i, on) => { const b = document.createElement("button");
    b.textContent = t; if (on) b.className = "on";
    b.onclick = () => { w.classList.remove("ouvert");
      const nom = w.querySelector(".menu-nom"); if (nom) nom.textContent = t;
      w.querySelectorAll("button:not(#compact):not(#menu)").forEach(x => x.classList.remove("on")); b.classList.add("on");
      document.querySelectorAll(".sec").forEach(s => s.style.display = (i === null || +s.dataset.g === i) ? "" : "none"); };
    panneau.appendChild(b); };
  // Bouton du menu déroulant, masqué au-dessus du seuil par le CSS.
  const menu = document.createElement("button");
  menu.id = "menu"; menu.type = "button"; menu.title = "Groupes";
  menu.innerHTML = '<span class="menu-nom">Tout</span>' + svg('<path d="M6 9l6 6 6-6"/>', 2);
  menu.onclick = (e) => { e.stopPropagation(); w.classList.toggle("ouvert"); };
  w.appendChild(menu);
  addEventListener("click", () => w.classList.remove("ouvert"));
  addEventListener("keydown", (e) => { if (e.key === "Escape") w.classList.remove("ouvert"); });

  mk("Tout", null, true); GROUPS.forEach((g, i) => mk(g.n, i));
  w.appendChild(panneau);
  replier(w);
}

async function refresh() {
  if (document.querySelector("dialog[open]")) return;   // ne pas redessiner sous une fenetre ouverte
  try {
    const [d, l, h, k, sm] = await Promise.all([
      fetch("data.json?" + Date.now()).then(r => r.json()),
      fetch("live.json?" + Date.now()).then(r => r.json()).catch(() => null),
      fetch("history.json?" + Date.now()).then(r => r.json()).catch(() => null),
      fetch("containers.json?" + Date.now()).then(r => r.json()).catch(() => null),
      fetch("smart.json?" + Date.now()).then(r => r.json()).catch(() => null)
    ]);
    d.hist = h; d.cont = k; d.smart = sm;
      d.fin = await histFin();
    // live.json prime sur data.json : ses valeurs sont rafraichies toutes les 2 s.
    if (l) {
      d.nas.cpu = l.cpu; d.nas.ram = l.ram; d.nas.net = l.net;
      if (l.qbit) { d.qbit.dl = l.qbit.dl; d.qbit.ul = l.qbit.ul; }
      d.jellyfin.now = l.jnow;
    }
    DATA = demo(d);
    fondre(document.getElementById("bar"), bar(DATA));
    fondre(document.getElementById("groups"), GROUPS.map((g, i) =>
      `<section class="sec" data-g="${i}"><h2>${svg(ICONS[g.i])}${esc(g.n)}</h2>
       <div class="grid">${g.s.map(s => card(s, DATA)).join("")}</div></section>`).join(""));
    document.querySelectorAll(".card.clic").forEach(c => c.onclick = ev => {
      if (ev.target.closest("a")) return;
      if (c.dataset.pop === "conteneurs") popConteneurs();
      else { document.getElementById("dlg").classList.remove("large"); popUpdates(); }
    });
    filters();
    const a = [...document.querySelectorAll("#filters button:not(#menu):not(#compact)")].findIndex(b => b.classList.contains("on"));
    if (a > 0) document.querySelectorAll(".sec").forEach(s => s.style.display = +s.dataset.g === a - 1 ? "" : "none");
  } catch (e) { console.error("data.json illisible", e); }
}
load(); refresh();

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

/* ---- Rechargement automatique quand app.js ou style.css changent ---- */
let VER = null;
async function checkVersion() {
  // Pas de rechargement pendant une saisie : ce serait pénible en pleine édition.
  if (document.getElementById("dlg")?.open) return;
  try {
    const sig = [];
    for (const f of ["app.js", "style.css", "fond.css"]) {
      const r = await fetch(f, { method: "HEAD", cache: "no-store" });
      sig.push(r.headers.get("etag") || r.headers.get("last-modified") || "");
    }
    const now = sig.join("|");
    if (VER && now !== VER) return location.reload();
    VER = now;
  } catch (e) { /* hors ligne : on réessaiera au prochain tour */ }
}
setInterval(checkVersion, 1000);
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

function fusionne(anc, nou) {
  const A = [...anc.childNodes], B = [...nou.childNodes];
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
  if (RE_SCHEMA.test(q)) return q;
  if (RE_LOCAL.test(q)) return "http://" + q;   // le LAN n'est pas en HTTPS
  const m = q.match(RE_DOMAINE);
  return m && !RE_FICHIER.test(m[1]) ? "https://" + q : null;
}

document.querySelector("form.search")?.addEventListener("submit", (e) => {
  const url = adresseSaisie(e.target.querySelector('input[name="q"]')?.value);
  if (!url) return;            // pas une adresse : recherche Google normale
  e.preventDefault();
  location.href = url;
});

/* ============ Le fond suit l etat du NAS (23/08/2026) ============
   Aucun couplage avec le calcul interne : on relit ce que la page vient
   d afficher. Une pastille `warn` dans la barre du haut signale qu au moins
   un conteneur est arrete. `fond.css` se charge de la couleur et du fondu.

   Revision du 24/08/2026 — TOUTES LES PASTILLES NE SE VALENT PAS.
   La premiere version comptait n importe quel `.dot.warn`, et le fond restait
   donc ambre en permanence : le CRM signale des leads non lus, Radarr des
   films manquants, Mises a jour des versions en attente. Ce sont des TACHES,
   vraies en continu, pas des incidents. Un fond d alerte allume tout le temps
   ne signale plus rien, ce qui lui fait perdre exactement la fonction qu on
   lui a donnee.

   La liste ci-dessous enumere les TACHES a ignorer, et non les incidents a
   surveiller. Ce sens compte : une carte ajoutee plus tard sera comptee comme
   un incident par defaut. Une alerte nouvelle se verra donc, au pire a tort,
   plutot que d etre passee sous silence.

   ⚠️ La correspondance se fait sur le NOM AFFICHE de la carte. Renommer une
   carte de cette liste la ferait de nouveau compter comme un incident. */
/* TACHES : deplace dans `services.js`, charge avant ce fichier. */

function sante() {
  const arret = !!document.querySelector(".hp .line i.warn");
  const incidents = [...document.querySelectorAll(".card")].filter(c =>
    c.querySelector(".dot.warn") &&
    !TACHES.includes((c.querySelector(".nom") || {}).textContent)).length;
  document.body.dataset.sante = arret ? "crit" : incidents ? "warn" : "ok";
}
sante();
setInterval(sante, 2000);


/* ============ LECTURE AU POINTEUR (30/08/2026) ============

   Les graphes montraient une forme sans jamais donner un chiffre : « la mémoire
   est montée vers 3 h » se lisait, « montée à combien » demandait d'aller ouvrir
   l'historique. Un panneau suit désormais le pointeur et donne l'instant visé
   et la valeur de chaque série.

   ⚠️ RIEN N'EST AJOUTÉ DANS L'ARBRE DESSINÉ. `fusionne` remplace les enfants
   d'un nœud dès que leur NOMBRE change, et `majAttributs` réécrit les attributs
   toutes les deux secondes : un repère injecté dans le SVG serait détruit au
   rafraîchissement suivant, et une position écrite en `style` effacée aussitôt.
   Le panneau et le trait de visée vivent donc dans `<body>`, en
   `position: fixed`, hors de toute zone rendue.

   ⚠️ CHAQUE GRAPHE PORTE UN RECTANGLE DE CAPTURE. Un `<path>` en `fill="none"`
   ne reçoit aucun événement, et les barres d'un ruban ne couvrent que 0,74
   unité sur 1 : sans ce rectangle, rien ne répondrait au-dessus d'une courbe et
   l'infobulle clignoterait entre deux barres. ⚠️ Sa transparence tient à une
   règle de `fond.css` et NON à son attribut `fill` : `.batt rect { fill: … }`
   l'emporte sur un attribut de présentation et le peindrait en vert par-dessus
   tout le ruban.

   ⚠️ LA CONVERSION SOURIS → DONNÉES PASSE PAR `getScreenCTM()`. Les rubans sont
   étirés (`preserveAspectRatio="none"`), les graphes ne le sont pas : une règle
   de trois sur la largeur serait juste pour les uns et fausse pour les autres.
   La matrice du SVG répond correctement dans les deux cas. */

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
  return {
    vx: x0 + i / (n - 1) * (x1 - x0),
    titre: t0 && t1 ? hhmm(t0 + (t1 - t0) * i / (n - 1)) : "",
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

function litBatt(svg, e) {
  const rs = [...svg.querySelectorAll("rect:not(.capt)")];
  if (!rs.length) return null;
  const x = svgX(svg, e);
  if (x == null) return null;
  const k = Math.max(0, Math.min(rs.length - 1, Math.floor(x)));
  const t0 = +svg.dataset.t0, ps = +svg.dataset.ps;
  const et = ETATB[rs[k].getAttribute("class") || ""] || ETATB[""];
  return {
    vx0: k + 0.13, vx1: k + 0.87,
    titre: t0 && ps ? hhmm(t0 + k * ps) + " → " + hhmm(t0 + (k + 1) * ps) : "",
    lignes: [{ n: et[0], c: et[1], v: "" }]
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

addEventListener("pointermove", (e) => {
  const el = e.target && e.target.closest && e.target.closest("[data-lec]");
  if (!el) return cacheTip();
  const t = el.dataset.lec;
  const r = t === "batt" ? litBatt(el, e) : t === "jour" ? litJour(el)
    : t === "ratio" ? litRatio(el) : litGraphe(el, e);
  if (!r || !r.lignes.length) return cacheTip();

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
  const cx = (t === "jour" || t === "ratio") ? null
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
});

addEventListener("pointerleave", cacheTip);
addEventListener("pointercancel", cacheTip);
addEventListener("scroll", cacheTip, true);


/* Cliquer le nom d une carte en alerte y amene (01/09/2026).
   ⚠️ Delegue sur `document` : la barre du haut est reconstruite toutes les deux
   secondes, un ecouteur pose sur le noeud disparaitrait au premier rendu.
   ⚠️ La correspondance se fait sur le NOM AFFICHE, comme `sante()` et comme la
   liste `TACHES`. Renommer une carte casse les trois d un coup, ce qui est au
   moins coherent.
   ℹ️ Limite connue : si un filtre de groupe masque la carte visee, le
   defilement ne montre rien. Le cas ne s est pas presente, le filtre etant
   presque toujours sur « Tout ». */
addEventListener("click", (e) => {
  const el = e.target.closest && e.target.closest("[data-carte]");
  if (!el) return;
  e.preventDefault();
  const cible = [...document.querySelectorAll(".card")].find(c =>
    (c.querySelector(".nom") || {}).textContent === el.dataset.carte);
  if (cible) cible.scrollIntoView({ behavior: "smooth", block: "center" });
});


/* ============ MODE DEMONSTRATION (01/09/2026) ============

   Le depot public sert les memes fichiers que le NAS, remplis de donnees
   inventees. Par-dessus, un CALQUE ecrase quelques champs pour montrer un etat
   degrade sans avoir a maintenir une copie complete du jeu de donnees : le
   calque du port VPN injoignable fait quarante octets.

   ⚠️ ACTIVE PAR LA PRESENCE D UN FICHIER, jamais par une constante ni un
   drapeau. Le NAS n a pas `fixtures/scenarios.json` : la requete echoue, `DEMO`
   reste null, le selecteur n est jamais construit, et `demo()` rend son
   argument tel quel. Rien a desactiver avant un deploiement, donc rien a
   oublier de desactiver.

   ⚠️ FUSION PROFONDE et surtout pas `Object.assign`, qui remplacerait `nas` en
   entier : un calque voulant changer la seule valeur `nas.ram` effacerait les
   dix-neuf autres mesures. Les TABLEAUX sont en revanche remplaces en bloc, et
   c est voulu : un calque qui redefinit les groupes de sondes les redefinit
   tous, fusionner element par element n aurait aucun sens ici.

   ⚠️ LE SELECTEUR VIT DANS `<body>`, comme le panneau de survol et pour la
   meme raison : `fusionne` reconstruit la barre toutes les deux secondes et un
   `<select>` place dedans perdrait le focus a chaque rendu. */

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
   absolus, figes au moment de leur generation : une demonstration publiee en
   mars afficherait six mois plus tard des courbes vieilles de six mois, avec
   une echelle horaire fausse et une carte Sauvegarde rouge a perpetuite. On
   decale donc toute la fenetre pour que son dernier point tombe sur maintenant.

   ⚠️ UN SEUL DECALAGE POUR TOUTES LES SERIES, calcule sur le point le plus
   recent de l ensemble. Rebaser chaque serie sur son propre dernier point les
   ferait glisser les unes par rapport aux autres, et les incidents que le
   generateur a pris soin de correler se decaleraient entre le ruban du VPN et
   celui de Kuma. C est justement ce que ces rubans servent a recouper.

   ⚠️ Modifie les tableaux EN PLACE. C est sans danger parce que la page
   retelecharge ses fichiers a chaque tour : l objet rebase est jete aussitot
   apres le rendu. */
function rebase(d) {
  const series = [d.hist && d.hist.j, d.hist && d.hist.s, d.fin && d.fin.m];
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

const demo = (d) => DEMO ? rebase(tronque(horodate(DEMO_CALQUE ? fusion(d, DEMO_CALQUE) : d))) : d;

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
