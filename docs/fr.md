# SleepIQ pour Gladys

Affiche vos lits **Sleep Number** (États-Unis) dans Gladys, par le cloud
SleepIQ, avec le compte de l'application SleepIQ.

> **API non officielle, jamais testée avec un vrai compte ni un vrai lit.**
> L'intégration parle à l'API de l'application SleepIQ, comme la
> bibliothèque asyncsleepiq et l'intégration Home Assistant. Sleep Number
> peut la changer sans prévenir. Sans lien avec Sleep Number.

## Ce que vous obtenez

Pour chaque lit, **un appareil pour le lit** et **un appareil par côté** où
quelqu'un dort (un côté sans dormeur dans l'application n'a pas d'appareil).

Sur l'appareil du lit :

| Fonctionnalité              | Contenu                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| Quelqu'un au lit            | Oui quand au moins un côté est occupé                            |
| Position de la tête / pieds | 0 à 100, pour une base unique (partagée par les deux côtés)      |
| Position de la base         | La position enregistrée en cours (À plat, Lecture…), base unique |
| Mettre la base en position  | Choix des positions (commande, voir plus bas), base unique       |
| Arrêter la base             | Bouton (commande), base unique                                   |
| Veilleuse                   | La lumière sous le lit des lits récents (« fuzion ») (commande)  |

Sur chaque appareil de côté :

| Fonctionnalité              | Contenu                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| Au lit                      | Oui / non, lu toutes les minutes                                          |
| Fermeté (Sleep Number)      | 5 à 100                                                                   |
| Régler la fermeté           | Choix de 5 à 100 par pas de 5 (commande)                                  |
| Pression (brute)            | La valeur de pression brute de SleepIQ, sans unité                        |
| Score de sommeil de la nuit | Le score SleepIQ (0 à 100) de la session principale, lu toutes les heures |
| Position de la tête / pieds | 0 à 100, pour une base séparée                                            |
| Position de la base         | La position enregistrée en cours, base séparée                            |
| Mettre la base en position  | Choix des positions (commande)                                            |
| Arrêter la base             | Bouton (commande)                                                         |
| Veilleuse                   | La veilleuse de ce côté (commande)                                        |
| Chauffe-pieds               | Arrêt, faible, moyen, fort (lecture seule)                                |
| Chauffage / refroidissement | Arrêt, chauffage ou refroidissement faible/moyen/fort (lecture seule)     |

