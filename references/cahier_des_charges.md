# Cahier des charges — Application de gestion de tournois de pétanque

> Documents produit versionnés : `docs/roadmap.md` (source de vérité de
> la trajectoire produit) · `docs/spec_match_individuel.md` et
> `docs/conception_matchs_libres.md` (le match libre, Horizon 2) ·
> `docs/spec_amitie_confidentialite.md` et
> `docs/conception_amitie_confidentialite.md` (l'amitié et la
> confidentialité du profil).

## 1. Contexte

Ce projet a pour objectif de remplacer la gestion papier des parties
et des tournois de pétanque par une application web simple, rapide et
lisible.

Pétankup est une application de **gestion de parties et de tournois de
pétanque**, destinée au **grand public** (France d'abord,
international ensuite). Elle vise deux usages : les **joueurs** qui
organisent des tournois ou notent leurs parties entre amis, et — à
terme — les **clubs et associations** *(prévu, Horizon 4)* qui
organisent des tournois régulièrement. Elle permet de gérer un tournoi
de bout en bout et de conserver un historique consultable pour chaque
joueur ayant un compte.

Cette ambition guide les choix de qualité de code et d'architecture ;
sa mise en œuvre est ordonnée par horizons dans `docs/roadmap.md`.

## 2. Objectif du projet

Créer une application web légère permettant d'organiser et de suivre
un tournoi de pétanque de manière claire et centralisée, et de
conserver l'historique des participations de chaque joueur.

L'application doit permettre :

- de créer un tournoi en quelques secondes,
- d'ajouter des équipes composées de joueurs (avec ou sans compte),
- de saisir les résultats des matchs,
- d'obtenir un classement automatique,
- de désigner les vainqueurs,
- de conserver l'historique des tournois,
- de consulter le profil et les statistiques d'un joueur participant.

## 3. Vision produit

Pétankup s'adresse au grand public : les joueurs d'abord (organiser
des tournois, noter des parties entre amis), les clubs et associations
à terme *(prévu, Horizon 4)*.

L'application doit être :

- simple,
- rapide à utiliser,
- responsive et **mobile-first** (utilisation principale au bord du
  terrain depuis un téléphone),
- compréhensible immédiatement,
- exploitable depuis mobile pendant un tournoi réel.

Le principe fondateur est de réduire au maximum les frictions : rester
**simple et sans friction**, à l'opposé d'un outil de gestion
fédérale. L'utilisateur doit pouvoir gérer le tournoi sans devoir
réfléchir à l'outil.

Chaque joueur ayant un compte garde une trace persistante de ses
tournois et de ses statistiques — sans que cela alourdisse
l'expérience de l'organisateur.

Au-delà du tournoi, la vision inclut le **match libre** *(livré —
Horizon 2, voir `docs/spec_match_individuel.md` et
`docs/conception_matchs_libres.md`)* : une partie jouée hors tournoi,
enregistrée par un participant à compte, avec des joueurs à compte
et/ou libres, dans tous les formats (tête-à-tête, doublette,
triplette). Les statistiques du profil distinguent « en tournoi » et
« en match libre », avec un total combinable.

## 4. Périmètre fonctionnel

### 4.1 Fonctionnalités incluses

#### Authentification et comptes

- Connexion par lien magique email ou Google.
- Création automatique d'un profil au premier login, avec un pseudo
  modifiable.
- Pseudo unique (insensible à la casse et aux espaces de bord).
- Édition du pseudo depuis l'écran « Mon compte ».
- Déconnexion.

#### Création d'un tournoi

- Nom, date, lieu (optionnel), description (optionnelle).
- Visibilité : privé (par défaut) ou public.
- Format : championnat (round-robin).

#### Visibilité et partage

- Un tournoi **privé** n'est visible que par son organisateur et les
  joueurs qu'il invite.
- Un tournoi **public** est visible par tous les utilisateurs
  connectés.
- L'organisateur peut basculer la visibilité à tout moment, y compris
  sur un tournoi terminé (partager les résultats d'un tournoi fini est
  légitime — c'est l'une des deux exceptions au gel, voir §8).
- L'organisateur peut **inviter des joueurs par pseudo**. Les invités
  voient le tournoi dans leur section « Partagés avec moi ».

#### Gestion des équipes

