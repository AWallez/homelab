/* CONFIGURATION DU SITE — la seule piece qui differe d une installation a
 * l autre. Chargee AVANT `app.js`, qui n en sait rien et reste identique partout.
 *
 * ⚠️ L ORDRE COMPTE : la table appelle `go()` au moment ou elle se CONSTRUIT, pas
 * au rendu. Les aides de mise en forme (`hero`, `graphe`, `leg`…) ne sont
 * appelees qu a l interieur des fonctions flechees `r: d => …`, donc bien plus
 * tard, et vivent dans `app.js`.
 *
 * ⚠️ TOUT CE QUI IDENTIFIE L INSTALLATION EST ICI, et nulle part ailleurs :
 * adresse du serveur, ports, noms de services, liens internes et externes,
 * raccourcis, prefixes des piles de conteneurs, et la liste des cartes qui
 * portent une TACHE plutot qu un incident.
 * ⚠️ Le script de deploiement ne doit jamais ecraser ce fichier.
 */

/* ---- IP et go --------------------------------------------------- */
const IP = "nas.local";
const go = (n) => `http://${IP}:${n}`;

/* ---- Reglages des cartes systeme -------------------------------- */
/* Ce que le lien reseau du serveur DOIT negocier. En dessous, la carte passe
   a l ambre : un lien retombe a 1 Gb/s ou des trames geantes perdues se
   voient sinon seulement au debit, quand on s en sert. */
const LIEN = { vit: 10000, mtu: 9000 };

/* Ecart minimal entre deux sauvegardes, tel que le script de sauvegarde
   l applique : sert a annoncer l heure de la prochaine copie. */