Les fonctionnalités de base, de veilleuse, de chauffe-pieds et de
climatisation n'apparaissent que si le lit en a. La présence et la fermeté
sont lues **toutes les minutes** (sur un lit « fuzion », la fermeté affichée
n'est relue que toutes les 5 minutes) ; la base, les veilleuses, le chauffe-pieds
et la climatisation toutes les 5 minutes ; le score de sommeil toutes les
heures ; les lits et leurs éléments toutes les 6 heures.

« Au lit » utilise la catégorie Gladys « détecteur de mouvement » (comme
Gladys le fait pour les capteurs Zigbee de présence et d'occupation) : le
tableau de bord peut parler de « mouvement ».

## Déclencheurs de scène

Dans l'éditeur de scènes (Gladys 5.1 ou plus récent), catégorie
**Intégrations** :

- **Entrée au lit** et **Sortie du lit**. Filtre sur le lit et/ou le côté
  (vide : n'importe lequel). Les actions peuvent lire
  `{{triggerEvent.data.side}}` (`left` ou `right`), `side_name`, `bed_name`,
  `sleeper_name` et `at` (l'heure où le changement a été vu, en UTC).

Ils se déclenchent dans la minute qui suit le changement, **jamais à la
première lecture** après un démarrage (c'est l'état trouvé, pas un
changement), et jamais après une coupure ou une pause de plus de 5 minutes
(le changement a eu lieu à une heure inconnue). Un déclencheur que Gladys ne
peut pas recevoir dans les 5 minutes (Gladys qui redémarre) est abandonné,
jamais livré en retard. La fonctionnalité « Au lit » peut aussi lancer une
scène, comme n'importe quel appareil.

## Mise en place

1. Installez l'intégration depuis le store de Gladys.
2. Dans sa configuration, saisissez l'**e-mail** et le **mot de passe** de
   l'application SleepIQ. Le mot de passe est gardé par Gladys dans sa
   base, jamais réaffiché, envoyé seulement à la connexion SleepIQ.
3. Vérifiez le **fuseau horaire du lit** (America/Chicago par défaut) : il
   sert à demander à SleepIQ le score de la bonne nuit.
4. Enregistrez, puis ajoutez le lit et ses côtés depuis l'onglet
   **Découverte**.

Le bouton **Tester la connexion** lit les lits une fois (au plus toutes les
30 secondes) et dit qui est au lit.

## Commandes (désactivées par défaut)

La fermeté, les positions de la base, le bouton d'arrêt et la veilleuse
refusent toute commande tant que **Autoriser les commandes** est désactivé.
Activé :

- **Régler la fermeté** : de 5 à 100, par pas de 5 seulement (toute autre
  valeur est refusée) ;
- **Mettre la base en position** : une des positions que le lit propose (À
  plat, Favorite, Lecture, Télévision, Zéro gravité, Anti-ronflement). Pas de
  commande de position libre de la tête ou des pieds : seulement des
  positions enregistrées. **Une position fait bouger le lit avec la personne
  couchée dessus**, y compris quand une scène l'envoie la nuit : n'autorisez
  les commandes qu'en connaissance de cause, et gardez ces scènes pour
  quand vous êtes éveillé ;
- **Arrêter la base** : arrête une base en mouvement. L'arrêt passe
  toujours : il n'attend jamais une autre commande, ni une pause après un
  429 ;
- **Veilleuse** : allumée ou éteinte.

La fermeté et les positions sont des choix, l'arrêt est un bouton : un
« éteins tout » ne les atteint jamais. La veilleuse est une lumière Gladys :
« éteindre les lumières » d'une pièce l'éteint donc (si les commandes sont
autorisées).

Avant chaque commande, l'intégration relit l'état (la fermeté, la position,
la veilleuse) et décide d'après lui, jamais d'après une valeur en mémoire :
une commande inutile n'est pas envoyée ; un changement de fermeté pendant
que le lit règle déjà sa fermeté est refusé ; un état illisible refuse la
commande. L'arrêt est envoyé sans lecture (il est toujours sûr). Une
commande qui ne peut pas partir dans les 3,5 secondes est refusée sans être
envoyée. Gladys reçoit une réponse en 4,3 secondes au plus ; l'état réel
s'affiche environ 10 secondes plus tard. Une commande à la fois : deux
commandes envoyées ensemble (deux veilleuses éteintes par une scène) passent
l'une après l'autre, et celle qui ne peut plus partir à temps est refusée
sans être envoyée. Une commande ne se connecte jamais à SleepIQ : tant que
l'intégration n'est pas connectée, elle est refusée (« pas connecté »).

Le chauffe-pieds et le chauffage/refroidissement sont en lecture seule :
l'intégration ne chauffe ni ne refroidit jamais.

## Erreurs et limites

- **E-mail ou mot de passe refusé** : l'intégration s'arrête et le dit ; un
  nouvel essai après 6 h, puis toutes les 24 h (pour ne pas bloquer le
  compte). Enregistrer de nouveaux identifiants ou le bouton de test
  réessaient tout de suite.
- **Session refusée** : l'intégration se reconnecte une fois (jamais à chaque
  cycle : la clé de session est gardée et réutilisée) ; refusée de nouveau
  juste après, une pause puis un essai après 1 h, 6 h, puis toutes les 24 h.
- **Connexion rejetée** (HTTP 403 « User Agent is blocked », ou autre
  erreur) : l'API a sans doute changé ; un nouvel essai après 6 h, puis
  toutes les 24 h.
- **429 (trop de requêtes)** : une pause de 1 minute à 6 heures (15 minutes
  sans indication), pour tout (lectures, bouton, commandes), gardée après un
  redémarrage et une reconnexion à Gladys. **403** de la lecture principale :
  une heure.
- **Réseau, 5xx** : nouvel essai après 2, 5, 10, 15, puis 30 minutes, jamais
  plus vite que toutes les minutes. Une lecture secondaire en échec (base,
  score) ne cache jamais la présence et n'est pas relue avant son propre
  intervalle.
- Arrêts et pauses sont gardés dans `/data`, 24 h au plus. `/data` garde
  aussi la clé de session SleepIQ, en clair, dans un fichier réservé à
  l'utilisateur du conteneur (0600), donc lisible aussi par l'administrateur
  de la machine et dans les sauvegardes du volume ; jamais l'e-mail ni le
  mot de passe.
- Les prises de chevet des bases classiques (prises 1 et 2) ne sont pas
  affichées : elles peuvent alimenter n'importe quoi.
- Le massage, le mode pause (confidentialité), la fermeté favorite et la
  calibration ne sont pas pris en charge.
- Les logs ne contiennent jamais l'e-mail, le mot de passe, la clé de
  session, ni le texte des réponses d'erreur de SleepIQ.

## Crédits

Porté depuis [asyncsleepiq](https://github.com/kbickar/asyncsleepiq) (Keilin
Bickar, MIT) et
l'[intégration SleepIQ de Home Assistant](https://github.com/home-assistant/core/tree/dev/homeassistant/components/sleepiq)
(Apache-2.0). Licence Apache-2.0.