- Ajout d'équipes (1 à 3 joueurs par équipe ; doublette par défaut).
- Chaque joueur d'une équipe est soit :
  - un **joueur lié à un compte** (son pseudo s'affiche et renvoie vers
    son profil),
  - un **joueur libre** (nom saisi à la main, pas de profil). Cette
    possibilité est **durable** : elle reste utile pour les joueurs
    occasionnels qui ne souhaitent pas créer de compte.
- Un joueur lié à un compte ne peut pas être dans deux équipes du
  même tournoi.
- Modification et suppression d'une équipe possibles tant que le
  tournoi n'est pas démarré.

#### Gestion des matchs

- Génération automatique des matchs au démarrage du tournoi.
- Saisie des scores match par match.
- Validation d'un résultat (règles de pétanque, voir §8).
- Identification automatique du vainqueur.

#### Classement

- Calcul automatique du classement à chaque score saisi.
- Affichage du nombre de victoires, de défaites, des points marqués,
  des points encaissés, de la différence de points et du rang.

#### Résultats finaux

- Page de résultats avec **podium** (vainqueur, deuxième, troisième
  si applicable).
- Récapitulatif du tournoi (date, lieu, nombre d'équipes).
- Tableau du classement final.

#### Match libre

- Une partie jouée hors tournoi, enregistrée en une fois par un
  participant à compte : deux camps de même effectif (1 à 3 joueurs,
  avec ou sans compte), le score, la date de jeu (jamais future) et la
  visibilité.
- Le match naît terminé et reste immuable : une erreur se corrige en
  supprimant le match (par son créateur seul) et en le ressaisissant.
- Un match privé n'est visible que de ses participants à compte ; un
  match public, de tout utilisateur connecté.
- Les statistiques de match libre sont matérialisées à
  l'enregistrement, séparément de celles des tournois, et combinées à
  l'affichage.

#### Historique et profil joueur

- **Page d'accueil** segmentée en trois sections : « Tous les
  tournois » (les tournois de l'utilisateur), « Partagés avec moi »,
  « Tournois publics ».
- **Profil joueur** dont la page est ouverte à tout utilisateur
  connecté ; son contenu s'affiche selon le réglage de confidentialité
  du propriétaire et l'amitié (voir §8) — sinon le pseudo seul. Il
  affiche :
  - le pseudo,
  - les statistiques agrégées, en tournoi et en match libre, avec le
    total combiné (tournois joués / gagnés / podiums ; matchs joués /
    victoires / défaites ; points marqués / encaissés / différentiel),
  - le **journal de bord** unifié : tournois terminés et matchs libres
    dans l'ordre chronologique, avec un filtre par type. Pour un
    tournoi : son équipe, ses coéquipiers, son rang final et le résumé
    du score ; pour un match libre : le score et les joueurs. Une
    entrée n'est un lien que si le visiteur peut ouvrir le tournoi ou
    le match.

  La date de son dernier tournoi est conservée avec ses statistiques
  mais n'est pas affichée.
- Points d'entrée vers un profil : les avatars de la modale « Gérer
  les invités », les joueurs liés à un compte sur les cartes d'équipe
  d'un tournoi, les listes et le résultat de recherche de l'écran
  « Amis ».

#### Amis et confidentialité du profil

- Relation d'amitié mutuelle : demandée par l'un (par pseudo exact
  depuis l'écran « Amis », ou depuis le profil de la personne),
  acceptée par l'autre. Refuser, annuler sa propre demande et retirer
  un ami sont possibles à tout moment, sans trace ni notification.
- Écran « Amis » : la liste des amis, les demandes reçues, les
  demandes envoyées, et le champ de recherche par pseudo exact.
  Accessible depuis « Mon compte », dont l'entrée affiche le nombre de
  demandes reçues en attente.
- Réglage de confidentialité du profil depuis « Mon compte » : public
  (par défaut) ou privé, avec une explication de ce que chaque valeur
  change ; et un aperçu du profil tel qu'un non-ami le voit.
- Sur un profil privé, un non-ami voit le pseudo et l'avatar, une
  explication à la place des statistiques et du journal, et peut
  demander la personne en ami.

### 4.2 Hors scope V1

Ne font pas partie de la première version :

- chat, notifications push,
- export PDF, partage social,
- multi-format de tournoi (élimination directe, poules + finales),
- blocage d'un utilisateur (reporté à l'Horizon 3).

Une évolution communautaire plus large (statistiques de confrontation,
duos préférés, gamification) viendra plus tard, après le MVP.

## 5. Hypothèses de départ

- L'application est aujourd'hui utilisée par des cercles restreints de
  joueurs réguliers ; la cible est le grand public, avec une ouverture
  progressive *(Horizon 3)*.
- Les tournois peuvent être strictement privés (entre invités) ou
  rendus publics par leur organisateur.
- Le besoin principal est la saisie rapide et le calcul automatique
  pendant le tournoi.
- La priorité absolue est la lisibilité sur téléphone.
- Un profil est **public par défaut** ; son propriétaire peut le passer
  en **privé** depuis « Mon compte ». La page d'un profil est ouverte à
  tout utilisateur connecté ; c'est son contenu (statistiques, journal)
  qui est protégé, en base.

## 6. Utilisateurs cibles

### Organisateur

Personne qui crée le tournoi, configure sa visibilité, invite des
joueurs, ajoute les équipes, génère les matchs et saisit les scores.
Un tournoi a exactement un organisateur (techniquement, l'`owner` du
tournoi en base).

### Membre invité

Personne ajoutée par pseudo à un tournoi privé par son organisateur.
Voit le tournoi en lecture dans sa section « Partagés avec moi », et
peut être inscrite dans une équipe par l'organisateur.

### Utilisateur connecté

Tout utilisateur authentifié peut consulter en lecture les tournois
publics, les matchs libres publics, et la page de profil des autres
joueurs — dont le contenu dépend de leur réglage de confidentialité et
de l'amitié (§8).

### Ami

Utilisateur connecté lié à un autre par une relation d'amitié
mutuelle : demandée par l'un, acceptée par l'autre. Voit le contenu
complet du profil de son ami, même privé.

### Joueur libre

Personne sans compte, dont le nom est saisi à la main par
l'organisateur dans une équipe. N'apparaît dans aucune section de la
page d'accueil, n'a pas de profil, et reste mentionnée en snapshot
dans l'historique des tournois auxquels elle a participé.

### Club / association *(prévu, Horizon 4 — non implémenté)*

Entité qui organise des tournois récurrents, avec plusieurs
organisateurs et des membres. N'existe pas aujourd'hui : un tournoi
appartient à un utilisateur unique.

## 7. Parcours utilisateur

### Première connexion

1. L'utilisateur arrive sur la page de connexion.
2. Il choisit Google ou saisit son email pour recevoir un lien
   magique.
3. Un profil est créé automatiquement avec un pseudo qu'il peut
   modifier depuis « Mon compte ».

### Créer un tournoi

1. L'organisateur clique sur « Créer un tournoi » depuis la page
   d'accueil.
2. Il renseigne nom, date, lieu (optionnel), visibilité, format.
3. Le tournoi apparaît en brouillon dans « Tous les tournois ».

### Ajouter des équipes

1. Sur la page du tournoi, l'organisateur ouvre « Ajouter une
   équipe ».
2. Pour chaque joueur, il choisit soit un membre invité (ou
   lui-même), soit saisit un nom libre.
3. Les équipes sont enregistrées avec leurs joueurs.

### Inviter des joueurs (tournoi privé)

1. L'organisateur ouvre « Gérer les invités ».
2. Il saisit le pseudo d'un joueur. L'invitation est confirmée si le
   pseudo existe.
3. L'invité voit aussitôt le tournoi dans « Partagés avec moi ».

### Démarrer le tournoi et saisir les scores

1. Une fois les équipes prêtes, l'organisateur lance le tournoi.
2. Les matchs sont générés automatiquement.
3. Pour chaque match, l'organisateur saisit le score. Le classement
   se met à jour à chaque saisie.

### Terminer le tournoi

1. Quand tous les matchs sont joués, l'organisateur déclenche la
   complétion manuelle.
2. Le tournoi devient terminé. Les statistiques de chaque joueur
   participant sont mises à jour, et le tournoi apparaît dans le
   journal de bord de chacun.
3. Le tournoi est gelé : ni les équipes, ni les scores ne peuvent
   plus être modifiés tant qu'il reste terminé. En cas d'erreur de
   saisie, l'organisateur peut le rouvrir puis le re-terminer
   (voir §8 — capacité en base uniquement, sans bouton d'interface à
   ce jour).

### Consulter un profil

1. L'utilisateur tape sur un joueur : un avatar de la modale « Gérer
   les invités », un joueur lié à un compte sur une carte d'équipe, ou
   une entrée de l'écran « Amis » (ami, demande, résultat de
   recherche).
2. Il atterrit sur le profil et voit le pseudo, puis — si le profil
   est public, s'il en est l'ami ou le propriétaire — les statistiques
   et le journal de bord. Sinon une explication remplace le contenu,
   et il peut demander la personne en ami.

## 8. Règles métier

### Validation des scores (pétanque)

- Les deux scores sont des entiers ≥ 0.
- Le vainqueur marque **exactement 13** ; le perdant entre 0 et 12
  (règle stricte, appliquée aux matchs de tournoi comme aux matchs
  libres, en base comme dans le composant de saisie).
- Les deux scores doivent être différents (pas de match nul à la
  pétanque).
- Le vainqueur est déduit du score le plus élevé.

### Classement (ordre de tri pour le départage)

1. Nombre de victoires (décroissant).
2. Différence de points (décroissant).
3. Points marqués (décroissant).
4. Résultat direct entre les équipes concernées, si applicable.

**Limite connue (assumée)** : une divergence existe entre le calcul
TypeScript (affichage live du classement) et le calcul SQL
(statistiques matérialisées), uniquement en cas de **cycle parfait
entre 3 équipes ou plus** scalairement à égalité (A bat B, B bat C,
C bat A). Le classement TypeScript n'est lui-même pas un ordre total
dans ce cas ; le SQL départage alors par identifiant d'équipe. Dette
documentée dans le code, avec des fixtures de vérification partagées
entre les deux implémentations.

### Cycle de vie d'un tournoi

- Un tournoi commence en `brouillon`.
- Il passe en `en cours` quand l'organisateur lance la génération des
  matchs (au moins 2 équipes requises).
- Il passe en `terminé` quand l'organisateur déclenche la complétion
  manuelle, à condition que tous les matchs soient terminés.
- **Un tournoi terminé est gelé en base** : scores, équipes, joueurs,
  et toutes les métadonnées du tournoi (nom, date, lieu, description,
  format) sont immuables. Garanti côté base de données, pas seulement
  côté interface.
- **Deux exceptions permises** : le changement de **visibilité**
  (partager les résultats d'un tournoi fini est légitime) et la
  **suppression** du tournoi par son organisateur (la cohérence des
  statistiques est garantie automatiquement).
- **La complétion n'est pas définitive** : l'organisateur peut
  **rouvrir** un tournoi terminé (retour en `en cours`) pour corriger
  une erreur de saisie, puis le re-terminer. À la réouverture, les
  statistiques matérialisées du tournoi sont retirées ; elles sont
  recalculées à la re-complétion. La réouverture n'est possible que
  vers `en cours` (jamais vers `brouillon`).
- **État de l'interface** : cette capacité de réouverture existe **en
  base uniquement** ; aucun bouton de réouverture n'est exposé dans
  l'application à ce jour (choix assumé, à ajouter si le besoin se
  présente).

### Pseudo

- Unique entre utilisateurs (insensible à la casse et aux espaces de
  bord).
- 1 à 50 caractères, après trim.
- Modifiable à tout moment.

### Confidentialité du profil et amitié

- La page d'un profil est ouverte à tout utilisateur connecté. Son
  **contenu** (statistiques, journal) est visible si le profil est
  public, si le visiteur est un ami, ou s'il est le propriétaire ;
  sinon le pseudo seul. Le filtrage est appliqué en base, jamais côté
  interface.
- Le réglage (public par défaut, privé) se modifie depuis « Mon
  compte », avec une explication de ce qu'il change ; le propriétaire
  peut voir son profil tel qu'un non-ami le voit (aperçu extérieur).
- L'amitié est une relation mutuelle : demandée par l'un, acceptée par
  l'autre. Cinq actions : demander (par pseudo exact, ou depuis un
  profil), accepter, refuser, annuler sa demande, retirer. Le refus,
  l'annulation et le retrait effacent la relation sans trace ; deux
  demandes croisées valent acceptation.
