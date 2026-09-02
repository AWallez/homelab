# Tableau de bord de homelab

Supervision d'une infrastructure auto-hébergée de vingt-six conteneurs, écrite à la main : pas de framework, pas de base de données, pas de processus permanent. Un serveur web statique, quelques scripts shell, et un fichier JSON.

**[▶ Démonstration en ligne](https://VOTRE-COMPTE.github.io/homelab/)** · les données y sont fictives, et un sélecteur permet de rejouer onze états du système, du fonctionnement nominal à la panne généralisée.

---

## Le problème

J'héberge chez moi une vingtaine de services : médiathèque, reverse proxy, DNS filtrant, gestionnaire de mots de passe, VPN d'accès distant, un site public et son analytique. Pour les surveiller, j'utilisais deux outils du marché. Ils consommaient **320 Mo de mémoire** sur une machine qui en compte 7,5 et qui commençait à évacuer vers le disque, ils affichaient des chiffres qui divergeaient des miens faute de définir les mesures de la même façon, et surtout **aucun des deux ne répondait aux questions que je me posais réellement**.

Je les ai remplacés par une page que j'ai écrite.

## Ce que ça fait

Un collecteur interroge dix-sept sources — API des services, `/proc`, `/sys`, `docker`, SMART — et écrit **un seul fichier JSON**. Une page statique le lit et se redessine. C'est tout.

- **Latence de 4 secondes** sur les valeurs vivantes, contre 80 au départ
- **Historique maison** sur 24 heures et 7 jours, avec alertes et notifications sur téléphone
- **Un veilleur** qui répare tout seul la panne la plus fréquente de l'installation
- **Sauvegardes chiffrées** dont la restauration a été testée

## Les décisions qui comptent

### Une page statique plutôt qu'une application

La page ne sert que des fichiers. Pas de processus permanent, donc rien qui puisse tomber en dehors du serveur web lui-même. Le vrai push par WebSocket a été écarté pour cette raison précise : il aurait rendu à la page la fragilité qu'on lui retirait.

Conséquence assumée : la fraîcheur dépend du cron, qui ne descend pas sous la minute. Le collecteur rapide boucle donc à l'intérieur de sa minute, **borné dans le temps et non en nombre de tours** — une boucle comptée en tours finissait par déborder la minute suivante et faisait sauter un passage entier.

### Un rendu par différences écrit à la main

La page se redessinait entièrement toutes les deux secondes, ce qui interdisait toute animation et faisait sauter le survol et le défilement. Un algorithme de comparaison de quarante lignes écrit le nouveau rendu **dans** l'arbre existant et ne touche que ce qui a changé.

Cette contrainte gouverne tout le reste : le panneau de survol et le sélecteur de démonstration vivent dans `<body>` parce qu'un élément placé dans une zone rendue serait détruit au rafraîchissement suivant.

### Une donnée manquante n'est pas une panne

La joignabilité d'un service vaut **1 ou 2, jamais 0**. Le zéro est réservé à l'absence de mesure. Sans cette convention, impossible de distinguer une panne d'une colonne qui n'existait pas encore, et les rubans d'état auraient été écarlates pendant leurs vingt-quatre premières heures.

C'est la même exigence qui fait que les rubans découpent le temps **à pas fixe** : une case valait auparavant dix ou vingt minutes selon sa position, ce qui vidait l'échelle horaire de son sens.

### Ce qu'on dessine n'est pas ce qu'on lit

Les courbes tracent une série moyennée à environ un point par pixel, mais l'infobulle lit la série complète à la minute. Tracer les 1440 points bruts donnait une bande pleine où plus rien ne se distinguait ; les moyenner pour tout le monde aurait fait perdre la précision de lecture. Les deux usages sont donc servis séparément.

### Un identifiant, pas un numéro

Une mise à jour du noyau a inversé l'énumération des deux disques SSD. Les colonnes de température ont changé de disque **sans que rien ne le signale**, et deux courbes se sont croisées en silence. Les collecteurs indexent désormais les disques sur leur **numéro de série**.

Leçon générale, au-delà des disques : un numéro attribué par le noyau est un ordre d'apparition, jamais une identité.

## Résultats mesurés

| | Avant | Après |
|---|---|---|
| Mémoire consommée par la supervision | 320 Mo | **0** (page statique) |
| Latence des valeurs vivantes | 80 s | **4 s** |
| Panne du port entrant du VPN | 90 min à la main | **24 s**, sans intervention |
| Écart entre la série tracée et la série lue | — | **0,003 point** |

## Architecture

```
collecteurs (cron)          page statique              serveur
────────────────────        ─────────────────          ───────
collect-fast.sh   2 s  ──>  live.json      ──┐
collect.sh       30 s  ──>  data.json      ──┤
history-build.sh  1 min ──> history.json   ──┼──>  index.html   ──>  nginx
containers.sh     5 min ──> containers.json ─┤     app.js
smart.sh          1 j  ──>  smart.json     ──┘     style.css + fond.css
```

Aucune écriture concurrente : **chaque script écrit son propre fichier**. Toutes les écritures sont atomiques, fichier temporaire puis renommage, ce qui garantit que le serveur ne sert jamais un JSON à moitié écrit.

## Faire tourner en local

Aucune dépendance à installer, aucun NAS nécessaire : les fixtures sont fournies.

```bash
docker compose up -d          # puis http://localhost:4173
```

Ou sans Docker :

```bash
node outils/serveur.js
```

Le sélecteur de scénario apparaît en bas à gauche. Chaque état est aussi accessible par son adresse, par exemple `?demo=tout-ko`.

Pour régénérer les données de démonstration :

```bash
node outils/genere-fixtures.js
```

Le tirage est déterministe : la même graine rend les mêmes courbes, avec un rythme jour/nuit et des incidents corrélés entre les sondes.

## Structure du dépôt

| Dossier | Contenu |
|---|---|
| `www/` | le front et les données servies. Autonome, publiable tel quel |
| `collecteurs/` | les scripts shell qui alimentent le tableau de bord |
| `fixtures/` | les sources écrites à la main : un état nominal et onze calques |
| `outils/` | générateur, serveur de développement, déploiement |

Les collecteurs attendent leur configuration dans des variables d'environnement, listées et commentées dans `.env.example`. Ils ne citent jamais un secret autrement que par le nom de sa variable, et n'en affichent aucun : c'est ce qui permet de les publier tels quels.

Le mode démonstration **s'active par la présence d'un fichier**. En production ce fichier n'existe pas : le sélecteur n'est jamais construit et le code correspondant devient une fonction identité. Rien à désactiver avant un déploiement, donc rien à oublier de désactiver.

## Un mot sur la documentation

Ce dépôt est accompagné d'un journal de conception d'une centaine de pages, tenu depuis le premier jour : chaque décision datée, chaque piège rencontré, chaque piste abandonnée et sa raison. Il contient autant d'échecs que de réussites, parce que la moitié de la valeur d'un tel document est de dire ce qu'il ne faut pas réessayer.
