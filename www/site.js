/* CONFIGURATION DE L INSTALLATION — la SEULE piece qui differe d une machine a
 * l autre. Chargee en premier, avant `cartes.js` et `app.js`, qui n en savent
 * rien et restent identiques partout.
 *
 * Pourquoi un fichier a part (08/10/2026) : `services.js` melait cette
 * configuration et le code des trente cartes. La copie du NAS devait donc etre
 * maintenue A LA MAIN, et chaque retouche d une carte se faisait deux fois. Une
 * fois les commentaires retires, les deux copies ne differaient plus que par
 * les valeurs ci-dessous : elles vivent ici, le code est dans `cartes.js` et se
 * deploie comme `app.js`.
 *
 * ⚠️ CE FICHIER N EST JAMAIS DEPLOYE. La copie du depot est ANONYMISEE ; celle
 * du NAS porte les vraies adresses. `outils/deploie.js` le refuse, et refuse de
 * deployer tant que le NAS n a pas le sien.
 */

/* Adresse du serveur sur le reseau local : les liens « local » des cartes. */
const IP = "nas.local";

/* Port local de chaque service, par nom de carte. Une carte sans port n a pas
   de lien local. */
const PORTS = {
  "Statistiques": 3002, "Jellyfin": 8096, "Seerr": 5055, "FanKarr": 9898,
  "Prowlarr": 9696, "Radarr": 7878, "Sonarr": 8989, "Bazarr": 6767, "qBittorrent": 8080,
  "Uptime Kuma": 3001, "ntfy": 8081, "AdGuard Home": 3000, "WireGuard": 51821, "Dockge": 5001,
};

/* Adresse publique de chaque service, par nom de carte. */
const LIENS = {
  "Site": "https://example.com",
  "Statistiques": "https://stats.example.com",
  "Jellyfin": "https://media.example.com",
  "Seerr": "https://demandes.example.com",
  "FanKarr": "https://catalogue.example.com",
  "VPN": "https://example.com/vpn",
  "ntfy": "https://notifs.example.com",
  "Vaultwarden": "https://coffre.example.com",
  "CRM": "https://crm.example.com",
};

/* Fournisseur du tunnel VPN du client torrent. */
const VPN = { nom: "le fournisseur VPN" };

/* Trackers de la carte qBittorrent. `seuils` : ratio minimum exige par le
   tracker (les autres visent 1). `ordre` : rang d affichage, du plus exigeant
   au plus souple. Ce n est pas l ordre alphabetique, qui melangeait tout. */
const TRACKERS = { seuils: { Vega: 0.8 }, ordre: ["Altair", "Vega", "Orion"] };

/* Ce que le lien reseau du serveur DOIT negocier. En dessous, la carte passe
   a l ambre : un lien retombe a 1 Gb/s ou des trames geantes perdues se
   voient sinon seulement au debit, quand on s en sert. */
const LIEN = { vit: 10000, mtu: 9000 };

/* Ecart minimal entre deux sauvegardes, tel que le script de sauvegarde
   l applique : sert a annoncer l heure de la prochaine copie. */
const SAUVEGARDE_ECART_H = 20;

/* Raccourcis proposes tant que l utilisateur n a pas enregistre les siens :
   ceux de la demonstration (outils/genere-fixtures.js). */
const DEF = [{ name: "YouTube", url: "https://www.youtube.com/" },
  { name: "Netflix",        url: "https://www.netflix.com/" },
  { name: "Spotify",        url: "https://open.spotify.com/" },
  { name: "Wikipédia",      url: "https://fr.wikipedia.org/" },
  { name: "LinkedIn",       url: "https://www.linkedin.com/" },
  { name: "GitHub",         url: "https://github.com/" },
  { name: "Docker Hub",     url: "https://hub.docker.com/" },
  { name: "Kubernetes",     url: "https://kubernetes.io/" },
  { name: "Ansible",        url: "https://docs.ansible.com/" },
  { name: "Proxmox",        url: "https://www.proxmox.com/" },
  { name: "Grafana",        url: "https://grafana.com/" },
  { name: "Cloudflare",     url: "https://www.cloudflare.com/" },
  { name: "Stack Overflow", url: "https://stackoverflow.com/" },
  { name: "React",          url: "https://react.dev/" },
  { name: "Node.js",        url: "https://nodejs.org/" },
  { name: "Deno",           url: "https://deno.com/" },
  { name: "Portfolio",      url: "https://alexiswallez.fr/" }];

/* Piles de conteneurs, reconnues au prefixe du nom, et leur couleur. */
const PILES = [
  { k: "arr-",       n: "Stack *arr", c: "#3987e5" },
  { k: "umami",      n: "Umami",      c: "#c98500" },
  { k: "portfolio-", n: "Portfolio",  c: "#d55181" }
];
const AUTRES = { n: "Infrastructure", c: "#d95926" };

/* Cartes qui portent une TACHE (vraie en continu) plutot qu un incident : leur
   point ambre ne change ni l etat general, ni le fond, ni les pastilles.
   ⚠️ Liste des NOMS DE CARTES : renommer une carte la fait sortir d ici. */
const TACHES = ["CRM", "Seerr", "Radarr", "Sonarr", "Bazarr", "Mises à jour"];