- Le nombre d'amis n'est affiché nulle part.

### Intégrité des données

- Une équipe ne peut pas être dupliquée dans un même tournoi (nom).
- Un même joueur lié à un compte ne peut pas occuper plusieurs slots
  d'une équipe, ni plusieurs équipes d'un même tournoi.
- Un match ne peut opposer une équipe à elle-même.
- Une paire d'équipes ne peut jouer qu'une fois par tournoi.
- Les modifications de scores recalculent automatiquement le
  classement.

## 9. Fonctionnalités détaillées

### Écrans

- **Connexion** : Google ou magic link.
- **Mon compte** : édition du pseudo, réglage de confidentialité du
  profil (public / privé, confirmé par une modale qui explique le
  changement) et aperçu extérieur, entrée « Amis » avec le nombre de
  demandes reçues en attente, déconnexion, accès à son profil.
- **Amis** : liste des amis, demandes reçues, demandes envoyées, champ
  de recherche par pseudo exact.
- **Page d'accueil** : trois sections de tournois (Tous les tournois,
  Partagés avec moi, Tournois publics) + bouton de création.
- **Création de tournoi** : formulaire.
- **Détail d'un tournoi** : onglets Équipes / Matchs / Classement,
  modales de gestion (invités, visibilité, complétion, suppression).
