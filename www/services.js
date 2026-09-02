/* CONFIGURATION DU SITE — la seule piece qui differe d une installation a
 * l autre. Charge AVANT `app.js`, qui n en sait rien et reste identique
 * partout.
 *
 * ⚠️ L ORDRE COMPTE : la table appelle `go()` au moment ou elle se CONSTRUIT,
 * pas au rendu. Les aides de mise en forme (`hero`, `graphe`, `leg`…) ne sont
 * appelees qu a l interieur des fonctions flechees `r: d => …`, donc bien plus
 * tard, et vivent dans `app.js`.
 *
 * ⚠️ TOUT CE QUI IDENTIFIE L INSTALLATION EST ICI, et nulle part ailleurs :
 * adresse du serveur, ports, noms de services, liens internes et externes,
 * raccourcis par defaut, prefixes des piles de conteneurs, et la liste des
 * cartes qui portent une TACHE plutot qu un incident.
 * Le script de deploiement ne doit jamais ecraser ce fichier.
 */

/* ---- IP et go --------------------------------------------------- */
const IP = "nas.local";
const go = (n) => `http://${IP}:${n}`;

/* ---- GROUPS ----------------------------------------------------- */
const GROUPS = [
  { n: "Portfolio", i: "briefcase", s: [
    /* Refonte du 24/08/2026.

       La carte affichait deux nombres dont aucun ne demandait jamais rien.
       Le certificat est renouvelé par Caddy au tiers de sa vie restante,
       vers trente jours : la valeur oscille éternellement entre 90 et 30 et
       ne peut pas approcher le seuil d'alerte de 15 sans que le
       renouvellement soit déjà cassé depuis deux semaines. Le temps de
       réponse, lui, était mesuré chaque minute et JAMAIS conservé : un
       échantillon nu, sans médiane ni référence, qu'on ne pouvait ni
       comparer ni juger.

       Ce que la carte ne disait pas, c'est si le site avait été JOIGNABLE,
       la seule question qui compte pour une vitrine. Elle le dit en pastille,
       avec la DURÉE EXACTE de coupure sur sept jours, et le certificat y
       descend lui aussi, consultable sans occuper la moitié de la carte.

       ⚠️ RUBAN RETIRÉ LE 28/08/2026, quatre jours après son ajout. Il montrait
       la joignabilité sur 24 h, une case par demi-heure, et n'a jamais affiché
       autre chose que du vert : zéro créneau dégradé sur 24 h comme sur 7 j.
       La pastille dit déjà mieux ce qu'il montrait moins bien — une durée
       exacte plutôt qu'un instant approximatif d'une panne qui n'arrive pas.

       Il souffrait en outre de `.vizb > .batt { flex: 1 1 auto; min-height: 0 }`,
       règle pensée pour les composants qui gagnent à s'étendre : sa hauteur
       n'était pas choisie mais SUBIE, c'était ce qui restait sous les
       pastilles. D'où 24 px de bloc vert plein quand la carte était large, et
       ZÉRO PIXEL quand les pastilles passaient sur deux lignes.

       ℹ️ Le ruban du VPN reste : lui montre de vraies coupures, et il a gagné
       une échelle horaire le 28/08. La différence n'est pas le composant, c'est
       d'avoir quelque chose à montrer.

       ⚠️ La sonde part DU NAS. Elle atteste que Caddy sert le site, pas
       qu'un visiteur y arrive : une redirection de port cassée sur la
       Bbox resterait invisible ici. C'est une limite du poste
       d'observation, pas de la mesure.

       Composition reprise de la carte Kuma, éprouvée : un bloc qui grandit
       puis un bloc collé en bas. `.vizb` distribue son espace libre par
       `margin-top:auto`, deux blocs qui le réclament se le partageraient et
       creuseraient un trou au milieu. */
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
      x: "https://demandes.example.com", ic: "jellyseerr", w: 2,
      r: d => (d.seerr.pending > 0
            ? hero(d.seerr.pending, "demandes<br>en attente", "wn")
            : calme("<b>Aucune demande en attente</b>"))
            + past([[d.seerr.done + " complétées", d.seerr.pending > 0 ? "" : "ok"]]),
      warn: d => d.seerr.pending > 0 },
    { n: "FanKarr", d: "Catalogue FanKai", u: go(9898), x: "https://catalogue.example.com",
      ic: "fankarr.ico", mini: 1, w: 4 },
  ]},
];