const SAUVEGARDE_ECART_H = 20;

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
    { n: "Site", d: "Vitrine freelance", x: "https://example.com", ic: "portfolio",
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
        return (s.ok === false
                 ? hero("injoignable", "le site ne répond pas", "cr")
                 : hero((s.ms || 0) + " ms", "de temps de réponse"))
          + past([bilan,
                  med ? ["médiane " + med + " ms"] : null,
                  pic ? ["pointe " + pic + " ms", pic >= 1000 ? "wn" : ""] : null,
                  [s.cert < 0 ? "certificat ?" : "certificat " + s.cert + " j",
                   s.cert >= 0 && s.cert < 15 ? "wn" : ""]]);
      },
      warn: d => (d.site || {}).ok === false
              || ((d.site || {}).cert >= 0 && d.site.cert < 15) },
    { n: "CRM", d: "Suivi des leads et prospects", u: go(8100), ic: "crm",
      r: d => { const c = d.crm || {};
        return hero(d.leads, "leads non lus<br>en attente de réponse", d.leads > 0 ? "wn" : "")
          + past([[(c.tot || 0) + " reçus"], [(c.traites || 0) + " traités"],
                  [c.age > 0 ? "il y a " + c.age + " j" : c.age === 0 ? "aujourd'hui" : "—"]]); },
      warn: d => d.leads > 0 },
    { n: "Statistiques", d: "Fréquentation du portfolio", u: go(3002),
      x: "https://stats.example.com", ic: "stats", w: 2,
      r: d => `<div class="stat7"><div class="s7n"><b>${d.umami.visitors}</b>`
            + `<span>visiteurs<br>sur 7 jours</span></div>`
            + jours(d.umami.serie) + `</div>`
            + past([[d.umami.visits + " visites"], [d.umami.views + " pages vues"]]) },
  ]},
  { n: "Médiathèque", i: "play", s: [
    { n: "Jellyfin", d: "Films, séries et animés", u: go(8096),
      x: "https://media.example.com", ic: "jellyfin", w: 2,
      r: d => d.jellyfin.now
            ? calme("<b>" + esc(d.jellyfin.now) + "</b>", "bl")
              + past([[d.jellyfin.films + " films"], [d.jellyfin.series + " séries"],
                      [d.jellyfin.episodes + " épisodes"]])
            : mesures([[d.jellyfin.films, "films"], [d.jellyfin.series, "séries"],
                       [d.jellyfin.episodes, "épisodes"]])
              + `<div class="note">Aucune lecture en cours</div>` },
    { n: "Seerr", d: "Demandes de la famille", u: go(5055),
      x: "https://demandes.example.com", ic: "seerr", w: 2,
      r: d => (d.seerr.pending > 0
            ? hero(d.seerr.pending, "demandes<br>en attente", "wn")
            : calme("<b>Aucune demande en attente</b>"))
            + past([[d.seerr.done + " complétées", d.seerr.pending > 0 ? "" : "ok"]]),
      warn: d => d.seerr.pending > 0 },
    { n: "FanKarr", d: "Catalogue FanKai", u: go(9898), x: "https://catalogue.example.com",
      ic: "fankarr.ico", mini: 1, w: 4,
      /* Ce que FanKarr a telecharge (06/10/2026, demande : « des
         pastilles comme Sonarr et Radarr »), lu par systeme.py dans ses fichiers
         de suivi. LES DEUX MEMES que Sonarr et Radarr, en cours et place prise :
         le nombre d episodes, la serie suivie et le dernier import ont ete
         essayes puis retires a sa demande. Le collecteur les fournit toujours.
         ⚠️ Aucune alerte : FanKarr ne signale ni manque ni echec exploitable. */
      r: d => { const f = d.fankarr;
        if (!f) return `<div class="note">Relevé de FanKarr en attente</div>`;
        return past([[f.cours ? f.cours + " en téléchargement" : "aucun téléchargement"], [Go(f.o)]]);
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
    { n: "Prowlarr", d: "Indexeurs et trackers", u: go(9696), ic: "prowlarr",
      r: d => {
        const p = d.prowlarr || {};
        const ix = p.ix || [];
        const ko = p.sante || 0;
        const tot = ix.reduce((a, x) => a + (+x.g || 0), 0);
        return (ko > 0
              ? hero(ko, "problème" + (ko > 1 ? "s" : "") + " signalé"
                        + (ko > 1 ? "s" : "") + "<br>par Prowlarr", "wn")
              : ix.length
                ? calme("<b>" + ix.length + " indexeurs actifs</b> — "
                        + nb(tot) + " captures")
                : `<div class="note">Prowlarr ne répond pas</div>`)
          + past(ko > 0 && p.msg
                 ? [[p.msg, "wn"]]
                 : ix.map(x => [x.n + " " + nb(x.g)]));
      },
      warn: d => ((d.prowlarr || {}).sante || 0) > 0
              || !(((d.prowlarr || {}).ix) || []).length },
    { n: "Radarr", d: "Films — recherche et import", u: go(7878), ic: "radarr",
      r: d => (d.radarr.mis > 0
            ? hero(d.radarr.mis, "films manquants<br>à retrouver", "wn")
            : calme("<b>Aucun film manquant</b>"))
            + past([[d.radarr.q ? d.radarr.q + " en téléchargement" : "aucun téléchargement"],
                    [Go(d.radarr.size)]]),
      warn: d => d.radarr.mis > 0 },
    { n: "Sonarr", d: "Séries — recherche et import", u: go(8989), ic: "sonarr",
      r: d => (d.sonarr.mis > 0
            ? hero(d.sonarr.mis, "épisodes manquants<br>à retrouver", "wn")
            : calme("<b>Aucun épisode manquant</b>"))
            + past([[d.sonarr.q ? d.sonarr.q + " en téléchargement" : "aucun téléchargement"],
                    [Go(d.sonarr.size)]]),
      warn: d => d.sonarr.mis > 0 },
    { n: "Bazarr", d: "Sous-titres français", u: go(6767), ic: "bazarr",
      r: d => (d.bazarr.ep + d.bazarr.mv > 0
            ? hero(d.bazarr.ep + d.bazarr.mv, "médias<br>sans sous-titre", "wn")
              + past([[d.bazarr.ep + " épisodes"], [d.bazarr.mv + " films"]])
            : calme("<b>Tout est sous-titré</b> — 0 film, 0 épisode en attente")),
      warn: d => d.bazarr.ep + d.bazarr.mv > 0 },
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
    { n: "qBittorrent", d: "Client torrent, sous VPN", u: go(8080), ic: "qbittorrent",
      w: 2,
      r: d => {
        const q = d.qbit || {};
        const E = {
          connected: [nb(q.pairs || 0) + " pairs connectés",
                      "connexion établie · port entrant joignable", 1],
          firewalled: ["Port entrant injoignable",
                       "le client tourne, mais plus personne ne peut lui demander", 0],
          disconnected: ["Hors ligne", "qBittorrent n'atteint pas le réseau", 0],
        }[q.etat] || ["État inconnu", "qBittorrent n'a pas répondu", 0];

        /* SILHOUETTE et non graphique. Un debit n est pas une mesure qu on
           vient lire ici, juste une activite qu on constate — la valeur du
           moment est deja dans la legende. `aire()` n a ni axe ni etiquette,
           et le CSS le plafonne a 88 px.
           Bonus : plus d etiquettes, donc plus de probleme de lisibilite a
           demi-largeur, ou elles seraient tombees a 8 px. */
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
        const act = aire([{ v: ulf, c: "#34c759", n: "envoyé" }, { v: dlf, c: "#4d97ee", n: "reçu" }],
                           null, { u: "dbt", ts: Hf(d, "t") })
          || `<div class="note">Activité en cours d'enregistrement</div>`;

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
        const SEUIL = { Vega: 0.8 };
        /* Ordre d affichage, du tracker le plus suivi au moins suivi.
           ⚠️ CE N EST PAS L ORDRE ALPHABETIQUE, qui donnait Vega, Altair, Orion :
           il classe sur une initiale, ce qui ne veut rien dire pour qui lit la
           carte. Un tracker absent de cette liste passe APRES, par ordre
           alphabetique — il apparait donc quand meme, au lieu de disparaitre ou
           de squatter la premiere place. */
        const ORDRE = ["Altair", "Vega", "Orion"];
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
        const lig = (n, v, cl, q) => `<div class="trk" data-lec="ratio" data-q="${esc(q)}"><span class="n">${esc(n)}</span>`
          + `<b${cl ? ` class="${cl}"` : ""}>${esc(v)}</b>`
          + `</div>`;
        const trk = (t) => {
          const v = t.vr;
          if (!v) return lig(t.n, "—", "", "pas de relevé");
          const age = v.ts ? Math.max(0, Math.floor(Date.now() / 1000) - v.ts) : 0;
          const vu = age > AGE ? "relevé il y a " + duree(age / 60) : "";
          if (v.inf) return lig(t.n, "∞", "ok inf",
            vu || vol(v.up || 0) + " envoyés, rien reçu");
          const c = SEUIL[t.n] || 1;
          return lig(t.n, vg((+v.r).toFixed(2)), v.r >= c ? "ok" : "wn",
            vu || (SEUIL[t.n] ? "minimum " + vg(c.toFixed(2))
                              : "cible " + vg(c.toFixed(2))));
        };
        const trs = (q.tr || []).slice()
          .sort((a, b) => rang(a.n) - rang(b.n)
                         || (a.n || "").localeCompare(b.n || ""));
        return etatv(E[0], E[1], !!E[2])
          + `<div class="duo tro"><div>`
            + `<div class="trkh">Activité sur 24 h</div>`
            + leg([["envoi", "#34c759", Mo(q.ul || 0)],
                   ["réception", "#4d97ee", Mo(q.dl || 0)]])
            + act
            /* ⚠️ MEME AXE QUE LA COURBE, et ce n est pas un hasard : `aire` etale les
               145 points sur toute la largeur, `echelle` place ses reperes en
               pourcentage de cette meme largeur, et les deux lisent la meme serie.
               Aucune conversion, donc aucun decalage possible.
               ⚠️ Pas de SIX heures ici, contre trois sur les rubans : la
               silhouette occupe environ 256 px, ou huit reperes seraient espaces
               de 32 px pour des etiquettes de 24. Le pas suit la largeur. */
            + echelle(Hn(d, "t"), 6)
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
      warn: d => ((d.qbit || {}).etat || "") !== "connected" },
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
    { n: "Cross-seed", d: "Ratio multi-trackers", ic: "cross-seed", w: 2,
      r: d => {
        const c = d.cross || {};
        if (!c.nb && !c.run) return `<div class="note">Relevé cross-seed indisponible</div>`;
        const age = c.run ? Math.max(0, Math.floor(Date.now() / 1000) - c.run) : 0;
        const vieux = !c.run || age > 172800;
        return hero(nb(c.nb || 0), "torrents<br>cross-seed")
          + past([c.purge > 0 ? [nb(c.purge) + " à purger cette nuit", "wn"] : null,
                  c.actifs > 0 ? [nb(c.actifs) + " en partage", "ok"] : null,
                  c.envoye > 0 ? [vol(c.envoye) + " envoyés"] : null,
                  c.match > 0 ? [nb(c.match) + " correspondances"] : null,
                  [c.run ? "recherche il y a " + duree(age / 60) : "aucune recherche",
                   vieux ? "wn" : ""],
                  c.idxtot > 0 ? [c.idx + "/" + c.idxtot + " indexeurs",
                                  c.idx < c.idxtot ? "wn" : ""] : null]);
      },
      warn: d => { const c = d.cross || {};
        return (c.idxtot > 0 && c.idx < c.idxtot)
            || (!!c.run && (Date.now() / 1000 - c.run) > 172800); } },
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
    { n: "VPN", d: "Tunnel le fournisseur VPN du client torrent", ic: "proton-vpn", w: 4,
      x: "https://example.com/vpn",
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

        return etatv(d.vpn.ip || "aucune IP",
                d.vpn.health === "healthy"
                  ? "Tunnel actif · " + (d.vpn.loc || "localisation inconnue")
                  : "Tunnel en défaut (" + (d.vpn.health || "inconnu") + ")",
                d.vpn.health === "healthy" && !!d.vpn.ip)
          + rubanH(d, "vpnup", "Joignabilité du port entrant", 1)
          + past([[d.vpn.port
                     ? "port " + d.vpn.port + (d.vpn.open ? " ouvert" : " injoignable")
                     : "aucun port",
                   d.vpn.open ? "ok" : "wn"],
                  bilan,
                  ["le fournisseur VPN · WireGuard"]]);
      },
      warn: d => d.vpn.health !== "healthy" || !d.vpn.ip || !d.vpn.open },
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
    { n: "Mises à jour", d: "À appliquer à la main", pop: "updates", ic: "maj", w: 2,
      r: d => {
        const u = d.updates || {};
        const att = (u.items || []).filter(x => x.upd);
        const perdu = u.age < 0;
        const vieux = perdu || u.age > 36;
        const base = (n) => /postgres|db$|broker/.test(n);
        return (u.total > 0
              ? hero(u.total, "conteneur" + (u.total > 1 ? "s" : "")
                     + "<br>à mettre à jour", "wn")
              : calme("<b>Tout est à jour</b> — "
                      + (u.verifies || 0) + " conteneurs vérifiés"))
          + past(att.slice(0, 4).map(x => [x.n + (base(x.n) ? " · base" : ""),
                                           base(x.n) ? "wn" : ""])
              .concat(att.length > 4 ? [["+ " + (att.length - 4)]] : [])
              .concat([[perdu ? "contrôle introuvable"
                        : vieux ? "contrôle vieux de " + duree(u.age * 60)
                        : "contrôle du " + (u.maj || "?"),
                        vieux ? "wn" : ""]]));
      },
      warn: d => (d.updates || {}).total > 0
              || (d.updates || {}).age < 0 || (d.updates || {}).age > 36 },
    /* L age seul disait DE QUAND date la copie, pas si elle est complete ni si
       elle se relira. Depuis le 05/10/2026 le script de sauvegarde laisse un
       compte rendu : ce qui est parti, la duree, les versions gardees, et le
       resultat du controle d integrite du dimanche, qui relit une partie des
       donnees deja deposees sur le PC.
       ⚠️ Les pastilles n apparaissent qu avec `t`, l heure de la copie : un
       collecteur qui n ecrit encore que l age laisse la carte telle qu avant. */
    { n: "Sauvegarde", d: "Copie chiffrée vers le PC", ic: "sauvegarde", w: 2,
      r: d => { const b = d.backup || {};
        const chk = b.chk || null;
        return jauge(b.h < 0 ? "jamais" : "il y a " + b.h + " h",
                    "seuil d'alerte à 48 h",
                    b.h < 0 ? 100 : b.h / 48 * 100,
                    (b.h < 0 || b.h > 48) ? "var(--scr)"
                      : b.h > 24 ? "var(--swn)" : "var(--sok)")
          + (b.t ? past([[b.date],
                         b.add != null ? ["+ " + taille(b.add) + " envoyés"] : null,
                         b.dur != null ? ["durée " + chrono(b.dur)] : null,
                         b.snap ? [b.snap + " versions gardées"] : null,
                         !chk ? ["intégrité jamais vérifiée"]
                         : chk.ok ? ["intégrité vérifiée il y a "
                                     + anciennete(Math.max(0, Date.now() / 1000 - chk.t)), "ok"]
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
        if (b.h < 0) return "Aucune sauvegarde enregistrée";
        if (!b.t) return "Dernière copie le " + b.date;
        const p = b.t + SAUVEGARDE_ECART_H * 3600, on = (d.pc || {}).on;
        if (p <= Date.now() / 1000)
          return on ? "Copie imminente : le PC est allumé" : "Prochaine copie dès que le PC s'allume";
        const dt = new Date(p * 1000);
        return "Prochaine copie " + (dt.toDateString() === new Date().toDateString() ? "" : "demain ")
          + "vers " + dt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", " h ")
          + (on ? "" : ", si le PC est allumé");
      },
      warn: d => d.backup.h > 48 || d.backup.h < 0
              || ((d.backup || {}).chk || {}).ok === false },
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
    { n: "Système", d: "Processeur, mémoire et swap sur 24 h", ic: "systeme", w: 2,
      r: d => leg([["processeur", "#4d97ee", pct(d.nas.cpu)],
                   ["mémoire", "#34c759", pct(d.nas.ram)],
                   ["swap", "#ffb340", pct(d.nas.swap)]])
            + graphe([{ v: Hf(d, "cpu"), c: "#4d97ee", n: "processeur" },
                      { v: Hf(d, "ram"), c: "#34c759", n: "mémoire" },
                      { v: Hf(d, "swap"), c: "#ffb340", n: "swap" }],
                     { max: 100, f: pct, seuil: 60, u: "%", ts: Hf(d, "t"),
                       alt: "Processeur, mémoire et swap sur 24 h" })
            + past([["charge " + vg(d.nas.load) + " → " + vg(d.nas.load5 || d.nas.load)
                      + " → " + vg(d.nas.load15 || d.nas.load) + " / " + (d.nas.cores || 1),
                     d.nas.load >= (d.nas.cores || 1) ? "wn" : ""],
                    ["pointe swap " + Math.round(Math.max(0, ...Hf(d, "swap"))) + " %",
                     Math.max(0, ...Hf(d, "swap")) >= 60 ? "wn" : ""],
                    ["disque " + Mo(d.nas.dr || 0) + " lu"],
                    ["disque " + Mo(d.nas.dw || 0) + " écrit"],
                    d.nas.disk >= 85
                      ? [To(d.nas.disktot * d.nas.disk / 100) + " / "
                         + To(d.nas.disktot) + " To", d.nas.disk >= 92 ? "wn" : ""]
                      : null,
                    d.nas.temp >= 70
                      ? [Math.round(d.nas.temp) + " °C", d.nas.temp >= 85 ? "wn" : ""]
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
      warn: d => d.nas.ram >= 90 || d.nas.disk >= 92 || d.nas.temp >= 85
              || d.nas.swap >= 60 },
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
    { n: "Températures", d: "Capteurs matériels sur 24 h", ic: "temp", w: 2,
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
          + graphe([{ v: Hf(d, "temp"), c: "#ff9f0a", n: "processeur" }]
              .concat(dq.map((n, i) => ({ v: Hf(d, n), c: TEINTES[i % TEINTES.length], d0: 1, n: nomDisque(n) })))
              .concat([{ v: Hf(d, "eth0"), c: "#c07bf0", d0: 1, n: "réseau 10 GbE" }]),
              { min: 30, max: 90, f: dg, u: "°C", ts: Hf(d, "t"),
                alt: "Températures du NAS sur 24 h" })
          + past([["pointe processeur " + mx("temp") + " °C", mx("temp") >= 85 ? "wn" : ""],
                  ["pointe disques " + pd + " °C", pd >= 70 ? "wn" : ""],
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
        return d.nas.temp >= 85 || disquesHist(d).some(n => val(n) >= 70)
          || (d.nas.fans || []).some(f => f.rpm < VENTILO_MIN);
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
       ⚠️ RETIRES A LA DEMANDE D ALEXIS : la pastille de pression (elle compte
       toujours dans le verdict, sans s afficher) et le bandeau des redemarrages
       automatiques des conteneurs. */
    { n: "Mémoire", d: "Ce que contient la RAM, et qui la prend", ic: "memoire", w: 2, pop: "conteneurs",
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
          + rangsDuo(g.map(x => { const k = grp(x.k);
              return [k[0] + (x.n ? " (" + x.n + ")" : ""),
                      moGo(x.mo) + (x.t > 0 ? " + " + moGo(x.t) + " tassés" : ""),
                      x.mo / M * 100, (x.t || 0) / M * 100, k[2],
                      x.p > x.mo * 1.3 ? "pointe " + moGo(x.p) : k[1]]; }));
      },
      warn: d => !!d.mem && d.mem.tot > 0 && etatMemoire(d.mem)[1] === "cr" },
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
    { n: "Stockage", d: "Volumes et disques", ic: "ssd", w: 2,
      r: d => grappesDisques(d.smart, { ESPACE, ROLES }),
      warn: d => { const s = d.smart || {};
        return (s.d || []).some(x => !x.ok || x.erreurs > 0 || x.usure >= 80)
          || (s.grappes || []).some(g => g.err > 0 || (!g.sys && g.n < g.att)); } },
    { n: "Uptime Kuma", d: "Sondes et alertes", u: go(3001), ic: "uptime-kuma", w: 4,
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
        const ko = som("ko"), att = som("att");
        const tot = som("tot") || (+d.kuma.up || 0) + (+d.kuma.down || 0);
        const pl = (n, s) => nb(n) + " sonde" + (n > 1 ? "s " : " ") + s;
        return rubanH(d, "kumaup", "Stabilité des sondes", 1)
          + grpk(gs)
          + past([ko > 0 ? [pl(ko, "hors ligne"), "wn"] : null,
                  att > 0 ? [pl(att, "en attente"), "wn"] : null,
                  ko + att === 0 ? [pl(tot, "en ligne"), "ok"]
                                 : [nb(tot - ko - att) + " en ligne"],
                  d.kuma.pc ? ["stabilité " + vg(d.kuma.pc) + " %"] : null]);
      },
      warn: d => d.kuma.down > 0
             || ((d.kuma.groupes || []).some(g => (+g.ko || 0) + (+g.att || 0) > 0)) },
    { n: "ntfy", d: "Notifications push", u: go(8081),
      x: "https://notifs.example.com", ic: "ntfy", mini: 1, w: 4 },
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
    { n: "Sécurité", d: "Contrôles du serveur", ic: "securite", w: 2,
      r: d => { const s = d.secu;
        if (!s) return `<div class="note">Contrôles en attente</div>`;
        const ouv = s.ouverts || [], manq = s.manq || [];
        const pl = (n, m) => n > 1 ? m : "";
        return controles([
          ouv.length ? ["wn", ouv.length + " fichier" + pl(ouv.length, "s") + " sensible" + pl(ouv.length, "s")
                              + " lisible" + pl(ouv.length, "s") + " par tous",
                        ouv.slice(0, 2).join(", ") + (ouv.length > 2 ? "…" : "")]
                     : ["ok", "Fichiers sensibles fermés", s.verifies ? s.verifies + " vérifiés" : ""],
          manq.length ? ["wn", manq.length + " réseau" + pl(manq.length, "x") + " Docker sans règle", manq.slice(0, 2).join(", ")]
          /* `fw` vaut null quand les regles n ont pas pu etre lues : on le dit,
             plutot que d afficher « null regles en place ». */
          : s.fw == null ? ["in", "Pare-feu : contrôle en attente", ""]
          : ["ok", "Pare-feu : " + s.fw + " règles en place", "liste blanche"],
          [s.refus > 20 ? "wn" : "ok", nb(s.refus) + " connexion" + pl(s.refus, "s") + " refusée" + pl(s.refus, "s"), "sur 24 h"],
          s.ext > 0 ? ["wn", s.ext + " connexion" + pl(s.ext, "s") + " depuis Internet", "sur 24 h"]
                    : ["ok", "Aucun accès depuis Internet", "réseau local et VPN"],
          s.ssh ? ["in", "SSH ouvert", "se referme seul"] : ["ok", "SSH fermé", ""]]);
      },
      warn: d => { const s = d.secu || {};
        return (s.ouverts || []).length > 0 || (s.manq || []).length > 0 || s.ext > 0 || s.refus > 20; } },
    /* Qui est connecte maintenant, et les dernieres connexions. Les adresses
       arrivent TRADUITES EN NOMS par le collecteur (« PC fixe », le nom d un
       client WireGuard) ; une adresse hors du reseau local et du VPN passe a
       l ambre, et c est la seule condition d alerte. Un clic ouvre les 24 h
       entieres, heure par heure puis connexion par connexion (`popAcces`). */
    { n: "Accès", d: "Qui est connecté, et d'où", ic: "acces", w: 2, pop: "acces",
      r: d => { const a = d.acces;
        if (!a) return `<div class="note">Relevé des connexions en attente</div>`;
        return intertitre("Connectés maintenant") + sessions(a.now || [])
          + intertitre("Dernières connexions")
          + ((a.log || []).length ? journal(a.log, 4) : `<div class="note">Aucune connexion enregistrée</div>`);
      },
      note: d => { const a = d.acces;
        if (!a) return null;
        return nb(a.n) + " connexion" + (a.n > 1 ? "s" : "") + " sur 24 h · "
          + (a.ext > 0 ? a.ext + " depuis Internet" : "toutes depuis le réseau local ou le VPN");
      },
      warn: d => (d.acces || {}).ext > 0 },
    /* Le lien du serveur vers le switch. Il passe a l ambre s il negocie moins
       que prevu, s il perd ses trames geantes, ou s il est TOMBE ET REMONTE
       depuis le demarrage : c est ce que produit un switch qui se fige.
       La courbe est la colonne `reseau`, collectee depuis l origine et jamais
       affichee jusqu ici : recu et envoye confondus. */
    { n: "Réseau local", d: "Lien du serveur vers le switch", ic: "reseau", w: 2,
      r: d => { const l = d.lan;
        if (!l) return `<div class="note">Relevé du lien en attente</div>`;
        const v = Hf(d, "reseau"), red = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
        const lent = l.vit > 0 && l.vit < LIEN.vit, petit = l.mtu < LIEN.mtu;
        return (l.up ? hero(l.vit >= 1000 ? vg(l.vit / 1000) + " Gb/s" : l.vit + " Mb/s",
                            "lien vers le switch<br>" + (l.mtu >= 9000 ? "trames géantes " + l.mtu
                                                                       : "trames de " + l.mtu + " octets"),
                            lent || petit ? "wn" : "")
                     : hero("Coupé", "le serveur n'a plus de lien réseau", "cr"))
          + (aire([{ v, c: "#4d97ee", n: "trafic" }], null, { u: "dbt", ts: Hf(d, "t") })
             || `<div class="note">Trafic en cours d'enregistrement</div>`)
          + past([v.length ? ["moyenne " + Mo(red)] : null,
                  v.length ? ["pointe " + Mo(Math.max(...v))] : null,
                  [l.coup > 0 ? l.coup + " coupure" + (l.coup > 1 ? "s" : "") + " depuis le démarrage"
                              : "lien stable depuis le démarrage", l.coup > 0 ? "wn" : "ok"],
                  [nb(l.err) + " erreur" + (l.err > 1 ? "s" : "") + " reçue" + (l.err > 1 ? "s" : ""),
                   l.err > 10000 ? "wn" : ""]]);
      },
      warn: d => { const l = d.lan;
        return !!l && (!l.up || (l.vit > 0 && l.vit < LIEN.vit) || l.mtu < LIEN.mtu || l.coup > 0); } },
    /* La premiere question d une panne : le serveur, la box ou l operateur ?
       Le debit est celui de TOUTE LA MAISON, puisque c est la box qui le mesure.
       ⚠️ LE REDEMARRAGE DE LA BOX EST AMBRE MAIS NE DECLENCHE RIEN. Il explique
       une panne du port du VPN, qui en suit souvent un, mais c est la carte VPN
       qui porte cette alerte : le dire deux fois teindrait la page pour un
       evenement deja passe. */
    { n: "Internet", d: "Fibre et box de la maison", ic: "internet", w: 2,
      r: d => { const w = d.wan;
        if (!w) return `<div class="note">Relevé de la box en attente</div>`;
        const gb = k => k >= 1000000 ? vg(k / 1000000) + " Gb/s" : Math.round(k / 1000) + " Mb/s";
        const recent = w.boxup >= 0 && w.boxup < 86400;
        return (w.ok ? hero("En ligne", "fibre · " + (w.v6 ? "IPv4 et IPv6" : "IPv4 seul")
                                        + "<br>abonnement " + gb(w.cd) + " ↓ · " + gb(w.cu) + " ↑")
                     : hero("Hors ligne", "la box n'a plus de connexion Internet", "cr"))
          + (aire([{ v: Hf(d, "wantx"), c: "#34c759", n: "envoyé" },
                   { v: Hf(d, "wanrx"), c: "#4d97ee", n: "reçu" }], null, { u: "dbt", ts: Hf(d, "t") })
             || `<div class="note">Débit en cours d'enregistrement</div>`)
          + past([w.lat > 0 ? ["latence " + w.lat + " ms", w.lat > 40 ? "wn" : ""] : ["latence : sans réponse", "wn"],
                  ["box en service depuis " + anciennete(w.boxup), recent ? "wn" : ""],
                  [w.err > 0 ? nb(w.err) + " erreurs fibre" : "0 erreur fibre", w.err > 0 ? "wn" : "ok"]]);
      },
      warn: d => { const w = d.wan; return !!w && (!w.ok || w.err > 0); } },
  ]},
  { n: "Bureau et infrastructure", i: "server", s: [
    { n: "AdGuard Home", d: "DNS filtrant du réseau", u: go(3000), ic: "adguard-home", w: 2,
      r: d => { const t = d.adguard.q ? d.adguard.b / d.adguard.q * 100 : 0;
        return jauge(vg(t.toFixed(1)) + " %", "des requêtes bloquées", t, "var(--swn)")
          + past([[nb(d.adguard.q) + " req."], [nb(d.adguard.b) + " bloq."],
                  [d.adguard.lat + " ms", d.adguard.lat <= 20 ? "ok" : "wn"]]); } },
    { n: "WireGuard", d: "VPN d'accès distant", u: go(51821), ic: "wireguard", w: 2,
      // Tuiles plutôt que lignes : dix appareils tiennent sur deux rangées au
      // lieu de dix. Grille calibrée à 68 px pour conserver au moins deux
      // colonnes même dans une carte étroite — à 84 px elle tombait à une seule
      // sous 240 px, et la hauteur de la carte augmentait de moitié.
      r: d => `<div class="wgg">` + (d.wg.clients || []).map(c =>
              `<div class="wgt${c.on ? " on" : ""}"><i></i><b>${esc(c.n)}</b></div>`).join("")
            + `</div>`
            + past([[d.wg.c > 0 ? d.wg.c + " connecté" + (d.wg.c > 1 ? "s" : "") : "Aucune connexion",
                     d.wg.c > 0 ? "ok" : ""],
                    [d.wg.t + " enregistré" + (d.wg.t > 1 ? "s" : "")]]) },
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
    { n: "PC fixe", d: "Poste de travail", ic: "pc", w: 2,
      r: d => {
        const p = d.pc || {};
        const att = pcEnCours(p);          /* action en attente, ou null */
        const age = p.vu ? Math.max(0, Math.floor(Date.now() / 1000) - p.vu) : null;
        const perdu = !p.on && (age === null || age > 86400);
        return (p.on ? calme("<b>Allumé</b> — le poste répond")
                     : perdu ? hero("Injoignable", "hors du réseau", "wn")
                             : calme("<b>Éteint</b> — prêt à être réveillé"))
          + `<div class="pcb">
               <button data-pc="on" class="${att === "on" ? "att" : ""}"${att || p.on ? " disabled" : ""}>${
                 att === "on" ? "Réveil en cours" : "Allumer"}</button>
               <button data-pc="off" class="${att === "off" ? "att" : ""}"${att || !p.on ? " disabled" : ""}>${
                 att === "off" ? "Extinction en cours" : "Éteindre"}</button>
             </div>`
          + past([[age === null ? "jamais vu"
                   : p.on ? "en ligne" : "vu il y a " + duree(Math.floor(age / 60)),
                   p.on ? "ok" : perdu ? "wn" : ""]]);
      },
      warn: d => { const p = d.pc || {};
        return !p.on && (!p.vu || Math.floor(Date.now() / 1000) - p.vu > 86400); } },
    { n: "Vaultwarden", d: "Coffre-fort de mots de passe",
      x: "https://coffre.example.com", ic: "vaultwarden", mini: 1, w: 2 },
    { n: "Dockge", d: "Gestion des stacks Docker", u: go(5001), ic: "dockge", mini: 1, w: 2 },
  ]},
);

/* ---- DEF -------------------------------------------------------- */
const DEF = [{ name: "Documentation", url: "https://developer.mozilla.org/fr/" },
  { name: "Forge",      url: "https://github.com/" },
  { name: "Conteneurs", url: "https://hub.docker.com/" },
  { name: "Veille",     url: "https://news.ycombinator.com/" }];

/* ---- PILES et AUTRES -------------------------------------------- */
const PILES = [
  { k: "arr-",       n: "Stack *arr", c: "#3987e5" },
  { k: "umami",      n: "Umami",      c: "#c98500" },
  { k: "portfolio-", n: "Portfolio",  c: "#d55181" }
];
const AUTRES = { n: "Infrastructure", c: "#d95926" };

/* ---- TACHES ----------------------------------------------------- */
const TACHES = ["CRM", "Seerr", "Radarr", "Sonarr", "Bazarr", "Mises à jour"];