- **Résultats d'un tournoi terminé** : podium, récap, classement
  final.
- **Création d'un match libre** : formulaire (joueurs par camp, score,
  date de jeu, visibilité).
- **Détail d'un match libre** : camps, score, date ; suppression par le
  créateur.
- **Profil joueur** : avatar, pseudo, statistiques agrégées, journal
  de bord ; sur le profil d'un autre joueur, le statut d'amitié et
  l'action correspondante ; sur un profil privé vu par un non-ami, une
  explication remplace le contenu.

## 10. Structure des données

> Vue produit. Les types techniques exacts sont définis dans le code.

### Profil

- Identifiant.
- Pseudo (unique, modifiable).
- Visibilité : `public` (défaut), `privé`.
- Dates de création et de mise à jour.

### Tournoi

- Identifiant, organisateur (owner).
- Nom, date, lieu (optionnel), description (optionnelle).
- Format (round-robin).
- Statut : `brouillon`, `en cours`, `terminé`.
- Visibilité : `privé`, `public`.
- Date de complétion (renseignée à la transition vers `terminé`).

### Membre d'un tournoi (invité)

- Lien entre un tournoi et un utilisateur invité.
- Snapshot de l'email au moment de l'invitation.

### Équipe

- Identifiant, tournoi associé, nom.
- Liste de joueurs (1 à 3).