GROUPS.push(
  { n: "Téléchargement", i: "down", s: [
    /* Refonte du 25/08/2026.

       La carte affichait « 51,6 % de requêtes abouties », soit le rapport
       captures / requêtes CUMULÉ depuis toujours. Il bougeait d'un centième
       de point par jour et convergeait lentement : rien à en faire. Et c'était
       une moyenne trompeuse — 52 % était la moyenne de 100 %, 37 % et 33 %,
       elle ne décrivait aucun des trois indexeurs. Même défaut que le temps de
       partage moyen de qBittorrent, retiré la veille pour la même raison.

       Surtout, la carte n'avait AUCUNE condition d'alerte, alors qu'elle
       surveille la brique dont tout dépend : si un tracker tombe, Radarr et
       Sonarr cessent silencieusement de trouver quoi que ce soit.

       ⚠️ `/health` est la source d'alerte, et Prowlarr la remplit lui-même
       quand un indexeur devient indisponible après trop d'échecs. Un indexeur
       désactivé À LA MAIN n'y figure pas : c'est un choix, pas une panne.

       La carte adopte l'idiome de ses voisines Radarr, Sonarr et Bazarr —
       `hero` ou `calme` — et les captures par indexeur remplacent le
       pourcentage : elles bougent tous les jours et disent quelle source
       alimente réellement la bibliothèque.

       ⚠️ Les échecs cumulés ne colorent rien. Altair en portait deux sur 81
       requêtes le 25/08 : un compteur qui ne redescend jamais allumerait une
       pastille ambre à vie. */
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
    /* Refonte complete du 24/08/2026, la seconde de la journee.

       La premiere version remplacait les deux anneaux par deux jauges. Une
       d elles comptait les torrents ayant tenu leur obligation de partage —
       mesure inutile ici, puisqu ils sont SUPPRIMES peu apres : la jauge
       decrivait une file d attente vers la corbeille.

       La carte repond desormais a quatre questions, et delegue le detail a
       sa fenetre.

       EST-CE QUE CA MARCHE. Le bandeau porte `connection_status`.
       ⚠️ `firewalled` est le cas vicieux : le client fonctionne, telecharge,
       n affiche aucune erreur, mais son port entrant est injoignable. Plus
       personne ne peut lui demander quoi que ce soit et le ratio cesse de
       monter sans que rien n ait l air casse. C est la SEULE condition
       d alerte de la carte.

       QU EST-CE QUI SE PASSE. Les deux debits en direct, rafraichis toutes
       les 5 s par `live.json`, et leur historique sur 24 h.
       ⚠️ Pas de `d0` sur ces series : zero est une valeur LEGITIME pour un
       debit, il signifie que rien ne transitait. L option masquerait de
       vraies mesures. Consequence assumee : pendant les 24 premieres heures
       la courbe trace une ligne plate a zero la ou la colonne n existait pas
       encore. Ca se resorbe seul et ne se represente jamais.

       OU EN EST LE RATIO, VRAIMENT. Trois jauges, une par tracker, et le
       chiffre vient du COMPTE chez le tracker, pas de qBittorrent.
       ⚠️ Le ratio du client est FAUX pour cet usage, pas imprecis. Le 28/08 il
       annoncait 0,24 pour Altair, 0,59 pour Vega et 0,00 pour Orion quand les
       comptes disaient l infini, 2,39 et 1,59. Deux causes : le freeleech n est
       pas compte par les trackers et l est par le client, et `alltime_dl` porte
       des mois de torrents depuis supprimes.
       ⚠️ Altair n a JAMAIS rien telecharge. Son ratio est indefini, pas enorme :
       la carte ecrit le symbole de l infini plutot qu un 999 ou un 0, qui
       mentiraient dans des directions opposees.
       ⚠️ La cible de 1,0 reste une convention personnelle, sans source. Seul
       Vega publie un seuil, 0,80, et c est le sien qui le juge.

       COMBIEN, ET QUELLE TAILLE. La derniere pastille. La repartition par
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

        /* Volume envoye sur la periode de l historique. Les valeurs sont des
           DEBITS moyens par creneau de 600 s : leur somme multipliee par la
           duree du creneau donne des octets.

           C est une estimation — un debit releve deux fois par minute ne voit
           pas les rafales qui passent entre deux mesures — mais elle a un
           avantage decisif sur le compteur de session de qBittorrent, qui
           occupait cette pastille avant : elle NE SE REMET PAS A ZERO au
           redemarrage du conteneur. Une fenetre de 24 h fixe se compare d un
           jour a l autre, une fenetre « depuis le demarrage » ne se compare a
           rien. Sous-estime le premier jour, comme tout ce qui lit
           l historique. */
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
        /* UNE SEULE BARRE. La premiere version en dessinait deux, « recu »
           au-dessus de « envoye ». Mais celle du haut servait de reference :
           elle etait donc pleine PAR CONSTRUCTION, cent pour cent en
           permanence, quoi qu il arrive — et elle repetait ce que la piste
           vide de celle du bas montrait deja.

           Ici la PISTE ENTIERE est le volume recu, le rempli est le volume
           envoye, et le vide entre les deux est exactement le deficit. Le
           ratio n est plus un pourcentage abstrait, c est une longueur.

           ⚠️ `pc()` borne a 100 mais n arrondit pas : sans le dixieme, la
           largeur part dans le DOM sous la forme « 45.48428578046771% ». Et
           le bornage sert vraiment le jour ou le ratio depasse 1,0 : la barre
           est alors pleine, ce qui est la bonne lecture. */
        /* LE RATIO EST CELUI DU TRACKER, releve chez lui par `ratios.sh` une
           fois par heure ; `collect.sh` ne fait que joindre le fichier.
           ⚠️ Trois cas, trois ecritures. Un nombre compare a son seuil ; le
           symbole de l INFINI quand le tracker n a jamais rien distribue, faute
           de denominateur ; un tiret quand le releve a echoue sans qu aucune
           valeur anterieure n existe. Aucun des trois ne doit devenir un zero,
           qui se lirait comme un compte en faute.
           ⚠️ L age n apparait qu au-dela de trois heures. En dessous c est du
           bruit ; au-dela c est l information principale, car un cookie de
           session expire sans prevenir et un chiffre mort ne doit pas passer
           pour frais. */
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
        /* NI JAUGE NI BARRE, ET C EST VOULU. Une barre a besoin d une
           reference ; les trois ratios depassent la leur, donc les trois
           barres restaient pleines en permanence et n apprenaient rien. La
           question posee est binaire — ce ratio est-il bon — et c est la
           COULEUR du nombre qui y repond.
           ⚠️ Le NOM passe devant, en taille lisible. Il etait relegue dans
           l etiquette de la jauge, en 0,55 rem grisee et en majuscules, ou il
           se noyait dans « MINIMUM 0,80 · RELEVE IL Y A 10 H 41 » — soit
           exactement l inverse de ce qu on cherche en premier.
           ⚠️ L age REMPLACE le qualificatif au lieu de s y ajouter : les deux
           cote a cote faisaient passer la ligne sur deux hauteurs, et un
           releve perime rend son seuil accessoire. */
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
            /* ⚠️ MEME AXE QUE LA COURBE, et ce n est pas un hasard : `aire`
               etale les 145 points sur toute la largeur, `echelle` place ses
               reperes en pourcentage de cette meme largeur, et les deux lisent
               la meme serie `hist.j`. Aucune conversion, donc aucun decalage
               possible.
               ⚠️ Pas de SIX heures ici, contre trois sur les rubans. La
               silhouette occupe une demi-carte, environ 256 px : a trois
               heures les huit reperes seraient espaces de 32 px pour des
               etiquettes de 24. Le pas suit la largeur disponible. */
            + echelle(Hn(d, "t"), 6)
          + `</div><div>`
            + (trs.length ? `<div class="trkh">Ratio chez les trackers</div>`
                          + `<div class="trks">` + trs.map(trk).join("") + `</div>`
                          : `<div class="note">Aucun tracker relevé</div>`)
          + `</div></div>`
          /* Quatre pastilles au plus, et chacune disparait quand elle n a
             rien a dire. Deux decrivent la silhouette qui les surplombe, son
             volume et son plafond ; la derniere combien de torrents les
             portent. La premiere est la DETTE DE PARTAGE : le nombre de
             torrents arretes avant d avoir rendu leurs trois jours. Le 20/08,
             quatre l ont ete par une extinction du conteneur, et personne ne l
             a signale pendant huit jours — ni Radarr ni Sonarr, dont les files
             etaient vides, ni cette carte, qui ne comptait que les torrents.
             ⚠️ `pic` est le plafond du TRACE, donc le maximum des deux series
             confondues. C est bien ce qu il annonce : le point le plus haut
             du dessin, sans quoi la silhouette n aurait aucune echelle.
             ⚠️ Le compte s efface a zero plutot que d afficher « 0 torrents » :
             un compte nul signifie que le releve a echoue, et le bandeau rouge
             le dit deja. */
          + past([q.dette > 0 ? [nb(q.dette) + (q.dette > 1
                        ? " torrents arrêtés avant leurs 3 jours"
                        : " torrent arrêté avant ses 3 jours"), "wn"] : null,
                  envoye > 0 ? [vol(envoye) + " envoyés sur 24 h", "ok"] : null,
                  pic > 0 ? ["pointe " + Mo(pic)] : null,
                  q.nb > 0 ? [nb(q.nb) + " torrents"] : null]);
      },
      warn: d => ((d.qbit || {}).etat || "") !== "connected" },
    /* La carte était VIDE : un en-tête, un voyant, rien d'autre. Elle occupait
       la largeur entière pour ne rien dire, alors que cross-seed tourne en
       permanence et qu'un arrêt silencieux passerait inaperçu.

       DEUX SOURCES, une seule nouvelle. Les torrents viennent de `sync/maindata`,
       déjà récupéré pour la carte qBittorrent : aucun appel de plus. La base
       SQLite de cross-seed est la seule lecture ajoutée, et elle est locale.

       ⚠️ « À PURGER CETTE NUIT » applique EXACTEMENT la règle de
       `purge-cross-seed.py` — torrent arrêté, dans `/data/cross-seed`, ayant
       rendu son temps à 300 s près. Deux règles qui divergeraient annonceraient
       une suppression qui n'arrive pas, ce qui serait pire que le silence.

       ⚠️ SECONDE CONDITION D'ALERTE, la vétusté de la recherche. La cadence est
       quotidienne ; le seuil de 48 h laisse passer une exécution manquée, pas
       deux. Sans elle, un cross-seed mort continuerait d'afficher ses
       31 correspondances comme si de rien n'était — le même piège que le
       compteur figé de la carte des mises à jour.

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
    /* Ruban de joignabilité du port entrant (24/08/2026).

       La carte ne disait que l'état de L'INSTANT : port ouvert, ou
       injoignable. Or le 24/08 le port clignotait — Proton le réattribuait
       264 fois en 24 heures, toujours sous le même numéro, avec un trou
       entre chaque. Selon la seconde où l'on regardait, la même journée
       paraissait parfaite ou cassée.

       Le watchdog voyait le problème depuis le début, mais il n'échantillonne
       que toutes les dix minutes, n'écrit qu'un journal texte, et chaque trou
       durant moins que son seuil de quinze minutes, il n'a jamais agi ni rien
       signalé. Le collecteur, lui, teste le port DEUX FOIS PAR MINUTE.

       ⚠️ 96 cases et non 48. La carte fait deux colonnes, elle a la place, et
       les trous durent cinq à dix minutes : au pas de la demi-heure ils se
       fondraient tous en ambre. Au quart d'heure on distingue une coupure
       franche d'un clignotement.

       Une case AMBRE est un créneau partiellement injoignable, une case ROUGE
       un créneau entièrement mort : `ruban` retient le pire des créneaux
       couverts, et un créneau ne vaut 2,00 que si toutes ses sondes ont
       échoué. Une case NEUTRE est un créneau sans mesure.

       ⚠️ `vpn.open` vient d'un vrai test TCP vers l'IP publique du tunnel, pas
       du contenu de `/tmp/gluetun/forwarded_port` — celui-ci annonçait un
       numéro le 22/08 pendant que Proton ne routait plus rien. */
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
    /* Refonte du 25/08/2026.

       LE NOMBRE ÉTAIT DÉJÀ DANS LA BARRE DU HAUT, qui affiche « 3 MAJ en
       attente » et reste collée en permanence, là où la carte est loin dans
       la page. Elle occupait donc 757 px pour redire un chiffre connu.

       Elle ne peut pas disparaître pour autant : c'est la PORTE de la fenêtre
       de sélection, et une porte doit appeler. Le grand nombre reste, mais la
       place libre porte enfin ce que la barre ne pourra jamais dire — QUELS
       conteneurs attendent. De quoi juger l'urgence sans rien ouvrir.

       ⚠️ Les bases de données sont marquées. La fenêtre les distingue déjà
       (`/postgres|db$|broker/`) parce qu'une mise à jour de moteur peut
       demander une migration ; cette distinction n'avait aucune raison
       d'attendre le clic.

       ⚠️ SECONDE CONDITION D'ALERTE : la vétusté du contrôle. `warn` ne
       portait que sur `total > 0`. Si `check-updates.sh` mourait, le compteur
       se figeait sur sa dernière valeur et la carte pouvait afficher « Tout
       est à jour » indéfiniment pendant que les mises à jour s'accumulaient —
       un surveillant qui s'arrête sans prévenir, exactement comme le watchdog
       du port VPN. Le contrôle est quotidien à 7 h : le seuil de 36 heures
       laisse passer une exécution manquée, pas deux.

       `age` vaut -1 quand `updates.json` est introuvable, ce qui se dit
       autrement qu'un contrôle simplement vieux. Et il vaut `undefined` tant
       que le collecteur n'a pas été mis à jour : les deux comparaisons sont
       alors fausses, la carte se comporte comme avant. */
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
    { n: "Sauvegarde", d: "Copie chiffrée vers le PC", ic: "sauvegarde", w: 2,
      r: d => jauge(d.backup.h < 0 ? "jamais" : "il y a " + d.backup.h + " h",
                    "seuil d'alerte à 48 h",
                    d.backup.h < 0 ? 100 : d.backup.h / 48 * 100,
                    (d.backup.h < 0 || d.backup.h > 48) ? "var(--scr)"
                      : d.backup.h > 24 ? "var(--swn)" : "var(--sok)"),
      /* ⚠️ La jauge sait dire « jamais » quand `h` est negatif ; la note doit
         le savoir aussi, sinon elle annonce « Derniere copie le jamais ».
         Defaut trouve le 02/09/2026 par le scenario « premier demarrage »,
         un etat qu on ne rencontre jamais en fonctionnement normal. */
      note: d => d.backup.h < 0 ? "Aucune sauvegarde enregistrée"
                                : "Dernière copie le " + d.backup.date,
      warn: d => d.backup.h > 48 || d.backup.h < 0 },
    /* Fusion de « Système » et « Mémoire et swap » (24/08/2026).

       Les deux cartes pesaient 758 px pour, l'essentiel, répéter la barre du
       haut : trois anneaux affichaient processeur, mémoire et température aux
       mêmes valeurs à la seconde près, et deux pastilles redonnaient le
       stockage et la RAM. Ce que la barre ne sait PAS montrer, c'est
       l'historique — c'est donc lui qui reste, avec les grandeurs dérivées
       qu'on ne trouve nulle part ailleurs.

       La légende porte la VALEUR INSTANTANÉE de chaque série : elle remplace
       les trois anneaux pour un vingtième de leur hauteur, et se lit d'un
       coup avec la courbe, là où l'anneau et la courbe se répétaient.

       ⚠️ PASTILLES CONDITIONNELLES pour le disque et la température. Ces deux
       grandeurs déclenchent l'alerte de la carte mais vivent dans la barre du
       haut : les afficher en permanence serait un doublon, ne jamais les
       afficher rendrait l'alerte inexplicable. Elles n'apparaissent donc qu'à
       l'approche du seuil. `past()` écarte les entrées nulles.
       Règle générale : toute condition de `warn` doit avoir de quoi
       s'expliquer sur la carte, au moins au moment où elle se déclenche.

       La température du SSD a été retirée : elle est dans « Disques NVMe »,
       où elle est replacée sur son échelle. */
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
    /* Temperatures des capteurs materiels (24/08/2026).

       UNE CARTE A PART parce que l unite differe : des degres ne peuvent pas
       rejoindre l axe en pourcentage de la carte Systeme. C est le critere le
       plus simple pour eviter que la page ne redevienne un fourre-tout.

       Elle ne fait PAS doublon avec « Disques NVMe ». Celle-la montre la
       valeur instantanee sur son echelle, celle-ci montre l historique et
       surtout la CORRELATION entre capteurs : voir le processeur monter avec
       la charge, ou un disque chauffer pendant un gros telechargement.

       ⚠️ `eth0` est le capteur le PLUS CHAUD du NAS, autour de 71 degres, et
       c est NORMAL PAR CONCEPTION : c est le controleur reseau 10 GbE, pas un
       processeur. Le 12/07 cette valeur avait ete prise pour une surchauffe.
       Elle est donc affichee — pour qu on cesse d en douter — mais EXCLUE de
       la condition d alerte, et une pastille le dit en toutes lettres.

       LES DISQUES SONT DECOUVERTS, pas enumeres : la carte lit les colonnes
       `nvme<N>` de l historique et n affiche que celles qui rapportent une
       valeur. Ajouter un SSD dans un des deux emplacements M.2 libres suffit
       a le voir apparaitre, ici comme dans « Disques NVMe » dont le collecteur
       boucle deja. Son libelle vient de SMART : une capacite parle davantage
       que « nvme2 ».

       Les series ajoutees en cours de route n ont pas d historique anterieur :
       `d0` les fait demarrer la ou leurs donnees commencent (cf. `graphe`). */
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
                    : "réseau : relevé en cours"]]);
      },
      warn: d => {
        const L = dern(d);
        const val = n => { const i = col(d, n); return i < 0 ? 0 : (L[i] || 0); };
        return d.nas.temp >= 85 || disquesHist(d).some(n => val(n) >= 70);
      } },
    { n: "Conteneurs", d: "Mémoire par service", ic: "docker", w: 2, pop: "conteneurs",
      r: d => { const rt = d.nas.ramt || 0;
        const c = ((d.cont && d.cont.c) || []).slice().sort((a, b) => reelC(b, rt) - reelC(a, rt));
        const go = (mo) => vg((mo / 1024).toFixed(1));
        const tot = c.reduce((a, x) => a + reelC(x, rt), 0);
        const sw = c.reduce((a, x) => a + (x.swap || 0), 0);
        const six = c.slice(0, 6).reduce((a, x) => a + reelC(x, rt), 0);
        /* La legende est indispensable : sans elle, un segment voile et un
           trait fin ne veulent rien dire. Dix-huit pixels bien depenses. */
        /* ⚠️ LE JOURNAL, PAS LE COMPTEUR. La premiere version croisait `rs` et
           `age` : elle ne tenait qu UNE HEURE, et une alerte d une heure sur une
           page qu on ne consulte pas toutes les heures n alerte personne — le
           reproche fait au watchdog du port VPN le meme jour.
           `containers.sh` enregistre desormais les AUGMENTATIONS du compteur,
           horodatees, et en conserve 24 h. C est la seule facon de dire
           « redemarre il y a 6 h » sans risque : `age` mesure le dernier
           demarrage QUELLE QU EN SOIT LA CAUSE, un redemarrage manuel aurait
           donc fait passer pour automatique un plantage vieux de trois semaines. */
        const ev = ((d.cont && d.cont.ev) || []).slice().sort((a, b) => (b.t || 0) - (a.t || 0));
        const maint = Math.floor(Date.now() / 1000);
        return bars(c.slice(0, 6), rt)
          + leg([["en mémoire", "#4d97ee"],
                 ["en swap", "rgba(77,151,238,.38)"],
                 ["moyenne 24 h", "#e8edf6"]])
          + (ev.length
            ? `<div class="evr"><span class="k">&#8635;</span><span>`
              + ev.slice(0, 3).map(x =>
                  `<b>${esc(x.n)}</b> il y a ${esc(duree(Math.max(0, maint - (x.t || 0)) / 60))}`)
                .join(" · ")
              + (ev.length > 3 ? ` · et ${ev.length - 3} autres` : "")
              + ` — redémarrage${ev.length > 1 ? "s" : ""} automatique${ev.length > 1 ? "s" : ""}`
              + ` sur 24 h</span></div>`
            : "")
          + `<div class="note">${c.length} conteneurs · <b>${go(tot)} Go réels</b>`
          + ` dont ${go(sw)} Go évacués · les 6 premiers : ${go(six)} Go</div>`; } },
      /* ⚠️ PAS DE `warn` ICI, et c est deliberé. Le voyant global dit ce qui va
         mal MAINTENANT ; ce bandeau raconte ce qui s est produit dans la
         journee. Le brancher sur le voyant teindrait la page en ambre pendant
         24 h pour un incident deja resolu, et userait le signal : a force de
         voir la page orange sans rien a faire, on cesse de la regarder. */
        { n: "Disques NVMe", d: "Santé et usure", ic: "ssd", w: 2,
      r: d => disques(d.smart),
      warn: d => ((d.smart && d.smart.d) || []).some(x => !x.ok || x.erreurs > 0 || x.usure >= 80) },
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

