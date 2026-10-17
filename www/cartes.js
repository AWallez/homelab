/* LES TRENTE CARTES — identiques sur toutes les installations, deployees comme
 * `app.js`. Ce qui identifie une installation (adresse, ports, liens, trackers,
 * raccourcis, piles, taches) est dans `site.js`, charge avant ce fichier.
 * Separation du 08/10/2026 : voir l en-tete de `site.js`.
 *
 * ⚠️ L ORDRE COMPTE : la table appelle `go()` au moment ou elle se CONSTRUIT, pas
 * au rendu. Les aides de mise en forme (`hero`, `graphe`, `leg`…) ne sont
 * appelees qu a l interieur des fonctions flechees `r: d => …`, donc bien plus
 * tard, et vivent dans `app.js`.
 */

/* Compteurs sur 24 h quand le collecteur les donne, cumules sinon (08/10/2026). */
const coup24 = (l) => l.coup24 != null ? l.coup24 : l.coup;
const err24 = (w) => w.err24 != null ? w.err24 : w.err;
/* LA CONNEXION INTERNET DE LA MAISON (17/10/2026). Une box qui ne repond pas,
   ou de travers, laisse `wan` vide et le dit dans `problemes` (`boxMuette`) ;
   le debut d une coupure EN COURS se lit au journal, ou systeme.py ecrit un
   evenement quand `wan.ok` bascule (`debutCoupure`, en secondes, null sans
   coupure). Servent aux cartes Internet, Site et ntfy. */
const boxMuette = (d) => (d.problemes || []).some(p => /^(internet|wan) :/.test(p));
const debutCoupure = (d) => {
  const e = (d.journal || []).find(x => Array.isArray(x) && x[1] === "reseau"
                                       && /^Connexion Internet (coupée|rétablie)$/.test(x[2]));
  return e && /coupée$/.test(e[2]) ? e[0] : null;
};
const coupureDepuis = (d) => { const t = debutCoupure(d);
  return t == null ? null : anciennete(Math.max(0, Date.now() / 1000 - t)); };
// ⚠️ `ok` vaut 1 ou 0 (systeme.py), pas true ou false
const internetCoupe = (d) => (!!d.wan && !d.wan.ok) || debutCoupure(d) != null;
/* Au-dela, un ratio de tracker est tenu pour fige (meme seuil que `ratios.sh`). */
const RATIO_FIGE = 6 * 3600;

/* Separateur des raisons d une carte. Espace INSECABLE avant le point median :
   une raison qui passe a la ligne ne commence jamais par « · ». */
const SEP = "\u00a0· ";

/* Trackers dont le ratio FRAIS est sous le minimum qu ils exigent. */
const ratiosBas = (q) => { const now = Date.now() / 1000;
  return (q.tr || []).filter(x => { const v = x.vr, c = TRACKERS.seuils[x.n];
    return !!v && !v.inf && !!c && !!v.ts && now - v.ts <= RATIO_FIGE && +v.r < c; }); };

/* Lien local d une carte, d apres son port dans `site.js`. */
const go = (n) => `http://${IP}:${PORTS[n]}`;

/* ---- Reglages des cartes systeme -------------------------------- */
/* Sous ce regime, un ventilateur est considere comme arrete ou mourant. */
const VENTILO_MIN = 300;

/* Groupes de la carte « Memoire ». Le collecteur rend une CLE, la page la
   traduit : les noms parlent a l utilisateur, pas au systeme. */
const MEMOIRE = {
  conteneurs: ["Conteneurs", "", "#4d97ee"],
  systeme:    ["Services système", "", "#8a94a6"],
  photos:     ["Photos et IA", "", "#ff9f0a"],
  docker:     ["Moteur Docker", "", "#39c2d0"],
  cameras:    ["Caméras", "", "#c07bf0"],
  autres:     ["Autres", "sessions, base, divers", "#5b6170"],
};

/* Seuils du verdict de la carte « Memoire ». La PRESSION est la part du temps ou
   des programmes attendent de la memoire (moyenne sur 5 min) ; le zram, la part
   remplie du tiroir compresse ; le SSD, ce qui a deja deborde dessus, en Mo. */
const MEM_SEUILS = { pression: 1, pressionMax: 5, zram: .7, ssd: 100, dispo: .2, dispoMin: .05 };

/* Postes de place de la carte « Stockage », dans l ordre des barres. Un disque
   n affiche que les postes qu il porte : le collecteur rend ce qu il mesure. */
const ESPACE = {
  medias:  ["médias", "#4d97ee"],
  partages: ["partages", "#5ac8fa"],
  cameras: ["caméras", "#ff6482"],
  iscsi:   ["iSCSI", "#c07bf0"],
  docker:  ["Docker", "#39c2d0"],
  systeme: ["système", "#8a94a6"],
  applis:  ["applications", "#ff9f0a"],
  swap:    ["swap", "#bf5af2"],
  autres:  ["autres", "#5b6170"],
};
/* Nom d usage de chaque disque selon son role ; le modele passe en sous-titre. */
const ROLES = { donnees: "SSD données", systeme: "SSD système" };

/* Verdict de la carte « Memoire » : un mot et sa teinte. */
const etatMemoire = (m) => {
  const S = MEM_SEUILS, zf = m.zcap ? m.tasse / m.zcap : 0;
  if (m.psi5 >= S.pressionMax || m.dispo < m.tot * S.dispoMin) return ["Saturée", "cr"];
  if (m.psi5 >= S.pression || zf >= S.zram || m.ssd >= S.ssd || m.dispo < m.tot * S.dispo) return ["Juste", "wn"];
  return ["À l'aise", "ok"];
};

/* Certificats de tous les domaines publics (`certs`, collect.sh, 09/10/2026) :
   `j` jours restants, `v` duree de vie en jours, tous deux null si illisible.
   ⚠️ EN RETARD SOUS LE QUART DE SA DUREE DE VIE, et non sous un nombre de jours
   fixe : Caddy renouvelle au tiers, un certificat qui descend sous le quart a
   donc rate son renouvellement depuis des jours. La regle suit la duree de vie
   et tiendra quand les autorites raccourciront leurs certificats ; le plancher
   de 7 jours couvre une duree de vie absurde. Expire (`j` <= 0) : rouge. */
const etatCerts = (l) => {
  const c = Array.isArray(l) ? l : [];
  const retard = c.filter(x => x.j != null && x.j < Math.max(7, (x.v || 0) / 4));
  return { tous: c, retard, expires: retard.filter(x => x.j <= 0),
           illisibles: c.filter(x => x.j == null) };
};
/* Le moniteur UptimeRobot d un lien public (`ur`, collect.sh, 09/10/2026) :
   celui dont l hote sonde est celui du lien. C est la seule mesure prise HORS
   de la maison : le test du site par collect.sh part du NAS et n en sort pas.
   null sans cle, sans moniteur pour ce lien, ou quand le releve a plus d une
   heure : une vue perimee de l exterieur ne dit plus rien. */