### Joueur d'équipe

- Identifiant.
- Équipe et tournoi associés.
- Soit un identifiant utilisateur (joueur lié à un compte), soit
  `null` (joueur libre).
- Snapshot du pseudo / nom au moment de l'écriture (utile pour les
  joueurs libres, et pour la résilience en cas de changement de
  pseudo a posteriori).

### Match

- Identifiant, tournoi associé.
- Équipe A, équipe B.
- Scores et vainqueur (renseignés au passage à `terminé`).
- Statut du match : `pending`, `completed`.
- Numéro de manche (round).

### Statistiques de joueur (par tournoi terminé)

- Joueur, tournoi, équipe.
- Victoires, défaites, points marqués, points encaissés.
- Rang final, drapeaux « vainqueur » et « podium ».

### Statistiques agrégées (global par joueur)

- Matchs joués / victoires / défaites.
- Points marqués / encaissés.
- Tournois joués / gagnés / podiums.
- Date du dernier tournoi.

### Match libre

- Identifiant, créateur (un participant à compte).
- Date de jeu (jamais future), score par camp ; vainqueur déduit du
  score.
- Visibilité : `privé`, `public`.
- Immuable après création : la seule écriture est la suppression, par
  le créateur ; supprimé automatiquement quand son dernier participant
  à compte disparaît.

### Participant d'un match libre

- Identifiant, match associé, camp (A ou B).
- Soit un identifiant utilisateur (joueur lié à un compte), soit
  `null` (joueur libre) ; snapshot du pseudo / nom au moment de
  l'écriture.
- Deux camps de même effectif, 1 à 3 participants chacun ; un même
  compte n'apparaît qu'une fois par match.

### Statistiques de match libre (global par joueur)

- Matchs joués / victoires / défaites, points marqués / encaissés.
- Source distincte des statistiques de tournoi ; le total combiné est
  calculé à l'affichage, jamais stocké.

### Relation d'amitié

- Une ligne par duo, les deux identifiants rangés dans un ordre
  déterministe ; le demandeur porté à part.
- Statut : `en attente`, `acceptée`. Le refus, l'annulation et le
  retrait suppriment la ligne.
- Deux demandes croisées valent acceptation ; auto-amitié impossible ;
  la suppression d'un compte efface ses relations.

## 11. Organisation technique

### Stack

- **Nuxt 4** en mode SPA, **Vue 3** + TypeScript.
- **Nuxt UI** comme bibliothèque de composants (basée sur Tailwind).
- **Pinia** pour le state, **Zod** pour la validation.
- **Supabase** (Postgres + auth) pour la persistance et
  l'authentification.
- **Vitest** pour les tests unitaires.
- **Vercel** pour le déploiement.

### Pourquoi ce choix

- Vue 3 et Nuxt offrent une base mature avec un écosystème riche et
  un mode SPA suffisant pour le besoin.
- Nuxt UI fournit un système de composants accessibles et cohérents
  sans avoir à recoder à la main.
- Supabase couvre l'authentification, la base et les règles
  d'autorisation sans backend custom à maintenir.
- Vercel simplifie le déploiement.

Les conventions de code, les patterns d'architecture et les règles
techniques détaillées sont décrits dans le fichier `CLAUDE.md` du
dépôt.

## 12. Architecture fonctionnelle

### Pages principales

- Connexion.
- Page d'accueil.
- Mon compte.
- Amis.
- Profil d'un joueur.
- Création de tournoi.
- Détail d'un tournoi (Équipes / Matchs / Classement).
- Résultats d'un tournoi terminé.
- Création d'un match libre.
- Détail d'un match libre.

## 13. Contraintes UX/UI

L'interface doit respecter les principes suivants :

- **Mobile-first** : layouts en colonne unique sur mobile, boutons
  pleine largeur, cibles tactiles confortables.
- Lisibilité maximale, peu de texte inutile.
- Navigation courte, feedback immédiat après saisie.
- Pas de surcharge visuelle.
- **Pas d'emoji dans l'UI produit.**
- Vocabulaire métier précis : Tournoi, Équipe, Match, Manche,
  Classement, Podium, Brouillon, En cours, Terminé, Vainqueur,
  Pseudo, Profil, Journal de bord, Match libre, Joueur lié à un
  compte, Joueur libre, Membre invité, Ami, Demande (reçue, envoyée),
  Profil public, Profil privé, Aperçu extérieur.

Le design doit être simple mais propre, avec une ambiance légère et
conviviale (tons chauds, coins arrondis, espacement généreux).

## 14. Sécurité et accès

- Authentification gérée par Supabase Auth (magic link et Google).
- L'application n'a pas vocation à être indexée publiquement.
- Les autorisations d'accès aux données sont appliquées au niveau de
  la base (Postgres), pas seulement côté interface.
- La validation des données est faite côté client (Zod) et côté base
  (contraintes et triggers).
- Un tournoi terminé est gelé côté base, pas seulement côté
  interface — aux deux exceptions près décrites en §8 (visibilité,
  suppression) ; toute autre correction passe par la réouverture.

## 15. Performances attendues

L'application doit :

- charger rapidement sur connexion mobile,
- rester fluide pendant la saisie,
- afficher le classement instantanément après chaque score,
- consulter un profil joueur en un seul appel réseau (les
  statistiques sont pré-calculées à la complétion d'un tournoi et à
  l'enregistrement d'un match libre).

## 16. Critères de réussite

Le projet sera considéré comme réussi si :

- un tournoi peut être créé et configuré en quelques secondes,
- les équipes (joueurs liés et joueurs libres) peuvent être saisies
  rapidement,
- les scores peuvent être enregistrés proprement,
- le classement se calcule automatiquement et se met à jour à chaque
  saisie,
- le résultat final est clair (podium + classement final),
- chaque joueur ayant un compte trouve dans son profil un historique
  cohérent de ses participations,