const dehors = (d, lien) => {
  const u = d.ur;
  if (!u || !Array.isArray(u.m) || !lien || Date.now() / 1000 - (u.t || 0) > 3600) return null;
  /* Pendant une coupure d Internet de la maison, le releve date d AVANT elle
     (le NAS ne joint plus UptimeRobot) : il restait vert pendant la premiere
     heure (17/10/2026). La carte donne alors son age, sans couleur. */
  if (internetCoupe(d)) return null;
  const h = String(lien).replace(/^[a-z]+:\/\//, "").replace(/[/:?].*$/, "");
  return u.m.find(m => m.h === h) || null;
};
/* 8 « semble hors ligne » et 9 « hors ligne » chez UptimeRobot. */
const horsDehors = (m) => !!m && (m.s === 8 || m.s === 9);
/* Les pastilles « vu d Internet » : l etat et la disponibilite sur 30 jours en
   une seule, et une seconde PENDANT une coupure seulement (« coupé depuis… ») :
   la carte Site est etroite, l historique des coupures est dans le pourcentage
   et dans le journal. */
const pastDehors = (m) => {
  if (!m) return [];
  const pc = (v) => v >= 99.995 ? "100 %" : vg(v.toFixed(2)) + " %";
  const r30 = (m.r || [])[2];
  const b = m.b && Date.now() / 1000 - m.b.t < 7 * 86400 ? m.b : null;
  // UptimeRobot : 0 en pause, 1 pas encore sonde (« en pause » avant le 17/10/2026), 2 en ligne
  const etat = horsDehors(m) ? "injoignable vu d'Internet" : m.s === 2 ? "vu d'Internet"
    : m.s === 1 ? "vu d'Internet : premier contrôle en attente" : "vu d'Internet : en pause";
  return [[etat + (r30 != null ? " · " + pc(r30) + " sur 30 j" : ""),
           horsDehors(m) || (r30 != null && r30 < 99.5) ? "wn" : m.s === 2 ? "ok" : ""],
          b && horsDehors(m) ? ["coupé depuis " + duree((Date.now() / 1000 - b.t) / 60), "wn"] : null];
};

/* Le sous-domaine suffit dans une ligne de controle : « vault », pas
   « vault.example.com ». Le domaine nu reste entier. */
const hoteCourt = (h) => { const p = String(h).split("."); return p.length > 2 ? p[0] : h; };
/* Les lignes de la carte Securite : une seule quand tout va bien, une par
   probleme sinon. */
const lignesCerts = (l) => {
  const c = etatCerts(l);
  if (!c.tous.length) return [];
  const noms = (a) => a.map(x => hoteCourt(x.h)).slice(0, 3).join(", ") + (a.length > 3 ? "…" : "");
  const r = [], proches = c.retard.filter(x => x.j > 0);
  if (c.expires.length === 1) r.push(["wn", "Certificat de " + hoteCourt(c.expires[0].h) + " expiré", "domaine inaccessible"]);
  else if (c.expires.length) r.push(["wn", pluriel(c.expires.length, "certificat expiré", "certificats expirés"), noms(c.expires)]);
  if (proches.length === 1)
    r.push(["wn", "Certificat de " + hoteCourt(proches[0].h) + " : expire dans " + pluriel(proches[0].j, "jour"),
            "renouvellement en échec"]);
  else if (proches.length)
    r.push(["wn", pluriel(proches.length, "certificat", "certificats") + " bientôt expirés", noms(proches)]);
  if (c.illisibles.length)
    r.push(["wn", pluriel(c.illisibles.length, "certificat illisible", "certificats illisibles"), noms(c.illisibles)]);
  if (!r.length) {
    const min = Math.min(...c.tous.map(x => x.j));
    r.push(["ok", "Certificats : " + pluriel(c.tous.length, "domaine", "domaines") + " à jour",
            "échéance la plus proche : " + pluriel(min, "jour")]);
  }
  return r;
};

/* ---- Tailles et niveaux (bento, 13/10/2026) ---------------------------
   Chaque carte declare sa CATEGORIE (`taille`) et son `niveau`. Elle peut
   corriger une valeur de sa categorie avec `ajuste` (ex. `{ min: 600 }`).
     min  largeur minimale en PIXELS : en dessous, le contenu ne tient plus.
          En pixels et non en modules : le module change de taille selon
          l ecran, le contenu, lui, a besoin d une largeur reelle.
     l    largeur ideale, en modules (12 modules sur 1 160 px, soit 86 px).
     max  largeur maximale, en modules, quand il faut boucher un trou.
     h    hauteur [min, ideale, max], en DEMI-RANGEES de 44 px (+ 12 px
          d espace) : 2 font 100 px, 4 font 212, 6 font 324, 8 font 436.
     formes  (17/10/2026) TOUTES les hauteurs ou la carte s affiche bien, chacune
          avec sa plage de largeurs EN PIXELS : `{ 5: [210, 400] }` = a 5
          demi-rangees, de 210 a 400 px. Une carte plus haute peut etre plus
          etroite (son contenu passe a la ligne) : le rangement a plus de
          formes pour boucher les trous. Mesurees par l atelier sur tous les
          scenarios (pire contenu). Le rangement ne garde ensuite que celles
          ou le contenu DU MOMENT tient sans laisser la carte vide.
   Niveaux : une carte « essentielle » passe en premier et garde sa taille
   ideale ; les « secondaires » s etirent pour boucher les trous.
   ⚠️ Valeurs de depart, a verifier dans l atelier (index.html?atelier). */
const TAILLES = {
  lien:      { min: 180, l: 6,  max: 8,  h: [2, 2, 3] },
  petite:    { min: 220, l: 3,  max: 4,  h: [4, 4, 5] },
  moyenne:   { min: 300, l: 6,  max: 8,  h: [4, 4, 6] },
  graphique: { min: 340, l: 6,  max: 8,  h: [6, 7, 8] },
  large:     { min: 560, l: 12, max: 12, h: [4, 5, 6] },
};
const NIVEAUX = ["essentielle", "normale", "secondaire"];
/** Taille d une carte : celle de sa categorie, corrigee par `ajuste`.
 *  `formes` en sort complete : pour CHAQUE hauteur permise, `{ min, max }`
 *  (min et max en px) ; `h` devient [plus basse, ideale, plus haute] et `min`
 *  celui de la hauteur ideale. */
const tailleDe = (s, sansRel) => {
  // Sans releve : jamais plus etroite que la forme la plus etroite de la carte,
  // dont l en-tete (adresse, selecteur « 24 h · 7 j ») reste le meme.
  const t = sansRel
    ? { ...SANS_RELEVE, min: Math.max(SANS_RELEVE.min, Math.min(...Object.values(tailleDe(s).formes).map((x) => x.min))) }
    : { ...TAILLES[s.taille] || TAILLES.moyenne, ...s.ajuste };
  // sans `formes`, le rectangle de la categorie ; son max en modules devient
  // des pixels au plus grand module (113 px), pour ne rien retirer
  const f = {}, enPx = (m) => m * 113 + (m - 1) * 12;
  const fo = sansRel ? null : (s.ajuste || {}).formes;
  if (fo) for (const [h, [min, max]] of Object.entries(fo)) f[h] = { min, max };
  else for (let h = t.h[0]; h <= t.h[2]; h++) f[h] = { min: t.min, max: enPx(t.max) };
  const hs = Object.keys(f).map(Number).sort((a, b) => a - b);
  return { ...t, min: (f[t.h[1]] || f[hs[0]]).min, h: [hs[0], t.h[1], hs[hs.length - 1]], formes: f };
};
/* SANS RELEVE (17/10/2026) : une carte reduite a une phrase (« Relevé de … en
   attente », ou « … ne répond pas » d un service muet) gardait la taille pleine
   de ses donnees et paraissait disproportionnee. Elle prend alors cette petite
   tuile, `tailleDe(s, true)`. Le service muet aussi (choix retenu, 17/10) :
   il reste une alerte, en tete de son groupe, mais en petit. */
const SANS_RELEVE = { min: 220, l: 3, max: 4, h: [3, 3, 3] };
/** Vrai si la carte rendue `el` n affiche qu une phrase (releve absent, service muet). */
const sansReleve = (el) => !!el.querySelector(".vizb > .note:only-child");

/* ---- GROUPS ----------------------------------------------------- */
const GROUPS = [
  { n: "Portfolio", i: "briefcase", s: [
    /* La carte affichait deux nombres dont aucun ne demandait jamais rien. Caddy
       renouvelle le certificat au tiers de sa vie restante : la valeur oscille
       eternellement entre 90 et 30 jours et ne peut approcher le seuil de 15 sans
       que le renouvellement soit deja casse depuis deux semaines. Le temps de
       reponse, lui, etait mesure chaque minute et JAMAIS conserve — un
       echantillon nu, ni comparable ni jugeable.

       Elle dit desormais si le site a ete JOIGNABLE, seule question qui compte
       pour une vitrine, avec la DUREE EXACTE de coupure sur sept jours.

       ⚠️ RUBAN RETIRE quatre jours apres son ajout. Il n a jamais affiche autre
       chose que du vert, et la pastille dit mieux ce qu il montrait moins bien.
       Il souffrait en outre de `.vizb > .batt { flex: 1 1 auto }`, regle pensee
       pour les composants qui gagnent a s etendre : sa hauteur etait SUBIE, d ou
       24 px de vert plein sur une carte large et ZERO PIXEL des que les pastilles
       passaient sur deux lignes.
       ℹ️ Le ruban du VPN reste : lui montre de vraies coupures. La difference
       n est pas le composant, c est d avoir quelque chose a montrer.

       ⚠️ LA SONDE PART DU NAS. Elle atteste que Caddy sert le site, pas qu un
       visiteur y arrive : une redirection de port cassee sur la box resterait
       invisible ici. C est une limite du poste d observation, pas de la mesure.

       ⚠️ Un bloc qui grandit puis un bloc colle en bas : `.vizb` distribue son
       espace libre par `margin-top: auto`, et deux blocs qui le reclament se le
       partageraient en creusant un trou au milieu. */
    /* Tailles mesurees le 16/10/2026 (pire etat : panne vue d Internet, quatre
       pastilles) : 350 px avec l en-tete compact (bento/portfolio.css). Le
       contenu ne grandit pas : a 5 demi-rangees, 39 % de vide. */
    { n: "Site", taille: "petite", niveau: "normale", ajuste: { min: 350, l: 4, max: 5, h: [4, 4, 4], formes: { 4: [320, 613], 5: [220, 613], 6: [220, 300] } }, d: "Vitrine freelance", x: LIENS["Site"], ic: "portfolio",
      r: d => {
        const s = d.site || {};
        const ms = Hn(d, "site").filter(v => v > 0);
        const sem = Hs(d, "siteup");
        const hs = sem.filter(v => v > 0).length;      // heures reellement mesurees
        const ko = coupure(sem, 60);
        const med = Math.round(mediane(ms));
        const pic = ms.length ? Math.round(Math.max(...ms)) : 0;
        // Tant que l historique est court, le bilan dit SUR QUOI il porte
        // plutot que de laisser croire a une semaine sans incident.
        const bilan = hs === 0 ? ["relevé de joignabilité en cours"]
          : [(ko > 0 ? "indisponible " + duree(ko) : "aucune coupure")
             + (hs >= 160 ? " sur 7 j" : " depuis " + hs + " h"),
             ko > 0 ? "wn" : "ok"];
        // Releve du site absent : le dire, plutot qu un « 0 ms » invente.
        const vu = s.ok != null && (s.ok === false || s.ms != null);
        /* Releve d UptimeRobot trop vieux (coupure d Internet de la maison) :
           son age, comme la carte ntfy, au lieu d une pastille qui disparait. */
        const m = dehors(d, LIENS["Site"]), u = d.ur || {};
        const hote = String(LIENS["Site"] || "").replace(/^[a-z]+:\/\//, "").replace(/[/:?].*$/, "");
        const vieux = !m && u.t && (u.m || []).some(x => x.h === hote)
          ? ["vu d'Internet : relevé il y a " + anciennete(Math.max(0, Date.now() / 1000 - u.t))] : null;
        return (s.ok === false
                 ? hero("injoignable", "le site ne répond pas", "cr")
                 : vu ? hero((s.ms || 0) + " ms", "de temps de réponse")
                 : hero("—", "relevé du site en attente"))
          /* ⚠️ TROIS PASTILLES AU PLUS (09/10/2026) : la carte etroite en
             portait six. Mediane et pointe sur une seule ; le CERTIFICAT est
             parti dans la carte Securite, qui suit les huit domaines avec un
             seuil plus juste (et un certificat proche de sa fin allumait les
             deux cartes pour un seul probleme) ; la derniere coupure vue
             d Internet ne s affiche que pendant la coupure (`pastDehors`). */
          + past([bilan,
                  med ? ["médiane " + med + " ms" + (pic ? SEP + "pointe " + pic + " ms" : ""),
                         pic >= 1000 ? "wn" : ""] : null,
                  /* Vu d Internet par UptimeRobot (09/10/2026) : le temps de
                     reponse ci-dessus est mesure depuis le NAS. */
                  ...pastDehors(m), vieux]);
      },
      /* Injoignable : la vitrine est hors service, c est ROUGE. Injoignable VU
         D INTERNET seulement (box, DNS, redirection de port) : ambre, le NAS le
         sert encore mais plus personne dehors ne l atteint. */
      warn: d => (d.site || {}).ok === false ? "crit" : horsDehors(dehors(d, LIENS["Site"])),
      pourquoi: d => (d.site || {}).ok === false ? "le site ne répond pas" : "injoignable vu d'Internet" },
    /* Tailles mesurees le 16/10/2026 (pire etat : 999 leads, 1234 recus,
       « il y a 365 j ») : 240 px. A 5 demi-rangees, 42 % de vide. */
    { n: "CRM", taille: "petite", niveau: "essentielle", ajuste: { min: 240, h: [4, 4, 4], formes: { 4: [220, 488], 5: [180, 488], 6: [180, 200] } }, ko: "crm", d: "Suivi des leads et prospects", x: LIENS["CRM"], ic: "crm",
      r: d => { const c = d.crm || {};
        // Releve absent ou nul : le dire, plutot que « undefined lead non lu ».
        if (typeof d.leads !== "number") return `<div class="note">Relevé du CRM en attente</div>`;
        return hero(d.leads, (d.leads > 1 ? "leads non lus" : "lead non lu") + "<br>en attente de réponse", d.leads > 0 ? "ta" : "")
          // Sans le detail (`crm`), pas de pastilles a zero inventees.
          + (d.crm ? past([[(c.tot || 0) + " reçus"], [(c.traites || 0) + " traités"],
                  [c.age > 0 ? "il y a " + c.age + " j" : c.age === 0 ? "aujourd'hui" : "—"]]) : ""); },
      warn: d => d.leads > 0,
      pourquoi: d => pluriel(d.leads, "lead non lu", "leads non lus") },
    /* Tailles mesurees le 16/10/2026 : 163 px de contenu, sept barres de
       180 x 40 px et non un graphe qui grandit, d ou `petite` et non plus
       `graphique` (7 demi-rangees laissaient 234 px vides). 330 px : 4 chiffres
       de visiteurs a cote de barres encore lisibles (140 px). */
    { n: "Statistiques", taille: "petite", niveau: "normale", ajuste: { min: 330, l: 4, max: 5, h: [4, 4, 4], formes: { 4: [260, 613], 5: [220, 613], 6: [220, 240] } }, ko: "umami", d: "Fréquentation du portfolio", u: go("Statistiques"),
      x: LIENS["Statistiques"], ic: "stats", w: 2,
      r: d => { const u = d.umami;
        // Releve absent ou nul : le dire, plutot que « Donnees illisibles » ou « null visiteurs ».
        if (!u || u.visitors == null) return `<div class="note">Relevé d'Umami en attente</div>`;
        return `<div class="stat7"><div class="s7n"><b>${esc(u.visitors)}</b>`
            + `<span>visiteurs<br>sur 7 jours</span></div>`
            + jours(u.serie) + `</div>`
            + past([u.visits != null && [u.visits + " visites"], u.views != null && [u.views + " pages vues"]]); } },
  ]},
  { n: "Médiathèque", i: "play", s: [
    /* min 310 : trois lectures dont un long titre tiennent des 301 px ; h 4 seule : a 5, 54 % de vide. */
    { n: "Jellyfin", taille: "moyenne", niveau: "essentielle", ajuste: { min: 310, h: [4, 4, 4], formes: { 4: [280, 988], 5: [240, 988], 6: [240, 260] } }, ko: "jellyfin", d: "Films, séries et animés", u: go("Jellyfin"),
      x: LIENS["Jellyfin"], ic: "jellyfin", w: 2,
      /* Sans releve, une note plutot que « Donnees illisibles » ou « undefined films ». */
      r: d => { const j = d.jellyfin || {};
        if (j.films == null) return `<div class="note">Relevé de Jellyfin en attente</div>`;
        const n = [[j.films, "film"], [j.series, "série"], [j.episodes, "épisode"]];
        /* Plusieurs lectures (collecteur : « A · B ») : une ligne chacune, lisible d un coup d oeil. */
        return j.now
            ? calme("<b>" + String(j.now).split(" · ").map(esc).join("<br>") + "</b>", "bl")
              + past(n.map(([v, t]) => v != null && [pluriel(v, t)]))
            : mesures(n.map(([v, t]) => [v != null ? nb(v) : "—", v != null && Math.abs(v) <= 1 ? t : t + "s"]))
              + `<div class="note">Aucune lecture en cours</div>`; } },
    /* `petite` comme Radarr : a 6 modules, 36 a 48 % de vide en largeur. h 3 : nombre a cote du libelle (feuille). */
    { n: "Seerr", taille: "petite", niveau: "normale", ajuste: { min: 250, h: [3, 4, 4], formes: { 3: [250, 488], 4: [250, 488] } }, ko: "seerr", d: "Demandes de la famille", u: go("Seerr"),
      x: LIENS["Seerr"], ic: "seerr", w: 2,
      /* Sans releve, une note plutot que « Aucune demande en attente » ou « Donnees illisibles ». */
      r: d => { const s = d.seerr || {};
        if (s.pending == null) return `<div class="note">Relevé de Seerr en attente</div>`;
        return (s.pending > 0
            ? hero(nb(s.pending), (s.pending > 1 ? "demandes" : "demande") + "<br>en attente", "ta")
            : calme("<b>Aucune demande en attente</b>"))
            + (s.done != null ? past([[pluriel(s.done, "complétée"), s.pending > 0 ? "" : "ok"]]) : ""); },
      warn: d => d.seerr.pending > 0,
      pourquoi: d => pluriel(d.seerr.pending, "demande") },
    /* Tuile de 3 modules et non bandeau : en ligne, il faut 925 px pour 66 % de vide. */
    { n: "FanKarr", taille: "lien", niveau: "secondaire", ajuste: { min: 300, l: 3, max: 3, h: [2, 2, 2], formes: { 2: [300, 363], 3: [240, 280] } }, d: "Catalogue FanKai", u: go("FanKarr"), x: LIENS["FanKarr"],
      ic: "fankarr.ico", mini: 1, w: 4,
      /* Ce que FanKarr a telecharge (06/10/2026, demande : « des
         pastilles comme Sonarr et Radarr »), lu par systeme.py dans ses fichiers
         de suivi. LES DEUX MEMES que Sonarr et Radarr, en cours et place prise :
         le nombre d episodes, la serie suivie et le dernier import ont ete
         essayes puis retires a sa demande. Le collecteur les fournit toujours.
         ⚠️ Aucune alerte : FanKarr ne signale ni manque ni echec exploitable. */
      r: d => { const f = d.fankarr;
        if (!f) return `<div class="note">Relevé de FanKarr en attente</div>`;
        /* Comme Radarr : place effacee a zero (fichiers introuvables), en Tio au-dela d un. */
        return past([[f.cours ? nb(f.cours) + " en téléchargement" : "aucun téléchargement"],
                     f.o > 0 ? [vol(f.o)] : null]);
      } },
  ]},
];

GROUPS.push(
  { n: "Téléchargement", i: "down", s: [
    /* La carte affichait « 51,6 % de requetes abouties », rapport captures /
       requetes CUMULE depuis toujours : il bougeait d un centieme de point par
       jour, et c etait en outre une moyenne trompeuse — 52 % etait la moyenne de
       100 %, 37 % et 33 %, elle ne decrivait aucun des trois indexeurs.
       Surtout, la carte n avait AUCUNE condition d alerte alors qu elle surveille
       la brique dont tout depend : si un tracker tombe, Radarr et Sonarr cessent
       silencieusement de trouver quoi que ce soit.

       ⚠️ `/health` est la source d alerte, et Prowlarr la remplit lui-meme quand
       un indexeur devient indisponible apres trop d echecs. Un indexeur desactive
       A LA MAIN n y figure pas : c est un choix, pas une panne.
       ⚠️ Les echecs cumules ne colorent rien : un compteur qui ne redescend jamais
       allumerait une pastille ambre a vie.

       Les captures par indexeur remplacent le pourcentage — elles bougent tous
       les jours et disent quelle source alimente reellement la bibliotheque. */
    /* h [4,4,4] : a 5 demi-rangees, le contenu calme laisse 60 % de vide. */
    { n: "Prowlarr", taille: "petite", niveau: "secondaire", ajuste: { h: [4, 4, 4], formes: { 4: [200, 488], 5: [160, 488], 6: [140, 180], 7: [140, 140] } }, ko: "prowlarr", d: "Indexeurs et trackers", u: go("Prowlarr"), ic: "prowlarr",
      r: d => {
        const p = d.prowlarr || {};
        const ix = p.ix || [];
        const ko = p.sante || 0;
        const tot = ix.reduce((a, x) => a + (+x.g || 0), 0);
        return (ko > 0
              ? hero(ko, "problème" + (ko > 1 ? "s" : "") + " signalé"
                        + (ko > 1 ? "s" : "") + "<br>par Prowlarr", "wn")
              : ix.length
                ? calme("<b>" + pluriel(ix.length, "indexeur actif", "indexeurs actifs") + "</b> — "
                        + nb(tot) + " captures")
                : `<div class="note">Prowlarr ne répond pas</div>`)
          /* Au-dela de cinq indexeurs, les quatre qui capturent le plus et le
             reste en nombre : la carte est etroite. */
          + past(ko > 0 && p.msg
                 ? [[prowlarrFr(p.msg), "wn"]]
                 : (ix.length > 5 ? ix.slice().sort((a, b) => (+b.g || 0) - (+a.g || 0)).slice(0, 4) : ix)
                     .map(x => [x.n + " " + nb(x.g)])
                     .concat(ix.length > 5 ? [["+ " + (ix.length - 4)]] : []));
      },
      warn: d => ((d.prowlarr || {}).sante || 0) > 0
              || !(((d.prowlarr || {}).ix) || []).length,
      pourquoi: d => { const p = d.prowlarr || {};
        if (!(p.ix || []).length) return "aucun indexeur actif";
        return p.msg ? prowlarrFr(p.msg) : pluriel(p.sante, "problème signalé", "problèmes signalés"); } },
    /* h [4,4,4] pour Radarr et Sonarr : a 5 demi-rangees, 42 % de vide. */
    { n: "Radarr", taille: "petite", niveau: "normale", ajuste: { h: [4, 4, 4], formes: { 4: [220, 488], 5: [160, 488], 6: [140, 200], 7: [140, 140] } }, ko: "radarr", d: "Films — recherche et import", u: go("Radarr"), ic: "radarr",
      /* Sans releve, une note plutot que « Aucun film manquant » ; la place
         prise s efface a zero (requete en echec) et passe en Tio au-dela d un. */
      r: d => { const x = d.radarr || {};
        if (x.mis == null) return `<div class="note">Relevé de Radarr en attente</div>`;
        return (x.mis > 0
            ? hero(x.mis, (x.mis > 1 ? "films manquants" : "film manquant") + "<br>à retrouver", "ta")
            : calme("<b>Aucun film manquant</b>"))
            + past([[x.q ? nb(x.q) + " en téléchargement" : "aucun téléchargement"],
                    x.size > 0 ? [vol(x.size)] : null]); },
      warn: d => d.radarr.mis > 0,
      pourquoi: d => pluriel(d.radarr.mis, "film manquant", "films manquants") },
    { n: "Sonarr", taille: "petite", niveau: "normale", ajuste: { h: [4, 4, 4], formes: { 4: [220, 488], 5: [160, 488], 6: [140, 200], 7: [140, 140] } }, ko: "sonarr", d: "Séries — recherche et import", u: go("Sonarr"), ic: "sonarr",
      /* Memes cas que Radarr. */
      r: d => { const x = d.sonarr || {};
        if (x.mis == null) return `<div class="note">Relevé de Sonarr en attente</div>`;
        return (x.mis > 0
            ? hero(x.mis, (x.mis > 1 ? "épisodes manquants" : "épisode manquant") + "<br>à retrouver", "ta")
            : calme("<b>Aucun épisode manquant</b>"))
            + past([[x.q ? nb(x.q) + " en téléchargement" : "aucun téléchargement"],
                    x.size > 0 ? [vol(x.size)] : null]); },
      warn: d => d.sonarr.mis > 0,
      pourquoi: d => pluriel(d.sonarr.mis, "épisode manquant", "épisodes manquants") },
    /* Contenu court : tient des 173 px (min 180) ; a 4 modules, 35 % de vide
       a cote du nombre (max 3) ; a 5 demi-rangees, 42 % de vide (h max 4). */
    { n: "Bazarr", taille: "petite", niveau: "secondaire", ajuste: { min: 180, max: 3, h: [4, 4, 4], formes: { 4: [180, 363], 5: [140, 363], 6: [140, 160] } }, ko: "bazarr", d: "Sous-titres français", u: go("Bazarr"), ic: "bazarr",
      /* Sans releve, une note plutot que « Tout est sous-titré ». */
      r: d => { const b = d.bazarr || {};
        if (b.ep == null && b.mv == null) return `<div class="note">Relevé de Bazarr en attente</div>`;
        const ep = +b.ep || 0, mv = +b.mv || 0;
        return ep + mv > 0
            ? hero(ep + mv, (ep + mv > 1 ? "médias" : "média") + "<br>sans sous-titre", "ta")
              + past([[pluriel(ep, "épisode")], [pluriel(mv, "film")]])
            : calme("<b>Tout est sous-titré</b> — 0 film, 0 épisode en attente"); },
      warn: d => d.bazarr.ep + d.bazarr.mv > 0,
      pourquoi: d => nb(d.bazarr.ep + d.bazarr.mv) + " sans sous-titre" },
    /* La carte repond a quatre questions et delegue le detail a sa fenetre.

       EST-CE QUE CA MARCHE. Le bandeau porte `connection_status`.
       ⚠️ `firewalled` est le cas vicieux : le client fonctionne, telecharge,
       n affiche aucune erreur, mais son port entrant est injoignable. Plus
       personne ne peut rien lui demander et le ratio cesse de monter sans que
       rien n ait l air casse. C est la SEULE condition d alerte de la carte.

       QU EST-CE QUI SE PASSE. Les deux debits en direct et leur historique.
       ⚠️ Pas de `d0` sur ces series : zero est une valeur LEGITIME pour un debit,
       il signifie que rien ne transitait, et l option masquerait de vraies
       mesures.

       OU EN EST LE RATIO, VRAIMENT. Une jauge par tracker, et le chiffre vient du
       COMPTE chez le tracker, pas de qBittorrent.
       ⚠️ Le ratio du client est FAUX pour cet usage, pas imprecis : il annoncait
       0,24 / 0,59 / 0,00 quand les comptes disaient l infini, 2,39 et 1,59. Deux
       causes — le freeleech, compte par le client et pas par les trackers, et
       `alltime_dl` qui porte des mois de torrents depuis supprimes.
       ⚠️ Altair n a JAMAIS rien telecharge : son ratio est indefini, pas enorme.
       D ou le symbole de l infini plutot qu un 999 ou un 0, qui mentiraient dans
       des directions opposees.
       ⚠️ La cible de 1,0 est une convention personnelle, sans source. Seul Vega
       publie un seuil, 0,80, et c est le sien qui le juge.

       COMBIEN, ET QUELLE TAILLE. La derniere pastille ; la repartition par
       categorie vit dans la fenetre, ou elle a la place de signifier quelque
       chose. */
    /* `graphique` : le trace garde ses proportions, la carte grandit avec sa
       largeur (336 px de contenu a 612, 375 a 750). min 570 : graduations a
       9 px ; max 6 : a 7 modules d une tablette (863 px), 7 demi-rangees ne
       suffisent plus ; h max 8 pour le telephone (384 a 424 px empile), au
       prix de 34 % de vide a 6 modules. 17/10 : 7 demi-rangees retirees
       (choix retenu apres revue), la carte fait toujours 8 demi-rangees. */
    { n: "qBittorrent", taille: "graphique", niveau: "essentielle", ajuste: { min: 570, max: 6, h: [8, 8, 8], formes: { 7: [360, 988], 8: [360, 988], 9: [360, 988], 10: [360, 988], 11: [360, 988] } }, d: "Client torrent, sous VPN", u: go("qBittorrent"), ic: "qbittorrent",
      w: 2, per: 1,
      r: d => {
        const q = d.qbit || {};
        const INCONNU = ["État inconnu", "qBittorrent n'a pas répondu", 0];
        const E = {
          connected: [pluriel(q.pairs || 0, "pair connecté", "pairs connectés"),
                      "connexion établie · port entrant joignable", 1],
          firewalled: ["Port entrant injoignable",
                       "le client tourne, mais plus personne ne peut lui demander", 0],
          disconnected: ["Hors ligne", "qBittorrent n'atteint pas le réseau", 0],
        }[q.etat] || INCONNU;

        /* GRAPHE ET NON PLUS SILHOUETTE depuis le 09/10/2026 :
           la silhouette sans axe d avant ne se lisait pas comme les graphes
           des cartes Systeme et Temperatures. Voir `act` plus bas. */
        const ul = Hn(d, "qbul"), dl = Hn(d, "qbdl");
          /* ⚠️ `ul` et `dl` RESTENT grossiers : `envoye` multiplie leur somme
             par 600, la duree d un creneau de 10 min. Lus fins sans changer
             ce facteur, ils annonceraient dix fois trop de volume. */
          const ulf = Hf(d, "qbul"), dlf = Hf(d, "qbdl");
        const pic = Math.max(0, ...ulf, ...dlf);

        /* Volume envoye sur la periode de l historique. Les valeurs sont des DEBITS
           moyens par creneau de 600 s : leur somme multipliee par la duree du
           creneau donne des octets.
           C est une estimation — un debit releve deux fois par minute ne voit pas
           les rafales qui passent entre deux mesures — mais elle a un avantage
           decisif sur le compteur de session de qBittorrent : elle NE SE REMET PAS
           A ZERO au redemarrage du conteneur. Une fenetre de 24 h fixe se compare
           d un jour a l autre, une fenetre « depuis le demarrage » ne se compare a
           rien. Sous-estime le premier jour, comme tout ce qui lit l historique. */
        const envoye = ul.reduce((a, b) => a + b, 0) * 600;
        /* Le graphe des cartes Systeme et Temperatures (09/10/2026) : echelle chiffree, reperes, heures. Une heure sur trois
           comme les autres graphes (09/10/2026, il y en avait une sur six). */
        const act = ulf.length > 1 || dlf.length > 1
          ? graphe([{ v: Hp(d, "qBittorrent", "qbdl"), c: "#4d97ee", n: "reçu" },
                    { v: Hp(d, "qBittorrent", "qbul"), c: "#34c759", n: "envoyé" }],
                   { f: MoAxe, u: "dbt", ts: Hp(d, "qBittorrent", "t"),
                     alt: "Activité de qBittorrent " + surP("qBittorrent") })
          : `<div class="note">Activité en cours d'enregistrement</div>`;

        /* UN RATIO EST UNE COMPARAISON DE DEUX VOLUMES, autant la dessiner
           telle quelle. Les deux barres partagent l echelle du plus grand
           des deux : celle du haut devient la cible, celle du bas la
           position, et le vide qui les separe est EXACTEMENT ce qu il reste
           a envoyer. Aucune legende n est necessaire, la ou « 45 % »
           demandait de savoir 45 % de quoi. */
        /* UNE SEULE BARRE. La premiere version en dessinait deux, « recu » au-dessus
           de « envoye » — mais celle du haut servait de reference : pleine PAR
           CONSTRUCTION, cent pour cent en permanence, elle repetait ce que la
           piste vide de celle du bas montrait deja.
           Ici la PISTE ENTIERE est le volume recu, le rempli est le volume envoye,
           et le vide entre les deux est exactement le deficit. Le ratio n est plus
           un pourcentage abstrait, c est une longueur.
           ⚠️ `pc()` borne a 100 mais n arrondit pas : sans le dixieme, la largeur
           part dans le DOM sous la forme « 45.48428578046771% ». Le bornage sert
           le jour ou le ratio depasse 1,0 : la barre est alors pleine, ce qui est
           la bonne lecture. */
        /* LE RATIO EST CELUI DU TRACKER, releve chez lui par `ratios.sh` une fois par
           heure ; `collect.sh` ne fait que joindre le fichier.
           ⚠️ Trois cas, trois ecritures : un nombre compare a son seuil ; le
           symbole de l INFINI quand le tracker n a jamais rien distribue, faute de
           denominateur ; un tiret quand le releve a echoue sans qu aucune valeur
           anterieure n existe. Aucun des trois ne doit devenir un zero, qui se
           lirait comme un compte en faute.
           ⚠️ L age n apparait qu au-dela de trois heures. En dessous c est du
           bruit ; au-dela c est l information principale, car un cookie de session
           expire sans prevenir et un chiffre mort ne doit pas passer pour frais. */
        const AGE = 3 * 3600;
        const SEUIL = TRACKERS.seuils;
        /* Ordre d affichage, du tracker le plus suivi au moins suivi (`site.js`).
           ⚠️ CE N EST PAS L ORDRE ALPHABETIQUE : il classe sur une initiale, ce
           qui ne veut rien dire pour qui lit la carte. Un tracker absent de cette
           liste passe APRES, par ordre alphabetique — il apparait donc quand
           meme, au lieu de disparaitre ou de squatter la premiere place. */
        const ORDRE = TRACKERS.ordre;
        const rang = (x) => { const k = ORDRE.indexOf(x); return k < 0 ? ORDRE.length : k; };
        /* NI JAUGE NI BARRE, ET C EST VOULU. Une barre a besoin d une reference ; les
           trois ratios depassent la leur, donc les trois barres restaient pleines
           en permanence. La question posee est binaire — ce ratio est-il bon — et
           c est la COULEUR du nombre qui y repond.
           ⚠️ Le NOM passe devant, en taille lisible. Relegue dans l etiquette de
           la jauge, il se noyait dans « MINIMUM 0,80 · RELEVE IL Y A 10 H 41 »,
           soit l inverse de ce qu on cherche en premier.
           ⚠️ L age REMPLACE le qualificatif au lieu de s y ajouter : les deux cote
           a cote faisaient passer la ligne sur deux hauteurs, et un releve perime
           rend son seuil accessoire. */
        const lig = (n, v, cl, q, a) => `<div class="trk" data-lec="ratio" data-q="${esc(q)}"><span class="n">${esc(n)}</span>`
          + `<b${cl ? ` class="${cl}"` : ""}>${esc(v)}</b>`
          + (a ? `<small class="age">${esc(a)}</small>` : "")
          + `</div>`;
        const trk = (t) => {
          const v = t.vr;
          if (!v) return lig(t.n, "—", "", "pas de relevé");
          const age = v.ts ? Math.max(0, Math.floor(Date.now() / 1000) - v.ts) : 0;
          const vu = age > AGE ? "relevé il y a " + duree(age / 60) : "";
          /* ⚠️ AU-DELA DE 6 H, LA VALEUR EST GRISEE ET SON AGE ECRIT (08/10/2026).
             Un tracker est reste « 159,30 » en vert pendant plus d une semaine, serveur
             du tracker en panne : l age n etait que dans l infobulle, invisible au
             doigt. 6 h comme l alerte de fraicheur de `ratios.sh`. */
          if (age > RATIO_FIGE) return lig(t.n, v.inf ? "∞" : vg((+v.r).toFixed(2)), "vieux",
            "relevé il y a " + anciennete(age) + " · valeur figée", "il y a " + anciennete(age));
          if (v.inf) return lig(t.n, "∞", "ok inf",
            vu || vol(v.up || 0) + " envoyés, rien reçu");
          const c = SEUIL[t.n] || 1;
          /* Les volumes du tracker accompagnent la reference dans l infobulle :
             un ratio se lit mieux avec ce qu il divise. */
          const vols = (v.up != null && v.down != null)
            ? vol(v.up) + " envoyés, " + vol(v.down) + " reçus" : "";
          const ref = SEUIL[t.n] ? "minimum " + vg(c.toFixed(2))
                                 : "cible " + vg(c.toFixed(2));
          return lig(t.n, vg((+v.r).toFixed(2)), v.r >= c ? "ok" : "wn",
            vu || (vols ? vols + " · " + ref : ref));
        };
        /* ⚠️ LES TRACKERS PUBLICS SONT ECARTES (09/10/2026) : sans compte, ils
           n ont aucun ratio a relever et s affichaient en « — », deux a quatre
           selon la passe, ce qui faisait varier la hauteur de la carte. Reste
           un tracker suivi (`site.js`) ou qui a un releve. */
        const trs = (q.tr || []).filter(t => t.vr || ORDRE.includes(t.n))
          .sort((a, b) => rang(a.n) - rang(b.n)
                         || (a.n || "").localeCompare(b.n || ""));
        return etatv(E[0], E[1], !!E[2])
          + `<div class="duo tro"><div>`
            + `<div class="trkh">Activité ${surP("qBittorrent")}</div>`
            /* Client muet : les collecteurs ecrivent 0, la legende tait le debit
               plutot que d afficher un faux « 0 Kio/s ». */
            + leg([["envoi", "#34c759", E !== INCONNU ? Mo(q.ul || 0) : null],
                   ["réception", "#4d97ee", E !== INCONNU ? Mo(q.dl || 0) : null]])
            + act
          + `</div><div>`
            + (trs.length ? `<div class="trkh">Ratio chez les trackers</div>`
                          + `<div class="trks">` + trs.map(trk).join("") + `</div>`
                          : `<div class="note">Aucun tracker relevé</div>`)
          + `</div></div>`
          /* Quatre pastilles au plus, chacune disparaissant quand elle n a rien a
             dire. Deux decrivent la silhouette qui les surplombe, son volume et
             son plafond ; la derniere combien de torrents les portent.
             La premiere est la DETTE DE PARTAGE : le nombre de torrents arretes
             avant d avoir rendu leurs trois jours. Quatre l ont ete par une
             extinction du conteneur et personne ne l a signale pendant huit jours
             — ni Radarr ni Sonarr, dont les files etaient vides, ni cette carte,
             qui ne comptait que les torrents.
             ⚠️ `pic` est le plafond du TRACE, donc le maximum des deux series
             confondues : le point le plus haut du dessin, sans quoi la silhouette
             n aurait aucune echelle.
             ⚠️ Le compte s efface a zero plutot que d afficher « 0 torrents » :
             un compte nul signifie que le releve a echoue. */
          + past([q.dette > 0 ? [nb(q.dette) + (q.dette > 1
                        ? " torrents arrêtés avant leurs 3 jours"
                        : " torrent arrêté avant ses 3 jours"), "wn"] : null,
                  envoye > 0 ? [vol(envoye) + " envoyés sur 24 h", "ok"] : null,
                  pic > 0 ? ["pointe " + Mo(pic)] : null,
                  q.nb > 0 ? [nb(q.nb) + " torrents"] : null]);
      },
      /* Un ratio FRAIS sous le minimum exige par son tracker est une alerte
         (08/10/2026) : c est lui qui menace le compte. Une cible (1,00 sans
         minimum declare) ne l est pas, ni une valeur figee. */
      warn: d => { const q = d.qbit || {};
        /* Hors ligne : plus rien ne se telecharge ni ne se partage, ROUGE. */
        if ((q.etat || "") === "disconnected") return "crit";
        if ((q.etat || "") !== "connected") return true;
        return ratiosBas(q).length > 0; },
      pourquoi: d => { const q = d.qbit || {};
        if (q.etat === "disconnected") return "hors ligne";
        if (q.etat === "firewalled") return "port entrant injoignable";
        if (q.etat !== "connected") return "le client n'a pas répondu";
        return ratiosBas(q).map(x => "ratio " + x.n + " à " + vg((+x.vr.r).toFixed(2))
          + ", minimum " + vg(TRACKERS.seuils[x.n].toFixed(2))).join(SEP); } },
    /* La carte etait VIDE — un en-tete, un voyant — et occupait la largeur entiere
       pour ne rien dire, alors que cross-seed tourne en permanence et qu un arret
       silencieux passerait inapercu.
       DEUX SOURCES, une seule nouvelle : les torrents viennent de `sync/maindata`,
       deja recupere pour la carte qBittorrent ; la base SQLite de cross-seed est
       la seule lecture ajoutee, et elle est locale.

       ⚠️ « A PURGER CETTE NUIT » applique EXACTEMENT la regle de
       `purge-cross-seed.py` — torrent arrete, dans `/data/cross-seed`, ayant
       rendu son temps a 300 s pres. Deux regles qui divergeraient annonceraient
       une suppression qui n arrive pas, pire que le silence.
       ⚠️ SECONDE CONDITION D ALERTE, la vetuste de la recherche : la cadence est
       quotidienne, le seuil de 48 h laisse passer une execution manquee, pas deux.
       Sans elle, un cross-seed mort continuerait d afficher ses correspondances
       comme si de rien n etait.
       ⚠️ Pas de lien : le port 2468 est une API, pas une interface. */
    /* min 250 : six pastilles sur trois lignes, nombre en ligne (feuille) ;
       h [4,4,4] : a 5 demi-rangees, 33 a 42 % de vide. */
    { n: "Cross-seed", taille: "moyenne", niveau: "secondaire", ajuste: { min: 250, h: [4, 4, 4], formes: { 4: [240, 988], 5: [200, 988], 6: [140, 220], 7: [140, 180] } }, d: "Ratio multi-trackers", ic: "cross-seed", w: 2,
      r: d => {
        const c = d.cross || {};
        if (!c.nb && !c.run) return `<div class="note">Relevé cross-seed indisponible</div>`;
        const age = c.run ? Math.max(0, Math.floor(Date.now() / 1000) - c.run) : 0;
        const vieux = !c.run || age > 172800;
        /* Sans `nb`, qBittorrent n a pas repondu : le compte des torrents est
           inconnu, pas nul. Au-dela de 48 h, l age de la recherche en jours. */
        return (c.nb != null
              ? hero(nb(c.nb), (c.nb > 1 ? "torrents" : "torrent") + "<br>cross-seed")
              : `<div class="note">qBittorrent n'a pas répondu</div>`)
          + past([c.purge > 0 ? [nb(c.purge) + " à purger cette nuit", "wn"] : null,
                  c.actifs > 0 ? [nb(c.actifs) + " en partage", "ok"] : null,
                  c.envoye > 0 ? [vol(c.envoye) + " envoyés"] : null,
                  c.match > 0 ? [pluriel(c.match, "correspondance")] : null,
                  [c.run ? "recherche il y a " + anciennete(age) : "aucune recherche",
                   vieux ? "wn" : ""],
                  c.idxtot > 0 ? [c.idx + "/" + c.idxtot + " indexeurs",
                                  c.idx < c.idxtot ? "wn" : ""] : null]);
      },
      warn: d => { const c = d.cross || {};
        return (c.idxtot > 0 && c.idx < c.idxtot)
            || (!!c.run && (Date.now() / 1000 - c.run) > 172800); },
      pourquoi: d => { const c = d.cross || {}, l = [];
        if (c.idxtot > 0 && c.idx < c.idxtot) l.push(pluriel(c.idx, "indexeur joignable", "indexeurs joignables") + " sur " + c.idxtot);
        if (c.run && Date.now() / 1000 - c.run > 172800)
          l.push("aucune recherche depuis " + anciennete(Date.now() / 1000 - c.run));
        return l.join(SEP); } },
    /* Ruban de joignabilite du port entrant.
       La carte ne disait que l etat de L INSTANT. Or le port clignotait — Proton
       le reattribuait 264 fois en 24 heures, toujours sous le meme numero, avec un
       trou entre chaque : selon la seconde ou l on regardait, la meme journee
       paraissait parfaite ou cassee.
       Le watchdog voyait le probleme depuis le debut, mais il n echantillonne que
       toutes les dix minutes, n ecrit qu un journal texte, et chaque trou durant
       moins que son seuil de quinze minutes, il n a jamais agi ni rien signale. Le
       collecteur, lui, teste le port DEUX FOIS PAR MINUTE.

       ⚠️ 96 cases et non 48. La carte fait deux colonnes, elle a la place, et les
       trous durent cinq a dix minutes : au pas de la demi-heure ils se fondraient
       tous en ambre. Au quart d heure on distingue une coupure franche d un
       clignotement.
       Case AMBRE : creneau partiellement injoignable. Case ROUGE : creneau
       entierement mort — `ruban` retient le pire des creneaux couverts, et un
       creneau ne vaut 2,00 que si toutes ses sondes ont echoue. Case NEUTRE :
       creneau sans mesure.

       ⚠️ `vpn.open` vient d un vrai test TCP vers l IP publique du tunnel, PAS du
       contenu de `/tmp/gluetun/forwarded_port`, qui annoncait un numero pendant
       que Proton ne routait plus rien. */
    /* Contenu fixe (216 px) des 5 modules, seul le ruban s etire. l 6 : les
       pastilles occupent 73 % de la ligne (35 % a 12) et les 145 cases du ruban
       4 px ; h [4,4,4] : a 5 demi-rangees, 43 % de vide. */
    { n: "VPN", taille: "large", niveau: "normale", ajuste: { min: 340, l: 6, h: [4, 4, 4], formes: { 4: [340, 1488], 5: [340, 1488] } }, d: "Tunnel " + VPN.nom + " du client torrent", ic: "proton-vpn", w: 4,
      x: LIENS["VPN"],
      r: d => {
        const up = Hn(d, "vpnup");
        const vus = up.filter(x => x > 0).length;   // créneaux de 10 min mesurés
        const ko = coupure(up, 10);
        // Tant que l'historique est court, le bilan dit sur quoi il porte
        // plutôt que de laisser croire à 24 h sans incident.
        const bilan = !vus ? ["relevé de joignabilité en cours"]
          : [(ko > 0 ? "port indisponible " + duree(ko) : "aucune coupure")
             + (vus >= 138 ? " sur 24 h"
                           : " depuis " + Math.max(1, Math.round(vus / 6)) + " h"),
             ko > 0 ? "wn" : "ok"];

        /* Sans releve du tunnel, une note a la place de son etat ; le ruban et
           son bilan, tires de l historique, restent. */
        const v = d.vpn;
        return (v ? etatv(v.ip || "aucune IP",
                v.health === "healthy"
                  ? "Tunnel actif · " + (v.loc || "localisation inconnue")
                  // l etat de Docker en francais (« (starting) », « (unhealthy) » avant le 17/10/2026)
                  : v.health === "starting" ? "Tunnel en cours de démarrage"
                  : v.health === "unhealthy" ? "Tunnel coupé"
                  : "Tunnel : état inconnu",
                v.health === "healthy" && !!v.ip)
                  : `<div class="note">Relevé du tunnel en attente</div>`)
          + rubanH(d, "vpnup", "Joignabilité du port entrant", 1)
          + past([v ? [v.port
                     ? "port " + v.port + (v.open ? " ouvert" : " injoignable")
                     : "aucun port",
                   v.open ? "ok" : "wn"] : null,
                  bilan,
                  [VPN.nom + " · WireGuard"]]);
      },
      /* Tunnel tombe : qBittorrent n a plus de sortie, ROUGE. Port ferme : le
         client marche mais ne partage plus, ambre. */
      warn: d => d.vpn.health !== "healthy" || !d.vpn.ip ? "crit" : !d.vpn.open,
      pourquoi: d => d.vpn.health === "starting" ? "tunnel en cours de démarrage"
        : d.vpn.health !== "healthy" ? "tunnel coupé"
        : !d.vpn.ip ? "aucune adresse de sortie"
        : d.vpn.port ? "port " + d.vpn.port + " injoignable" : "aucun port attribué" },
  ]},
);

GROUPS.push(
  { n: "Supervision", i: "chart", s: [
    /* LE NOMBRE ETAIT DEJA DANS LA BARRE DU HAUT, collee en permanence, la ou la
       carte est loin dans la page : elle occupait 757 px pour redire un chiffre
       connu. Elle reste malgre tout, parce qu elle est la PORTE de la fenetre de
       selection et qu une porte doit appeler — mais la place libre porte enfin ce
       que la barre ne dira jamais, QUELS conteneurs attendent.

       ⚠️ Les bases de donnees sont marquees (`/postgres|db$|broker/`) : une mise
       a jour de moteur peut demander une migration, distinction qui n avait aucune
       raison d attendre le clic.

       ⚠️ SECONDE CONDITION D ALERTE : la vetuste du controle. Avec un `warn`
       portant seulement sur `total > 0`, la mort de l outil de mise a jour figeait
       le compteur et la carte pouvait afficher « Tout est a jour » indefiniment
       pendant que les mises a jour s accumulaient — un surveillant qui s arrete
       sans prevenir, comme le watchdog du port VPN. La passe est quotidienne, vers
       7 h 10 : le seuil de 36 heures laisse passer une execution manquee, pas deux.

       Les donnees viennent de `maj.json`, l etat de compose-auto-update, que
       collect.sh ramene au format de cette tuile. `age` vaut -1 quand le fichier
       est introuvable, ce qui se dit
       autrement qu un controle simplement vieux, et `undefined` tant que le
       collecteur n a pas ete mis a jour : les deux comparaisons sont alors
       fausses et la carte se comporte comme avant. */
    /* Tailles mesurees le 16/10/2026 (pire etat : 22 en attente, 4 noms longs,
       controle vieux) : 246 px au plus etroit, contenu fixe de 179 a 204 px. */
    { n: "Mises à jour", taille: "moyenne", niveau: "normale", ajuste: { min: 250, l: 5, max: 6, h: [4, 4, 4], formes: { 3: [320, 360], 4: [200, 738], 5: [180, 300], 6: [140, 180], 7: [140, 160] } },
      d: "À appliquer à la main", pop: "updates", ic: "maj", w: 2,
      r: d => {
        const u = d.updates || {};
        const att = (u.items || []).filter(x => x.upd);
        const perdu = u.age < 0;
        const vieux = perdu || u.age > 36;
        const base = (n) => /postgres|db$|broker/.test(n);
        /* Rien de verifie (outil introuvable, etat illisible, premier passage) :
           le dire, au lieu de « Tout est a jour — 0 conteneurs verifies ». */
        const sans = !(u.total > 0) && !u.verifies;
        const ctl = perdu ? ["contrôle introuvable", "wn"]
          : vieux ? ["contrôle vieux de " + duree(u.age * 60), "wn"]
          : u.maj && u.maj !== "?" ? ["contrôle du " + u.maj]
          : sans ? null : ["contrôle en attente"];
        const pl = att.slice(0, 4).map(x => [x.n + (base(x.n) ? " · base" : ""),
                                             base(x.n) ? "wn" : ""])
          .concat(att.length > 4 ? [["+ " + (att.length - 4)]] : [])
          .concat(ctl ? [ctl] : []);
        return (u.total > 0
              ? hero(u.total, "conteneur" + (u.total > 1 ? "s" : "")
                     + "<br>à mettre à jour", "ta")
              : sans ? `<div class="note">Relevé des mises à jour ${perdu ? "indisponible" : "en attente"}</div>`
              : calme("<b>Tout est à jour</b> — "
                      + (u.verifies || 0) + " conteneurs vérifiés"))
          + (pl.length ? past(pl) : "");
      },
      /* ⚠️ « incident » ET NON « true » pour l outil arrete (08/10/2026) : la
         carte est une TACHE (des versions attendent), et une tache ne fait pas
         virer le fond. Un outil de mise a jour mort, lui, est un incident : sans
         cette distinction, il n atteignait jamais la barre du haut. */
      warn: d => { const u = d.updates || {};
        return u.age < 0 || u.age > 36 ? "incident" : u.total > 0; },
      pourquoi: d => { const u = d.updates || {};
        return u.age < 0 ? "contrôle des versions introuvable"
          : u.age > 36 ? "aucun contrôle des versions depuis " + duree(u.age * 60)
          : nb(u.total) + " en attente"; } },
    /* L age seul disait DE QUAND date la copie, pas si elle est complete ni si
       elle se relira. Depuis le 05/10/2026 le script de sauvegarde laisse un
       compte rendu : ce qui est parti, la duree, les versions gardees, et le
       resultat du controle d integrite du dimanche, qui relit une partie des
       donnees deja deposees sur le PC.
       ⚠️ Les pastilles n apparaissent qu avec `t`, l heure de la copie : un
       collecteur qui n ecrit encore que l age laisse la carte telle qu avant. */
    /* 4 demi-rangees a la largeur ideale (16/10/2026) : le contenu ne grandit
       pas, a 5 la carte serait vide a 46 %. Largeur min 340 : en dessous, une
       copie en retard finissait a moins de 8 px du bord (17/10). Plus haute,
       elle se replie : 5 demi-rangees des 240 px, 7 des 160 px (`formes`). */
    { n: "Sauvegarde", taille: "moyenne", niveau: "essentielle", ajuste: { min: 340, h: [4, 4, 4], formes: { 4: [340, 988], 5: [240, 988], 6: [200, 320], 7: [160, 220], 8: [160, 180] } },
      d: "Copie chiffrée vers le PC", ic: "sauvegarde", w: 2,
      r: d => { const b = d.backup || {};
        const chk = b.chk || null;
        /* Sans age, la jauge annoncait « il y a undefined h ». */
        if (b.h == null) return `<div class="note">Relevé de la sauvegarde en attente</div>`;
        return jauge(b.h < 0 ? "jamais" : "il y a " + b.h + " h",
                    "seuil d'alerte à 48 h",
                    b.h < 0 ? 100 : b.h / 48 * 100,
                    (b.h < 0 || b.h > 48) ? "var(--scr)"
                      : b.h > 24 ? "var(--swn)" : "var(--sok)")
          + (b.t ? past([b.date ? [b.date] : null,
                         b.add != null ? ["+ " + taille(b.add) + " envoyés"] : null,
                         b.dur != null ? ["durée " + chrono(b.dur)] : null,
                         b.snap ? [pluriel(b.snap, "version gardée", "versions gardées")] : null,
                         !chk ? ["intégrité jamais vérifiée"]
                         : chk.ok ? ["intégrité vérifiée" + (chk.t ? " il y a "
                                     + anciennete(Math.max(0, Date.now() / 1000 - chk.t)) : ""), "ok"]
                         : ["contrôle d'intégrité en échec", "wn"]])
                 : "");
      },
      /* ⚠️ La jauge sait dire « jamais » quand `h` est negatif ; la note doit
         le savoir aussi, sinon elle annonce « Derniere copie le jamais ».
         Defaut trouve le 02/09/2026 par le scenario « premier demarrage »,
         un etat qu on ne rencontre jamais en fonctionnement normal.
         La note annonce desormais la PROCHAINE copie : elle ne part qu apres
         l ecart minimal, et seulement si le PC repond. Un PC reste eteint se lit
         donc ici bien avant de declencher l alerte des 48 h. */
      note: d => { const b = d.backup || {};
        if (b.h == null) return null;
        if (b.h < 0) return "Aucune sauvegarde enregistrée";
        if (!b.t) return b.date ? "Dernière copie le " + b.date : null;
        const p = b.t + SAUVEGARDE_ECART_H * 3600, on = (d.pc || {}).on;
        if (p <= Date.now() / 1000)
          return on ? "Copie imminente : le PC est allumé" : "Prochaine copie dès que le PC s'allume";
        const dt = new Date(p * 1000);
        return "Prochaine copie " + (dt.toDateString() === new Date().toDateString() ? "" : "demain ")
          + "vers " + dt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", " h ")
          + (on ? "" : ", si le PC est allumé");
      },
      warn: d => d.backup.h > 48 || d.backup.h < 0
              || ((d.backup || {}).chk || {}).ok === false,
      pourquoi: d => { const b = d.backup || {};
        return b.h < 0 ? "aucune sauvegarde enregistrée"
          : b.h > 48 ? "dernière copie il y a " + anciennete(b.h * 3600)
          : "contrôle d'intégrité en échec"; } },
    /* Fusion de « Systeme » et « Memoire et swap ».
       Les deux cartes pesaient 758 px pour repeter la barre du haut : trois
       anneaux donnaient processeur, memoire et temperature aux memes valeurs a la
       seconde pres. Ce que la barre ne sait PAS montrer, c est l historique — il
       reste donc, avec les grandeurs derivees qu on ne trouve nulle part ailleurs.
       La legende porte la VALEUR INSTANTANEE de chaque serie : elle remplace les
       trois anneaux pour un vingtieme de leur hauteur.

       ⚠️ PASTILLES CONDITIONNELLES pour le disque et la temperature. Ces deux
       grandeurs declenchent l alerte de la carte mais vivent dans la barre du
       haut : les afficher en permanence serait un doublon, ne jamais les afficher
       rendrait l alerte inexplicable. Elles n apparaissent donc qu a l approche du
       seuil.
       Regle generale : toute condition de `warn` doit avoir de quoi s expliquer
       sur la carte, au moins au moment ou elle se declenche. */
    /* `per` : selecteur « 24 h · 7 j » dans l en-tete (voir `PERIODES`), d ou
       une description sans duree. */
    /* Tailles mesurees le 16/10/2026 : 450 px au moins pour que l etiquette du
       seuil (6,5 unites) fasse 9 px ; graphe plafonne selon la hauteur dans
       bento/supervision-a.css ; a 6 demi-rangees, au-dela de 7 modules, le
       graphe plafonne laisserait plus d un quart de vide. */
    { n: "Système", taille: "graphique", niveau: "essentielle", ajuste: { min: 450, max: 7, h: [6, 7, 7], formes: { 5: [400, 863], 6: [360, 863], 7: [360, 863], 8: [360, 863], 9: [360, 863], 10: [360, 863] } },
      d: "Processeur, mémoire et swap", ic: "systeme", w: 2, per: 1,
      r: d => leg([["processeur", "#4d97ee", pct(d.nas.cpu)],
                   ["mémoire", "#34c759", pct(d.nas.ram)],
                   ["swap", "#ffb340", pct(d.nas.swap)]])
            + graphe([{ v: Hp(d, "Système", "cpu"), c: "#4d97ee", n: "processeur" },
                      { v: Hp(d, "Système", "ram"), c: "#34c759", n: "mémoire" },
                      { v: Hp(d, "Système", "swap"), c: "#ffb340", n: "swap" }],
                     /* Le seuil de 60 % est celui du SWAP : trace dans sa couleur.
                        En rouge, sous la memoire qui le depasse toute la journee,
                        il faisait lire une alerte permanente (09/10/2026). */
                     { f: pct, seuil: 60, seuilC: "#ffb340", u: "%", ts: Hp(d, "Système", "t"),
                       alt: "Processeur, mémoire et swap " + surP("Système") })
            + past([["charge " + vg(d.nas.load) + " → " + vg(d.nas.load5 || d.nas.load)
                      + " → " + vg(d.nas.load15 || d.nas.load) + " / " + (d.nas.cores || 1),
                     d.nas.load >= (d.nas.cores || 1) ? "wn" : ""],
                    /* Sans historique, pas de pointe : « 0 % » se lirait comme une mesure. */
                    Hf(d, "swap").length
                      ? ["pointe swap " + Math.round(Math.max(0, ...Hf(d, "swap"))) + " %",
                         Math.max(0, ...Hf(d, "swap")) >= 60 ? "wn" : ""]
                      : null,
                    ["disque " + Mo(d.nas.dr || 0) + " lu"],
                    ["disque " + Mo(d.nas.dw || 0) + " écrit"],
                    d.nas.disk >= 85
                      ? [To(d.nas.disktot * d.nas.disk / 100) + " / "
                         + To(d.nas.disktot) + " To", d.nas.disk >= 92 ? "wn" : ""]
                      : null,
                    tempCpu(d) >= SEUILS_T.cpu[0]
                      ? [Math.round(tempCpu(d)) + " °C sur 5 min", "wn"]
                      : null,
                    /* ⚠️ AMBRE SOUS UNE HEURE, et c est tout l interet. La valeur
                       elle-meme n apprend rien — 24 jours ou 25, peu importe. Ce
                       qui informe, c est le SAUT : un compteur retombe a « 12 min »
                       signale un redemarrage que personne n a ordonne, seule trace
                       que la page pouvait en donner. */
                    d.nas.uptime
                      ? ["en service depuis "
                         + (d.nas.uptime >= 86400 ? Math.floor(d.nas.uptime / 86400) + " j"
                            : d.nas.uptime >= 3600 ? Math.floor(d.nas.uptime / 3600) + " h"
                            : Math.round(d.nas.uptime / 60) + " min"),
                         d.nas.uptime < 3600 ? "wn" : ""]
                      : null]),
      /* La temperature n allume plus cette carte (08/10/2026) : 85 °C allumait
         deux pastilles, celle-ci et Temperatures, pour un seul evenement. */
      /* Volume plein a 97 % : les ecritures vont echouer, ROUGE. */
      warn: d => d.nas.disk >= 97 ? "crit" : d.nas.ram >= 90 || d.nas.disk >= 92 || d.nas.swap >= 60,
      pourquoi: d => [d.nas.disk >= 92 ? "volume plein à " + pct(d.nas.disk) : "",
                      d.nas.ram >= 90 ? "mémoire à " + pct(d.nas.ram) : "",
                      d.nas.swap >= 60 ? "swap à " + pct(d.nas.swap) : ""].filter(Boolean).join(SEP) },
    /* Temperatures des capteurs materiels.
       UNE CARTE A PART parce que l unite differe : des degres ne peuvent pas
       rejoindre l axe en pourcentage de la carte Systeme. C est le critere le plus
       simple pour eviter que la page ne redevienne un fourre-tout.
       Elle ne fait PAS doublon avec « Disques NVMe » : celle-la montre la valeur
       instantanee sur son echelle, celle-ci l historique et surtout la CORRELATION
       entre capteurs — le processeur qui monte avec la charge, un disque qui
       chauffe pendant un gros telechargement.

       ⚠️ `eth0` est le capteur le PLUS CHAUD du NAS, autour de 71 degres, et c est
       NORMAL PAR CONCEPTION : c est le controleur reseau 10 GbE, pas un processeur.
       Cette valeur a deja ete prise pour une surchauffe. Elle est donc affichee —
       pour qu on cesse d en douter — mais EXCLUE de la condition d alerte, et une
       pastille le dit en toutes lettres.

       LES DISQUES SONT DECOUVERTS, pas enumeres : la carte lit les colonnes
       `nvme<N>` de l historique et n affiche que celles qui rapportent une valeur.
       Ajouter un SSD dans un emplacement M.2 libre suffit a le voir apparaitre.
       Son libelle vient de SMART : une capacite parle davantage que « nvme2 ».
       ⚠️ Les series ajoutees en cours de route n ont pas d historique anterieur :
       `d0` les fait demarrer la ou leurs donnees commencent. */
    /* Tailles mesurees le 16/10/2026 : 420 px au moins pour des etiquettes de
       9 px ; 7 demi-rangees fixes (6 ne tient pas avec quatre disques, 8 laisse
       un tiers de vide) ; graphe plafonne dans bento/supervision-a.css. */
    { n: "Températures", taille: "graphique", niveau: "secondaire", ajuste: { min: 420, h: [7, 7, 7], formes: { 5: [520, 988], 6: [360, 988], 7: [360, 988], 8: [360, 988], 9: [360, 988], 10: [360, 988] } },
      d: "Capteurs matériels", ic: "temp", w: 2, per: 1,
      r: d => {
        const L = dern(d);
        const dg = v => v > 0 ? Math.round(v) + " °C" : "—";
        const val = n => { const i = col(d, n); return i < 0 ? 0 : (L[i] || 0); };
        const mx = n => { const v = Hf(d, n).filter(x => x > 0);
          return v.length ? Math.round(Math.max(...v)) : 0; };
        const nomDisque = n => {
          const x = ((d.smart && d.smart.d) || []).find(y => y.n === n);
          if (!x) return "disque " + n.slice(4);
          return "disque " + (x.go >= 1000 ? vg((x.go / 1000).toFixed(1)) + " To"
                                           : x.go + " Go");
        };
        const TEINTES = ["#4d97ee", "#34c759", "#39c2d0", "#8ea0ff"];
        const dq = disquesHist(d).filter(n => val(n) > 0);
        const pd = Math.max(mx("nvme"), ...dq.map(mx));
        return leg([["processeur", "#ff9f0a", dg(d.nas.temp)]]
              .concat(dq.map((n, i) => [nomDisque(n), TEINTES[i % TEINTES.length], dg(val(n))]))
              .concat([["réseau 10 GbE", "#c07bf0", dg(val("eth0"))]]))
          + graphe([{ v: Hp(d, "Températures", "temp"), c: "#ff9f0a", n: "processeur" }]
              .concat(dq.map((n, i) => ({ v: Hp(d, "Températures", n), c: TEINTES[i % TEINTES.length], d0: 1, n: nomDisque(n) })))
              .concat([{ v: Hp(d, "Températures", "eth0"), c: "#c07bf0", d0: 1, n: "réseau 10 GbE" }]),
              { min: 30, f: dg, u: "°C", ts: Hp(d, "Températures", "t"),
                alt: "Températures du NAS " + surP("Températures") })
          /* Sans historique, pas de pointe : « 0 °C » se lirait comme une mesure. */
          + past([mx("temp") ? ["pointe processeur " + mx("temp") + " °C", mx("temp") >= SEUILS_T.cpu[1] ? "wn" : ""] : null,
                  pd ? ["pointe disques " + pd + " °C", pd >= SEUILS_T.nvme[0] ? "wn" : ""] : null,
                  [val("eth0") > 0
                    ? "réseau ~" + Math.round(val("eth0")) + " °C · normal par conception"
                    : "réseau : relevé en cours"],
                  ventilos(d.nas.fans, VENTILO_MIN)]);
      },
      /* Un ventilateur qui ralentit precede la surchauffe : c est le signal le
         plus precoce de la carte. */
      warn: d => {
        const L = dern(d);
        const val = n => { const i = col(d, n); return i < 0 ? 0 : (L[i] || 0); };
        /* Au second seuil, le materiel se protege en ralentissant : ROUGE. */
        if (tempCpu(d) >= SEUILS_T.cpu[1] || disquesHist(d).some(n => val(n) >= SEUILS_T.nvme[1])) return "crit";
        return tempCpu(d) >= SEUILS_T.cpu[0] || disquesHist(d).some(n => val(n) >= SEUILS_T.nvme[0])
          || (d.nas.fans || []).some(f => f.rpm < VENTILO_MIN);
      },
      pourquoi: d => {
        const L = dern(d);
        const val = n => { const i = col(d, n); return i < 0 ? 0 : (L[i] || 0); };
        const l = [];
        if (tempCpu(d) >= SEUILS_T.cpu[0]) l.push("processeur à " + Math.round(tempCpu(d)) + " °C");
        disquesHist(d).filter(n => val(n) >= SEUILS_T.nvme[0])
          .forEach(n => l.push("disque " + n.slice(4) + " à " + Math.round(val(n)) + " °C"));
        (d.nas.fans || []).filter(f => f.rpm < VENTILO_MIN)
          .forEach(f => l.push("ventilateur à " + nb(f.rpm) + " tr/min"));
        return l.join(SEP);
      } },
    /* LA CARTE DE LA MEMOIRE VIVE, refaite le 05/10/2026 sur maquette (melange
       des versions A et B retenu). Elle repond d abord a la question
       qui bride ce serveur : LA MEMOIRE SUFFIT-ELLE ?
       1. LE VERDICT : ce qui est DISPONIBLE (libre plus cache rendable) et un
          mot. « Juste » est ambre mais ne declenche rien : rien n attend encore.
          Seul « Saturee » allume le voyant. Les barrettes viennent du
          collecteur : une barrette ajoutee se verra toute seule.
       2. CE QUE CONTIENT LA RAM. Le cache est HACHURE : il se rend a la demande,
          et c est lui qui faisait lire « 74 % utilises » comme une alerte.
       3. CE QUI EST TASSE dans le zram, compresse dans la RAM elle-meme, et A QUI
          ca appartient ; puis ce qui a DEBORDE sur le SSD, cent fois plus lent,
          vrai signe de manque.
       4. QUI LA PREND, en memoire et tasse, sur la meme echelle : les services
          du systeme et les cameras a cote des conteneurs.
          ⚠️ LES LIGNES ADDITIONNEES DOIVENT RETOMBER SUR LE TOUT. Le collecteur
          classe chaque groupe de processus du systeme (cgroup) : la memoire
          anonyme et le swap de chacun, sans le cache. Leur somme vaut
          « programmes » et ce qui est tasse ou deborde, a moins de 1 % pres
          (mesure le 05/10/2026 : 1 867 Mo contre 1 874, 3 401 Mo contre
          3 407). « Autres » ramasse ce qu aucune categorie ne reclame : rien ne
          disparait. Le noyau et le cache n appartiennent a personne, ils
          restent dans la barre de composition.
       ⚠️ Ni courbe (la carte « Systeme » trace deja memoire et swap sur 24 h) ni
       liste des conteneurs : elle passe dans la fenetre, ouverte au clic.
       ⚠️ RETIRES VOLONTAIREMENT : la pastille de pression (elle compte
       toujours dans le verdict, sans s afficher) et le bandeau des redemarrages
       automatiques des conteneurs. */
    /* Tailles mesurees le 16/10/2026 : sur une colonne la carte demande 537 px
       (10 demi-rangees) ; de 7 a 9 elle passe sur deux colonnes
       (bento/supervision-a.css), qui tiennent des 572 px dans le pire etat. */
    { n: "Mémoire", taille: "graphique", niveau: "normale", ajuste: { min: 580, h: [7, 7, 10], formes: { 7: [580, 988], 8: [580, 988], 10: [540, 560], 11: [360, 560], 12: [320, 520] } },
      d: "Ce que contient la RAM, et qui la prend", ic: "memoire", w: 2, pop: "conteneurs",
      r: d => { const m = d.mem;
        if (!m || !m.tot) return `<div class="note">Relevé de la mémoire en attente</div>`;
        const E = etatMemoire(m);
        const ram = m.ram || {};
        const zf = m.zcap ? m.tasse / m.zcap : 0;
        const grp = k => MEMOIRE[k] || [k, "", "#8a94a6"];
        /* Du plus gros au plus petit EN MEMOIRE, comme la fenetre, sauf « Autres »,
           toujours en dernier : c est un reste, pas un concurrent. */
        const g = (m.g || []).slice().sort((a, b) => (a.k === "autres") - (b.k === "autres")
          || b.mo - a.mo);
        const M = Math.max(1, ...g.map(x => x.mo + (x.t || 0)));
        return `<div class="verdict"><b>${moGo(m.dispo)}</b><span>disponibles sur ${moGo(m.tot)}`
            + (ram.go ? `<br>${ram.go} Go installés · ${ram.libres ? ram.libres + " emplacement" + (ram.libres > 1 ? "s" : "") + " libre" + (ram.libres > 1 ? "s" : "") : "aucun emplacement libre"}` : "")
            + `</span><em class="${E[1]}">${E[0]}</em></div>`
          + intertitre("Ce que contient la RAM")
          + compo([[m.prog / m.tot * 100, "#4d97ee"], [m.zram / m.tot * 100, "#c07bf0"],
                   [m.noyau / m.tot * 100, "#8a94a6"], [m.cache / m.tot * 100, "#4d97ee", 1]])
          + `<div class="leg gauche">`
            + [["programmes", "#4d97ee", m.prog], ["zram", "#c07bf0", m.zram], ["noyau", "#8a94a6", m.noyau],
               ["cache", hachure("#4d97ee"), m.cache], ["libre", "rgba(255,255,255,.14)", m.libre]]
              .map(([n, c, v]) => `<span><i style="background:${c}"></i>${n}<b>${moGo(v)}</b></span>`).join("")
            + `</div>`
          + (m.tasse > 0
            ? `<div class="dqb"><div class="bv"><span><b>${moGo(m.tasse)} tassés</b> dans ${moGo(m.zram)} de zram`
              + (m.zram > 0 ? ` · ×${vg((m.tasse / m.zram).toFixed(1))}` : "") + `</span>`
              + `<span class="${zf >= MEM_SEUILS.zram ? "wn" : ""}">zram plein à ${Math.round(zf * 100)} %</span></div>`
              + `<div class="jauge-b"><i style="width:${pc(zf * 100).toFixed(1)}%;background:#c07bf0"></i></div>`
              + `<div class="bv">${m.ssd > 0
                  ? `<span class="${m.ssd >= MEM_SEUILS.ssd ? "wn" : ""}">${moGo(m.ssd)} débordés sur le SSD, cent fois plus lent</span>`
                  : `<span>rien n'a débordé sur le SSD</span>`}</div></div>`
            : "")
          + intertitre("Qui la prend · en mémoire et tassé")
          /* Groupes illisibles : l intertitre restait seul, sans rien dessous. */
          + (!g.length ? `<div class="note">Détail en attente du collecteur</div>`
            : rangsDuo(g.map(x => { const k = grp(x.k);
              return [k[0] + (x.n ? " (" + x.n + ")" : ""),
                      moGo(x.mo) + (x.t > 0 ? " + " + moGo(x.t) + " tassés" : ""),
                      x.mo / M * 100, (x.t || 0) / M * 100, k[2],
                      x.p > x.mo * 1.3 ? "pointe " + moGo(x.p) : k[1]]; })))
          /* Processus tues faute de memoire sur 24 h (09/10/2026), avec leurs noms. */
          + (m.oom ? past([m.oom.n24 > 0
              ? [pluriel(m.oom.n24, "processus tué", "processus tués") + " faute de mémoire sur 24 h"
                 + ((m.oom.ev || []).length ? " : " + [...new Set(m.oom.ev.map(e => e[1]))].slice(0, 3).join(", ") : ""), "wn"]
              : ["aucun processus tué faute de mémoire sur 24 h", "ok"]]) : "");
      },
      /* « Saturee » : le systeme attend la memoire, tout ralentit. ROUGE. */
      warn: d => !!d.mem && d.mem.tot > 0 && (etatMemoire(d.mem)[1] === "cr" ? "crit"
        : ((d.mem.oom || {}).n24 || 0) > 0),
      pourquoi: d => etatMemoire(d.mem)[1] === "cr" ? "mémoire saturée, " + moGo(d.mem.dispo) + " disponibles"
        : pluriel(d.mem.oom.n24, "processus tué", "processus tués") + " faute de mémoire sur 24 h" },
    /* FUSION de « Disques NVMe » et « Espace disque » le 05/10/2026, puis
       refonte sur maquette : l organisation du stockage, grappe par grappe,
       avec ses disques dedans. Voir `grappesDisques`.
       SMART dit si le DISQUE va bien ; btrfs dit si les DONNEES vont bien : une
       erreur de somme de controle signale une corruption avant toute panne.
       ⚠️ « Aucun miroir » est AMBRE MAIS NE DECLENCHE RIEN : c est un fait de
       l installation, pas un incident. Le voyant s allume si un disque a des
       erreurs ou s use, si un miroir existant perd un disque, ou si btrfs
       compte des erreurs. Le volume presque plein est deja l alerte de la carte
       « Systeme ». */
    /* Tailles mesurees le 16/10/2026 : 423 px de contenu des 500 px de large
       (disque en echec, modele long), d ou 8 demi-rangees. */
    { n: "Stockage", taille: "graphique", niveau: "normale", ajuste: { min: 500, h: [8, 8, 9], formes: { 8: [500, 988], 9: [400, 988], 10: [320, 480], 11: [300, 380], 12: [280, 300] } },
      d: "Volumes et disques", ic: "ssd", w: 2,
      r: d => grappesDisques(d.smart, { ESPACE, ROLES }),
      /* Disque en echec, miroir degrade, corruption detectee : ROUGE. L usure
         seule laisse le temps de commander un disque : ambre. */
      warn: d => { const s = d.smart || {};
        if ((s.d || []).some(x => !x.ok || x.erreurs > 0)
            || (s.grappes || []).some(g => g.err > 0 || (!g.sys && g.n < g.att))) return "crit";
        return (s.d || []).some(x => x.usure >= 80); },
      pourquoi: d => { const s = d.smart || {}, l = [];
        (s.d || []).forEach(x => {
          if (!x.ok) l.push("disque " + x.n + " en échec");
          else if (x.erreurs > 0) l.push("disque " + x.n + " : " + pluriel(x.erreurs, "erreur"));
          else if (x.usure >= 80) l.push("disque " + x.n + " usé à " + x.usure + " %"); });
        (s.grappes || []).forEach(g => {
          if (g.err > 0) l.push(pluriel(g.err, "erreur") + " de données");
          if (!g.sys && g.n < g.att) l.push((redondance(g) === "parité" ? "grappe dégradée, " : "miroir dégradé, ")
            + pluriel(g.n, "disque") + " sur " + g.att); });
        return l.join(SEP); } },
    /* Tailles mesurees le 16/10/2026 : 184 px de contenu, 207 quand trois
       groupes en panne passent sur deux lignes, ce qui exige 840 px. Hauteur
       fixe : a 5 demi-rangees, 56 px de vide de plus. */
    { n: "Uptime Kuma", taille: "large", niveau: "essentielle", ajuste: { min: 840, h: [4, 4, 4], formes: { 4: [620, 1488], 5: [400, 1488], 6: [340, 600], 7: [340, 380] } }, ko: "kuma", d: "Sondes et alertes", u: go("Uptime Kuma"), ic: "uptime-kuma", w: 4,
      /* ⚠️ NI `calme` NI `hero` ICI, et c'est un retrait délibéré. Le bandeau
         vert répétait l'addition des trois lignes — « 28 sondes en ligne »
         quand elles disent 7, 10 et 11 — et n'apportait en propre que la
         stabilité. Trois coches vertes, un bandeau vert et le voyant de
         l'en-tête faisaient QUATRE fois le même signal. Le grand nombre rouge
         du mode dégradé tombe pour la raison inverse : les lignes NOMMENT la
         sonde fautive, ce qu'un compte ne fera jamais. Restent des pastilles,
         comme sur la plupart des autres cartes. */
      r: d => {
        const gs = d.kuma.groupes || [];
        const som = (c) => gs.reduce((a, g) => a + (+g[c] || 0), 0);
        /* Sans groupes (page de statut illisible), le compte global : la carte
           disait « 30 sondes en ligne » en vert avec deux sondes tombees. */
        const ko = som("ko") || (gs.length ? 0 : +d.kuma.down || 0), att = som("att");
        const tot = som("tot") || (+d.kuma.up || 0) + (+d.kuma.down || 0);
        const pl = (n, s) => nb(n) + " sonde" + (n > 1 ? "s " : " ") + s;
        return rubanH(d, "kumaup", "Stabilité des sondes", 1)
          + grpk(gs)
          + past([ko > 0 ? [pl(ko, "hors ligne"), "wn"] : null,
                  att > 0 ? [pl(att, "en attente"), "wn"] : null,
                  ko + att === 0 ? [pl(tot, "en ligne"), tot ? "ok" : ""]
                                 : [nb(tot - ko - att) + " en ligne"],
                  d.kuma.pc ? ["stabilité " + vg(d.kuma.pc) + " %"] : null]);
      },
      warn: d => d.kuma.down > 0
             || ((d.kuma.groupes || []).some(g => (+g.ko || 0) + (+g.att || 0) > 0)),
      pourquoi: d => { const gs = d.kuma.groupes || [];
        const ko = gs.reduce((a, g) => a + (+g.ko || 0), 0) || (+d.kuma.down || 0);
        const att = gs.reduce((a, g) => a + (+g.att || 0), 0);
        return [ko ? pluriel(ko, "sonde") + " hors ligne" : "",
                att ? pluriel(att, "sonde") + " en attente" : ""].filter(Boolean).join(SEP); } },
    /* Ce qui s est passe sur 7 jours, toutes sources confondues (09/10/2026) :
       mises a jour, conteneurs, sondes, site, VPN, reseau, sauvegardes,
       connexions depuis Internet. Construit par `systeme.py` (`journal`). Les
       cinq derniers ici, la semaine entiere au clic (`popJournal`).
       ⚠️ PAS D ALERTE : chaque incident allume deja sa propre carte. Le journal
       dit QUAND, pas QUOI faire. */
    /* Tailles mesurees le 16/10/2026 : les lignes les plus longues (passe des
       mises a jour, connexions) tiennent des 550 px sans categorie ; au-dela
       de 9 modules, plus d un tiers de la largeur reste vide. Cinq lignes
       font 264 px ; a 4 demi-rangees, trois (feuille bento). */
    { n: "Journal", taille: "large", niveau: "normale", ajuste: { min: 550, l: 8, max: 9, h: [4, 5, 5], formes: { 4: [500, 1113], 5: [500, 1113] } }, d: "Ce qui s'est passé sur 7 jours", ic: "journal", w: 4, pop: "journal",
      r: d => (d.journal || []).length ? evts(d.journal, 5)
        : `<div class="note">Journal en cours de constitution</div>`,
      note: d => { const l = d.journal || [];
        if (!l.length) return null;
        const inc = l.filter(e => e[3] === "wn" || e[3] === "cr").length;
        return pluriel(l.length, "événement") + " sur 7 jours · "
          + (inc ? pluriel(inc, "incident") : "aucun incident"); } },
    /* Injoignable vu d Internet (UptimeRobot) : le telephone ne recoit plus
       rien, puisqu il vient chercher chaque message sur ce domaine. */
    /* Tailles mesurees le 16/10/2026 : l en-tete seul fait ~250 px, des 4
       modules la moitie de la carte est vide. 260 px : la pastille d alerte. */
    { n: "ntfy", taille: "lien", niveau: "secondaire", ajuste: { min: 260, l: 3, max: 3, h: [2, 2, 2], formes: { 2: [260, 363], 3: [220, 240] } }, d: "Notifications push", u: go("ntfy"),
      x: LIENS["ntfy"], ic: "ntfy", mini: 1, w: 4,
      /* Rien quand tout va bien : la carte reste un lien. Sinon ce que voit
         UptimeRobot, pour que le voyant s explique dans la carte, ou l age du
         releve quand il est trop vieux pour juger (coupure d Internet). */
      r: d => { const m = dehors(d, LIENS["ntfy"]);
        if (m) { const p = pastDehors(m); return p[0][1] === "ok" ? null : past(p); }
        const u = d.ur || {}, h = String(LIENS["ntfy"] || "").replace(/^[a-z]+:\/\//, "").replace(/[/:?].*$/, "");
        return u.t && (u.m || []).some(x => x.h === h)
          ? past([["vu d'Internet : relevé il y a " + anciennete(Math.max(0, Date.now() / 1000 - u.t))]]) : null; },
      warn: d => horsDehors(dehors(d, LIENS["ntfy"])),
      pourquoi: () => "injoignable vu d'Internet, les notifications n'arrivent plus" },
  ]},
  /* Ajoute le 05/10/2026, inspire de deux applications de l App Center essayees
     puis retirees. Quatre cartes de meme largeur, donc deux rangees pleines. */
  { n: "Réseau et sécurité", i: "shield", s: [
    /* Chaque ligne vise une chose qui A DEJA CASSE SANS BRUIT. Le 05/10/2026,
       cinq `.env` etaient lisibles par tous depuis cinq semaines — repasses en
       777 par une mise a jour du systeme — sans que rien ne le signale.
       Le pare-feu : si le script qui reinjecte les regles Docker ne passait pas
       apres un redemarrage, tous les services deviendraient injoignables. Le
       collecteur verifie que CHAQUE reseau Docker actif a sa regle ; un simple
       compte ne dirait pas lequel manque. */
    /* Tailles mesurees le 16/10/2026 : six lignes font 291 px, sept 329 (deux
       lignes de certificats) ; sous 330 px de large, les lignes passent sur
       deux rangs. Plus de six lignes a 6 demi-rangees : resserrees (feuille). */
    { n: "Sécurité", taille: "moyenne", niveau: "normale", ajuste: { min: 360, h: [6, 6, 7], formes: { 6: [360, 988], 7: [340, 988], 8: [300, 340], 9: [260, 320], 10: [260, 280], 11: [240, 240], 12: [220, 240] } }, d: "Contrôles du serveur", ic: "securite", w: 2,
      r: d => { const s = d.secu;
        if (!s) return `<div class="note">Contrôles en attente</div>`;
        const ouv = s.ouverts || [], manq = s.manq || [];
        const pl = (n, m) => n > 1 ? m : "";
        return controles([
          ouv.length ? ["wn", ouv.length + " fichier" + pl(ouv.length, "s") + " sensible" + pl(ouv.length, "s")
                              + " lisible" + pl(ouv.length, "s") + " par tous",
                        ouv.slice(0, 2).join(", ") + (ouv.length > 2 ? "…" : "")]
                     /* Aucun fichier verifie (collecteur lance sans root) : rien ne
                        dit qu ils sont fermes. */
                     : s.verifies > 0 ? ["ok", "Fichiers sensibles fermés", pluriel(s.verifies, "vérifié")]
                     : ["in", "Fichiers sensibles : contrôle en attente", ""],
          manq.length ? ["wn", manq.length + " réseau" + pl(manq.length, "x") + " Docker sans règle",
                         manq.slice(0, 2).join(", ") + (manq.length > 2 ? "…" : "")]
          /* `fw` vaut null quand les regles n ont pas pu etre lues : on le dit,
             plutot que d afficher « null regles en place ». */
          : s.fw == null ? ["in", "Pare-feu : contrôle en attente", ""]
          : ["ok", "Pare-feu : " + pluriel(s.fw, "règle") + " en place", "liste blanche"],
          ...lignesCerts(d.certs),
          [s.refus > 20 ? "wn" : "ok", nb(s.refus) + " connexion" + pl(s.refus, "s") + " refusée" + pl(s.refus, "s"), "sur 24 h"],
          s.ext > 0 ? ["in", s.ext + " connexion" + pl(s.ext, "s") + " depuis Internet", "voir la carte Accès"]
                    : ["ok", "Aucun accès depuis Internet", "réseau local et VPN"],
          s.ssh ? ["in", "SSH ouvert", "se referme seul"] : ["ok", "SSH fermé", ""]]);
      },
      warn: d => { const s = d.secu || {}, c = etatCerts(d.certs);
        /* Un certificat EXPIRE coupe le domaine pour tous ses visiteurs : rouge. */
        if (c.expires.length) return "crit";
        /* `ext` n allume plus cette carte (08/10/2026) : un meme evenement allumait
           Securite ET Acces. C est Acces qui le porte, avec d ou il vient. */
        return (s.ouverts || []).length > 0 || (s.manq || []).length > 0 || s.refus > 20
          || c.retard.length > 0 || c.illisibles.length > 0; },
      pourquoi: d => { const s = d.secu || {}, o = (s.ouverts || []).length, m = (s.manq || []).length;
        const c = etatCerts(d.certs);
        return [c.expires.length ? pluriel(c.expires.length, "certificat expiré", "certificats expirés") : "",
                c.retard.length - c.expires.length > 0
                  ? pluriel(c.retard.length - c.expires.length, "certificat non renouvelé", "certificats non renouvelés") : "",
                c.illisibles.length ? pluriel(c.illisibles.length, "certificat illisible", "certificats illisibles") : "",
                o ? pluriel(o, "fichier sensible lisible", "fichiers sensibles lisibles") + " par tous" : "",
                m ? pluriel(m, "réseau Docker", "réseaux Docker") + " sans règle de pare-feu" : "",
                s.refus > 20 ? pluriel(s.refus, "connexion refusée", "connexions refusées") + " sur 24 h" : ""]
          .filter(Boolean).join(SEP); } },
    /* Qui est connecte maintenant, et les dernieres connexions. Les adresses
       arrivent TRADUITES EN NOMS par le collecteur (« PC fixe », le nom d un
       client WireGuard) ; une adresse hors du reseau local et du VPN passe a
       l ambre, et c est la seule condition d alerte. Un clic ouvre les 24 h
       entieres, heure par heure puis connexion par connexion (`popAcces`). */
    /* Tailles mesurees le 16/10/2026 : 293 px d ordinaire, 86 de plus par
       adresse vue d Internet ; a 6 et 7 demi-rangees, la feuille bento fait
       ceder les dernieres connexions. Toutes tiennent des 340 px de large. */
    { n: "Accès", taille: "moyenne", niveau: "normale", ajuste: { min: 340, h: [6, 6, 7], formes: { 6: [320, 988], 7: [260, 988] } }, d: "Qui est connecté, et d'où", ic: "acces", w: 2, pop: "acces",
      r: d => { const a = d.acces;
        if (!a) return `<div class="note">Relevé des connexions en attente</div>`;
        /* Sans `now` (collecteur d avant), pas d intertitre seul sur du vide :
           le collecteur rend sinon toujours une tuile par protocole. */
        return depuisInternet(a)
          + ((a.now || []).length ? intertitre("Connectés maintenant") + sessions(a.now) : "")
          + intertitre("Dernières connexions")
          + ((a.log || []).length ? journal(a.log, 4) : `<div class="note">Aucune connexion enregistrée</div>`);
      },
      note: d => { const a = d.acces;
        if (!a) return null;
        return nb(a.n) + " connexion" + (a.n > 1 ? "s" : "") + " sur 24 h · "
          + (a.ext > 0 ? a.ext + " depuis Internet" : "toutes depuis le réseau local ou le VPN");
      },
      warn: d => (d.acces || {}).ext > 0,
      pourquoi: d => pluriel(d.acces.ext, "connexion") + " depuis Internet sur 24 h" },
    /* Le lien du serveur vers le switch. Il passe a l ambre s il negocie moins
       que prevu, s il perd ses trames geantes, ou s il est TOMBE ET REMONTE
       depuis le demarrage : c est ce que produit un switch qui se fige.
       La courbe est la colonne `reseau`, collectee depuis l origine et jamais
       affichee jusqu ici : recu et envoye confondus. */
    /* Tailles mesurees le 16/10/2026 : 374 px a 6 modules, le graphe grandit
       avec la largeur (plafonne par la feuille bento selon la hauteur). 350 px :
       graduations du graphe a 9 px reels (8,5 unites sous 430 px). */
    { n: "Réseau local", taille: "graphique", niveau: "secondaire", ajuste: { min: 350, formes: { 6: [360, 988], 7: [360, 988], 8: [360, 988], 9: [360, 988], 10: [360, 988] } }, d: "Lien du serveur vers le switch", ic: "reseau", w: 2, per: 1,
      r: d => { const l = d.lan;
        if (!l) return `<div class="note">Relevé du lien en attente</div>`;
        const v = Hf(d, "reseau"), red = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
        const lent = l.vit > 0 && l.vit < LIEN.vit, petit = l.mtu < LIEN.mtu;
        /* Vitesse 0 ou -1 : le pilote ne la donne pas (lien qui negocie), on
           ne l affiche pas comme « 0 Mb/s ». */
        return (l.up ? hero(l.vit >= 1000 ? vg(l.vit / 1000) + " Gb/s" : l.vit > 0 ? l.vit + " Mb/s" : "En ligne",
                            "lien vers le switch" + (l.vit > 0 ? "" : " · vitesse inconnue")
                            + (!(l.mtu > 0) ? "" : "<br>" + (l.mtu >= 9000 ? "trames géantes " + l.mtu
                                                                           : "trames de " + l.mtu + " octets")),
                            lent || petit ? "wn" : "")
                     : hero("Coupé", "le serveur n'a plus de lien réseau", "cr"))
          /* LEGENDE ET GRAPHE DES CARTES SYSTEME ET TEMPERATURES (09/10/2026) : la valeur du moment dans la legende, une
             echelle chiffree a gauche, des lignes de repere, les heures dessous.
             La silhouette d avant n avait que son sommet et zero. */
          /* La legende et les pastilles restent sur 24 h, seul le trace suit
             la periode choisie. */
          + (v.length > 1
             ? leg([["reçu et envoyé", "#4d97ee", Mo(v[v.length - 1])]])
               + graphe([{ v: Hp(d, "Réseau local", "reseau"), c: "#4d97ee", n: "trafic" }],
                        { f: MoAxe, u: "dbt", ts: Hp(d, "Réseau local", "t"),
                          alt: "Trafic du lien " + surP("Réseau local") })
             : `<div class="note">Trafic en cours d'enregistrement</div>`)
          + past([v.length ? ["moyenne " + Mo(red)] : null,
                  v.length ? ["pointe " + Mo(Math.max(...v))] : null,
                  /* Sur 24 h (`coup24`) : compte depuis le demarrage, une seule coupure
                     gardait la carte ambre jusqu au redemarrage suivant. */
                  coup24(l) > 0 ? [coup24(l) + " coupure" + (coup24(l) > 1 ? "s" : "") + " sur 24 h", "wn"]
                              : ["lien stable sur 24 h", "ok"],
                  [nb(l.err) + " erreur" + (l.err > 1 ? "s" : "") + " reçue" + (l.err > 1 ? "s" : ""),
                   l.err > 10000 ? "wn" : ""]]);
      },
      warn: d => { const l = d.lan;
        if (l && !l.up) return "crit";
        return !!l && ((l.vit > 0 && l.vit < LIEN.vit) || l.mtu < LIEN.mtu || coup24(l) > 0); },
      pourquoi: d => { const l = d.lan;
        if (!l.up) return "le serveur n'a plus de lien réseau";
        return [l.vit > 0 && l.vit < LIEN.vit ? "lien négocié à " + (l.vit >= 1000 ? vg(l.vit / 1000) + " Gb/s" : l.vit + " Mb/s") : "",
                l.mtu < LIEN.mtu ? "trames de " + l.mtu + " octets" : "",
                coup24(l) > 0 ? pluriel(coup24(l), "coupure") + " sur 24 h" : ""].filter(Boolean).join(SEP); } },
    /* La premiere question d une panne : le serveur, la box ou l operateur ?
       Le debit est celui de TOUTE LA MAISON, puisque c est la box qui le mesure.
       ⚠️ LE REDEMARRAGE DE LA BOX EST AMBRE MAIS NE DECLENCHE RIEN. Il explique
       une panne du port du VPN, qui en suit souvent un, mais c est la carte VPN
       qui porte cette alerte : le dire deux fois teindrait la page pour un
       evenement deja passe. */
    /* Tailles mesurees le 16/10/2026 : comme Reseau local ; pendant une
       coupure, le texte de « Hors ligne » passe sur trois lignes a cote du
       nombre a 6 demi-rangees (feuille bento). */
    { n: "Internet", taille: "graphique", niveau: "normale", ajuste: { min: 350, formes: { 6: [360, 988], 7: [360, 988], 8: [360, 988], 9: [360, 988], 10: [360, 988] } }, d: "Fibre et box de la maison", ic: "internet", w: 2, per: 1,
      r: d => { const w = d.wan;
        // debut de la coupure EN COURS (16/10/2026), voir `debutCoupure`
        const coupe = coupureDepuis(d);
        /* Sans releve, la carte n avait qu une note au pied d un grand vide, et
           c est ce qu elle montrait pendant une coupure : une box qui ne repond
           pas, ou de travers, laisse `wan` vide et le dit dans `problemes`. */
        if (!w) {
          return (coupe ? hero("Hors ligne", "connexion coupée depuis " + coupe, "cr") : "")
            + `<div class="note">${boxMuette(d) ? "La box ne répond pas" : "Relevé de la box en attente"}</div>`;
        }
        const gb = k => k >= 1000000 ? vg(k / 1000000) + " Gb/s" : Math.round(k / 1000) + " Mb/s";
        const recent = w.boxup >= 0 && w.boxup < 86400;
        const h = (w.h || []).filter(x => Array.isArray(x) && x.length >= 3);
        /* Sur 7 jours : `wan.h7`, une ligne par heure close, meme forme. */
        const g = sept("Internet") ? (w.h7 || []).filter(x => Array.isArray(x) && x.length >= 3) : h;
        const der = (h.length ? h : g)[(h.length ? h : g).length - 1] || [];
        /* `muette` (systeme.py, 17/10/2026) : la box ne repond pas, seule la
           sonde de latence dit si Internet passe ; ni IPv6, ni abonnement, ni
           erreurs fibre, ni anciennete de la box. */
        const mu = !!w.muette;
        return (mu ? hero(w.ok ? "En ligne" : "Hors ligne", "la box ne répond pas"
                            + (w.ok ? "<br>Internet reste joignable" : coupe ? "<br>coupure depuis " + coupe : ""), w.ok ? "" : "cr")
                : w.ok ? hero("En ligne", "fibre · " + (w.v6 ? "IPv4 et IPv6" : "IPv4 seul")
                                        + (w.cd > 0 && w.cu > 0 ? "<br>abonnement " + gb(w.cd) + " ↓ · " + gb(w.cu) + " ↑" : ""))
                     : hero("Hors ligne", "la box n'a plus de connexion Internet" + (coupe ? "<br>depuis " + coupe : ""), "cr"))
          /* ⚠️ LA COURBE VIENT DE `wan.h` (09/10/2026), releve par systeme.py :
             [debut du creneau de 10 min, recu, envoye], en octets par seconde.
             Elle lisait des colonnes `wanrx`/`wantx` de l historique qui
             n existaient qu en demonstration : en production, la carte n a
             jamais affiche de courbe. */
          + (g.length > 1
             ? leg([["reçu", "#4d97ee", Mo(+der[1] || 0)], ["envoyé", "#34c759", Mo(+der[2] || 0)]])
               + graphe([{ v: g.map(x => +x[1] || 0), c: "#4d97ee", n: "reçu" },
                         { v: g.map(x => +x[2] || 0), c: "#34c759", n: "envoyé" }],
                        { f: MoAxe, u: "dbt", ts: g.map(x => x[0]), alt: "Débit de la box " + surP("Internet") })
             : `<div class="note">Débit en cours d'enregistrement</div>`)
          + past([w.lat > 0 ? ["latence " + w.lat + " ms", w.lat > 40 ? "wn" : ""] : ["latence : sans réponse", "wn"],
                  /* -1 ou absent : la box n a pas donne son anciennete. */
                  Number.isFinite(w.boxup) && w.boxup >= 0 ? ["box en service depuis " + anciennete(w.boxup), recent ? "wn" : ""] : null,
                  mu ? null : [err24(w) > 0 ? pluriel(err24(w), "erreur fibre", "erreurs fibre") + " sur 24 h" : "aucune erreur fibre sur 24 h",
                   err24(w) > 0 ? "wn" : "ok"]]);
      },
      /* Sans releve (17/10/2026) : coupure en cours au journal, ROUGE ; box qui
         ne repond pas, ambre (Internet marche peut-etre, mais on n en sait
         rien). La carte le disait sans que la pastille s allume. */
      warn: d => { const w = d.wan;
        if (!w) return debutCoupure(d) != null ? "crit" : boxMuette(d);
        if (!w.ok) return "crit"; if (w.muette) return true; return err24(w) > 0; },
      pourquoi: d => !d.wan ? (debutCoupure(d) != null ? "connexion coupée depuis " + coupureDepuis(d) : "la box ne répond pas")
        : d.wan.muette ? (d.wan.ok ? "la box ne répond pas" : "Internet injoignable, la box ne répond pas")
        : !d.wan.ok ? "la box n'a plus de connexion Internet"
        : pluriel(err24(d.wan), "erreur fibre", "erreurs fibre") + " sur 24 h" },
  ]},
  { n: "Bureau et infrastructure", i: "server", s: [
    /* Tailles mesurees le 16/10/2026 (pire etat : 12 345 678 req., 125 ms) :
       le contenu fait 144 px de haut a toute largeur, 3 demi-rangees suffisent
       (4 : 50 % de vide). 260 px : les trois pastilles sur une ligne. */
    { n: "AdGuard Home", taille: "moyenne", niveau: "normale", ajuste: { min: 260, l: 4, max: 6, h: [3, 3, 4], formes: { 3: [250, 738], 4: [220, 738], 5: [140, 220], 6: [140, 200] } }, ko: "adguard", d: "DNS filtrant du réseau", u: go("AdGuard Home"), ic: "adguard-home", w: 2,
      r: d => { const a = d.adguard;
        // Sans releve : une note, pas « Donnees illisibles » ni « undefined ms ».
        if (!a || a.q == null) return `<div class="note">Relevé d'AdGuard en attente</div>`;
        const t = a.q ? a.b / a.q * 100 : 0;
        return jauge(vg(t.toFixed(1)) + " %", "des requêtes bloquées", t, "var(--swn)")
          + past([[nb(a.q) + " req."], [nb(a.b) + " bloq."],
                  // latence absente, ou nulle faute de requete : pas de « 0 ms » invente
                  a.lat != null && a.q > 0 ? [a.lat + " ms", a.lat <= 20 ? "ok" : "wn"] : null]); } },
    /* Tailles mesurees le 16/10/2026 (pire etat : dix appareils, deux noms
       longs) : 198 px de contenu des 400 px grace aux tuiles de 68 px
       (bento/bureau.css). Sur telephone, 9 appareils et plus veulent 5
       demi-rangees. A 6 modules, trois appareils laissent un tiers de vide. */
    // `ko` : wg-easy sans reponse (collect.sh, 17/10/2026)
    { n: "WireGuard", taille: "moyenne", niveau: "normale", ajuste: { min: 400, l: 4, max: 5, h: [4, 4, 5], formes: { 4: [400, 560], 5: [340, 613], 6: [220, 380], 7: [220, 320], 8: [180, 200], 9: [180, 200] } }, ko: "wireguard", d: "VPN d'accès distant", u: go("WireGuard"), ic: "wireguard", w: 2,
      // Tuiles plutôt que lignes : dix appareils tiennent sur deux rangées au
      // lieu de dix. Grille calibrée à 68 px pour conserver au moins deux
      // colonnes même dans une carte étroite — à 84 px elle tombait à une seule
      // sous 240 px, et la hauteur de la carte augmentait de moitié.
      // Sans releve : une note, pas « Donnees illisibles » ni « undefined enregistre ».
      // Liste absente mais compteurs presents : les compteurs seuls.
      r: d => { const w = d.wg, cl = w && Array.isArray(w.clients) ? w.clients : [];
        if (!w || (w.t == null && !cl.length)) return `<div class="note">Relevé de WireGuard en attente</div>`;
        const c = w.c != null ? w.c : cl.filter(x => x.on).length, t = w.t != null ? w.t : cl.length;
        return (cl.length ? `<div class="wgg">` + cl.map(x =>
              `<div class="wgt${x.on ? " on" : ""}" title="${esc(x.n)}"><i></i><b>${esc(x.n)}</b></div>`).join("")
            + `</div>` : "")
            + past([[c > 0 ? c + " connecté" + (c > 1 ? "s" : "") : "Aucune connexion", c > 0 ? "ok" : ""],
                    [t + " enregistré" + (t > 1 ? "s" : "")]]); } },
    /* Le poste de travail, allumable et extinguible a distance depuis la page.

       ⚠️ TROIS ETATS, PAS DEUX. « Eteint » et « injoignable » se ressemblent vus
       du NAS — dans les deux cas la sonde ne repond pas — mais n appellent pas
       la meme reaction : le premier se reveille d un clic, le second veut qu on
       aille voir le cable. On les separe sur la DERNIERE VUE, que le collecteur
       persiste : au-dela de 24 h sans reponse, la machine n est plus consideree
       comme simplement eteinte, et la carte passe en alerte.

       ⚠️ La sonde teste le PORT 22, deja ouvert par le service SSH du poste, et
       non l ICMP que Windows bloque par defaut : un ping sans reponse aurait
       fait passer un PC allume pour eteint.

       ⚠️ LES BOUTONS NE FONT QU UNE CHOSE : deposer une demande. C est un
       veilleur du NAS qui l execute, apres l avoir validee contre une liste
       fixe. La page n a jamais le droit de lancer une commande.

       ⚠️ PLACEE AVANT LES DEUX CARTES-LIENS, et c est ce qui referme le bloc.
       La grille est un bento : une carte de donnees occupe DEUX rangees de
       100 px, une carte-lien une seule. Posee apres elles, cette carte ouvrait
       une rangee a elle seule et laissait la moitie droite vide ; posee avant,
       le placement automatique empile Vaultwarden et Dockge a sa droite. L ordre
       de cette liste est donc signifiant ici. */
    /* Tailles mesurees le 16/10/2026 (pire etat : « Extinction en cours »,
       et « Injoignable » avec le reveil demande) : 320 px, en dessous le
       libelle du bouton passe sur deux lignes. Les boutons plafonnent a 340 px :
       au-dela de 5 modules, la carte se vide sur les cotes. */
    { n: "PC fixe", taille: "moyenne", niveau: "essentielle", ajuste: { min: 320, l: 4, max: 5, h: [4, 4, 5], formes: { 4: [300, 613], 5: [180, 613], 6: [180, 280] } }, d: "Poste de travail", ic: "pc", w: 2,
      r: d => {
        const p = d.pc || {};
        const att = pcEnCours(p);          /* action en attente, ou null */
        const age = p.vu ? Math.max(0, Math.floor(Date.now() / 1000) - p.vu) : null;
        const perdu = !p.on && (age === null || age > 86400);
        /* Aucun releve du poste (ancien data.json) : le dire, plutot que
           « Injoignable » ; les boutons restent tels quels. */
        const rien = p.on == null && !p.vu;
        return (rien ? hero("—", "relevé du poste en attente")
                : p.on ? calme("<b>Allumé</b> — le poste répond")
                     : perdu ? hero("Injoignable", "hors du réseau", "wn")
                             : calme("<b>Éteint</b> — prêt à être réveillé"))
          + `<div class="pcb">
               <button data-pc="on" class="${att === "on" ? "att" : ""}"${att || p.on ? " disabled" : ""}>${
                 att === "on" ? "Réveil en cours" : "Allumer"}</button>
               <button data-pc="off" class="${att === "off" ? "att" : ""}"${att || !p.on ? " disabled" : ""}>${
                 att === "off" ? "Extinction en cours" : "Éteindre"}</button>
             </div>`
          /* Allume sans derniere vue (premiere passe) : « en ligne », pas
             « jamais vu ». Au-dela de 48 h, en jours : « 40 j », pas « 960 h ». */
          + (rien ? "" : past([[p.on ? "en ligne" : age === null ? "jamais vu"
                   : "vu il y a " + (age >= 172800 ? anciennete(age) : duree(Math.floor(age / 60))),
                   p.on ? "ok" : perdu ? "wn" : ""]]));
      },
      /* Sans aucun releve du poste, pas d alerte (17/10/2026) : la carte dit
         « relevé du poste en attente », la pastille disait « jamais vu ». */
      warn: d => { const p = d.pc || {};
        if (p.on == null && !p.vu) return false;
        return !p.on && (!p.vu || Math.floor(Date.now() / 1000) - p.vu > 86400); },
      pourquoi: d => { const p = d.pc || {};
        return !p.vu ? "jamais vu sur le réseau"
          : "injoignable depuis " + anciennete(Math.floor(Date.now() / 1000) - p.vu); } },
    /* Tailles mesurees le 16/10/2026 : l en-tete seul, 54 px de haut des
       3 modules (une demi-rangee de plus : 70 % de vide). Vaultwarden : 210 px
       avec un domaine de 27 caracteres, la moitie de la carte vide des
       4 modules. Dockge, plus court : rempli a 2 modules, 3 au plus (un tiers
       de vide, mais 2 modules de 79 px ne font que 170 px). */
    { n: "Vaultwarden", taille: "lien", niveau: "normale", ajuste: { min: 210, l: 3, max: 3, h: [2, 2, 2], formes: { 2: [200, 363] } }, d: "Coffre-fort de mots de passe",
      x: LIENS["Vaultwarden"], ic: "vaultwarden", mini: 1, w: 2 },
    { n: "Dockge", taille: "lien", niveau: "secondaire", ajuste: { min: 180, l: 2, max: 3, h: [2, 2, 2], formes: { 2: [180, 363], 3: [140, 160] } }, d: "Gestion des stacks Docker", u: go("Dockge"), ic: "dockge", mini: 1, w: 2 },
  ]},
);