- l'application est utilisable en conditions réelles pendant un
  tournoi, sur mobile.

## 17. Priorités de développement

### Priorité 1 — MVP fonctionnel

- Création de tournoi, ajout d'équipes, saisie des scores,
  classement automatique, podium et résultats.
- Authentification, profils, pseudo unique.

### Priorité 2 — Confort d'usage

- Historique, édition des équipes et des scores tant que le tournoi
  n'est pas terminé.
- Visibilité publique/privée des tournois, invitations par pseudo.
- Page profil joueur avec statistiques agrégées et journal de bord.

### Priorité 3 — Robustesse

- Cohérence des invariants entre les couches.
  (Le gel des tournois terminés côté base est **livré** — voir §18.)

### Au-delà du MVP

Évolutions plausibles à plus long terme : statistiques de
confrontation, duos préférés, multi-format de tournoi, gamification
éventuelle. (Le système d'amis et la confidentialité du profil, prévus
ici, sont **livrés** — voir §4.1, §8 et §18.)

## 18. Roadmap

La source de vérité de la trajectoire produit est **`docs/roadmap.md`**.
Synthèse :

- **Horizon 1 — Fondations** : **livré** (gel des tournois terminés,
  spec du match libre, vérité documentaire, navigation joueur).
- **Horizon 2 — Le match libre** : **livré** (modèle dédié, recherche
  de compte par pseudo, création et détail, journal unifié et
  statistiques combinées) ; puis **Horizon 2.5 — Finitions** :
  **livré** (règle de score stricte).
- **Amitié & confidentialité** (chantier transversal) : **livré**, en
  six lots.
- **Horizon 3 — Ouverture grand public** : onboarding, confidentialité
  par défaut re-validée, robustesse, internationalisation (phase de
  cadrage dédiée).
- **Horizon 4 — Clubs & associations** : entité organisation,
  multi-organisateurs.

Sans dates ni engagements de calendrier.

### Réalisé

- Schéma initial et règles d'autorisation strictes.
- Visibilité publique/privée des tournois et tournois sur
  invitation.
- Profils utilisateurs avec pseudo unique.
- Joueurs liés à un compte et joueurs libres.
- Statistiques persistantes et journal de bord.
- Authentification Google en complément du magic link.
- Gel des tournois terminés côté base, avec deux exceptions
  (visibilité, suppression) et réouverture possible vers `en cours`
  (voir §8).
- Match libre : modèle dédié, création en une fois, page de détail,
  journal unifié et statistiques combinées.
- Règle de score stricte (vainqueur à exactement 13) sur les deux
  types de match.
- Amitié : relation mutuelle et ses cinq actions, écran de gestion
  avec recherche par pseudo exact, compteur de demandes reçues,
  statut et demande depuis un profil.
- Confidentialité du profil : réglage public / privé, contenu protégé
  en base, aperçu extérieur.

## 19. Cas limites à prévoir

- Score manquant ou invalide.
- Équipe supprimée alors qu'elle a déjà joué (autorisé uniquement
  tant que le tournoi n'est pas démarré).
- Match modifié après saisie (autorisé tant que le tournoi n'est pas
  terminé, recalcule le classement).
- Égalité parfaite entre plusieurs équipes (départage selon §8).
- Tournoi incomplet ou abandonné en cours.
- Pseudo en conflit lors d'un changement (refus + message clair).
- Joueur libre disparu (le nom snapshot reste visible dans le
  journal des autres joueurs).
- Suppression d'un compte (cascade en base ; pérennité de
  l'affichage post-suppression à traiter ultérieurement).
- Tentative de modifier un tournoi terminé (refusée côté base, hors
  les deux exceptions du §8 — visibilité, suppression ; toute
  correction passe par la réouverture vers `en cours`).

## 20. Conclusion

L'objectif de cette application est de proposer un outil minimaliste,
fiable et agréable pour gérer des parties et des tournois de pétanque,
destiné à s'ouvrir au grand public — les joueurs d'abord, les clubs et
associations ensuite — tout en donnant à chaque joueur ayant un compte
une trace persistante de ses participations.

Le projet conserve une ambition de simplicité dans son périmètre
actuel, avec une architecture suffisamment propre pour évoluer suivant
les horizons de `docs/roadmap.md` sans qu'il faille tout réécrire.
