# Pétankup — Roadmap

> **Dernière mise à jour : 2026-09-04.** Source de vérité de la trajectoire produit. Le `cahier_des_charges.md` décrit le produit ; ce document décrit l'ordre dans lequel il se construit.
>
> **Vision** : application de gestion de parties et de tournois de pétanque, destinée au grand public (France puis international). Deux usages : les joueurs aujourd'hui, les clubs et associations à terme.

---

## État actuel

**Livré et vérifié** (599 tests verts, typecheck/build OK) :

- **Tournois** : cycle complet, visibilité public/privé, invitations par pseudo, joueurs libres, gel des tournois terminés, règle de score stricte (vainqueur à exactement 13).
- **Matchs libres** : une partie hors tournoi, enregistrée en une fois par un participant, née terminée et immuable. Création, page de détail, suppression par le créateur.
- **Profils joueurs** : pseudo unique, statistiques persistantes pour les deux pratiques, journal unifié avec filtre, total combinable à l'affichage.
- **Amitié** : relation mutuelle, cinq actions (demander, accepter, refuser, annuler, retirer), écran de gestion avec recherche par pseudo, compteur de demandes, statut depuis un profil.
- **Confidentialité** : réglage public/privé sur la page de compte, contenu protégé **en base**, aperçu extérieur. La page d'un profil est ouverte à tout utilisateur connecté ; c'est son contenu qui est protégé.
- **Architecture** : trois stores aux frontières nettes, authentification amorcée au démarrage, chaque page ne chargeant que ce qu'elle affiche, retour contextuel générique partagé par tous les domaines.
- **Design** : « Nuit & Corail » sur tous les écrans, en-tête unifié dans le layout.

---

## Dettes ouvertes

### Petites, sans urgence

| Dette                                                                                                                                                                                  | Origine |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Lire le statut d'amitié **d'une seule personne** — la page de profil charge aujourd'hui toutes les relations                                                                           | A3      |
| Demander en ami **par identifiant** plutôt que par pseudo — un renommage entre l'affichage et le clic fait échouer                                                                     | A3      |
| **Chargement groupé des profils depuis l'accueil**, où aucun joueur n'est affiché ni cliquable. Volume croissant avec le nombre de tournois — à déplacer vers l'ouverture d'un tournoi | H2.b    |
| **Email des membres de tournoi** : vestige d'un système d'invitation par email abandonné. Vérifier qu'aucun consommateur ne le lit avant de retirer                                    | ancien  |
| **Deux fenêtres de visibilité** (tournoi, profil) qui font la même chose — à unifier                                                                                                   | A4      |
| **Pseudo figé** affiché au lieu du pseudo à jour pour un visiteur non-propriétaire sur les cartes d'équipe. Corriger exigerait une requête supplémentaire                              | ancien  |
| Contrainte orpheline en base ; commentaire manquant sur le helper de visibilité des matchs libres                                                                                      | ancien  |

### Décisions en attente

**Personnaliser les messages de confirmation** par action, plutôt qu'un libellé unique pour toutes les suppressions. À trancher après quelques jours d'usage réel.

**Le pseudo figé, dans son principe.** Aucun service n'affiche l'ancien pseudo de quelqu'un. Mais il sert de filet quand un compte disparaît, et il est la seule donnée existante pour un joueur sans compte. Décider ce qu'affiche un tournoi dont un participant a supprimé son compte.

### Assumées, documentées

**Divergence de classement TS ↔ SQL** sur un cycle parfait entre trois équipes ou plus. Le calcul TypeScript n'est lui-même pas un ordre total dans ce cas. Fixtures partagées, divergence prouvée. Ne se lève qu'avec une décision produit : quel critère départage un cycle ?

**Traitement des erreurs non unifié** : un message technique de la base a pu s'afficher à l'écran. Corrigé au cas par cas, le mécanisme demeure. Chantier prévu, avec audit préalable.

**Réouverture de tournoi** : capacité en base sans affordance dans l'interface. Choix assumé — à construire si le besoin se présente.

---

## Horizons

### Horizon 1 — Fondations & vérité documentaire ✅

Gel des tournois terminés · spécification du match libre · révision du cahier des charges et versionnage des documents produit · navigation joueur · robustesse du chargement de profil.

### Horizon 2 — Le match libre ✅

Modèle de données dédié · recherche de compte par pseudo · écran de création et page de détail · journal unifié et statistiques combinées.

_Refactors menés en cours de route_ : renommage de la table des matchs de tournoi, découpage des stores, sortie de l'amorçage d'authentification, généralisation du retour contextuel.

### Horizon 2.5 — Finitions ✅

Règle de score des tournois durcie (quatre matchs historiques corrigés par réouverture sanctionnée), puis remontée de la règle dans le composant de saisie partagé — une seule expression côté application, deux en base (une par table, imposé par le modèle).

_Note d'histoire_ : l'extension de la règle d'accès aux profils aux matchs communs a été livrée puis **rendue obsolète** par le chantier suivant, qui a supprimé cette règle. Le travail n'est pas perdu — il a débloqué l'affichage des pseudos à jour dans l'intervalle, et son harnais a servi de base au remplaçant.

### Amitié & confidentialité ✅

Chantier transversal, livré en six lots. Relation mutuelle et ses cinq actions · contenu du profil protégé en base, ancienne règle d'accès supprimée · écran de gestion des amis · série de finitions sur les messages · lecture de son propre réglage et composition « vue par un tiers » · réglage et aperçu extérieur.

**Règle établie au passage** : _ce qui disparaît confirme, ce qui apparaît nomme._ Aucune action d'amitié n'est muette.

### Horizon 3 — Ouverture grand public

Onboarding pour des utilisateurs qui ne se connaissent pas · confidentialité par défaut re-validée + conformité RGPD · modération minimale · robustesse, quotas et coûts · internationalisation.

**Peu de schéma, forte exposition** — cet horizon aura sa **propre phase de cadrage** avant lancement.

**Cinq points à re-trancher ici :**

- **R3 — Enrôlement sans consentement** : on peut désigner un compte comme participant sans son accord. L'amitié fournit désormais le matériau pour le fermer.
- **R4 — Insistance possible** : sans blocage et avec un refus qui autorise à redemander, rien n'empêche de solliciter indéfiniment.
- **R5 — Exposition des tierces personnes** : le journal d'un profil public nomme ses partenaires, qui n'ont pas été consultés.
- **R6 — Objets publics** : le journal d'un profil privé reste partiellement reconstructible via les tournois et matchs publics où il figure.
- **Statistiques auto-déclarées** : pas de confirmation de l'adversaire sur un match libre.

**O1 — La découverte des profils.** Trois chemins existent : un tournoi, un match, ou la recherche par pseudo exact. Aucun annuaire : impossible de découvrir quelqu'un dont on ignore le pseudo. Une recherche plus ouverte serait une capacité nouvelle, avec ses propres questions de confidentialité.

### Horizon 4 — Clubs & associations

Entité organisation (membres, rôles), tournois rattachés à un club, multi-organisateurs, calendrier et inscriptions. **Aucune action maintenant.** Règle permanente : ne rien décider qui suppose qu'un tournoi appartient à jamais à un individu unique.

---

## Chantiers transversaux

**Système d'invitation généralisé** — un joueur ne serait lié à une partie qu'après avoir accepté. Résout R3. À cadrer : le consentement par invitation est incompatible avec un match qui naît terminé ; la liste d'amis résout ce conflit en donnant le consentement en amont.

**Notifications** — aucune notification n'existe aujourd'hui. Le compteur de demandes d'amis a été construit délibérément minimal pour qu'une section notifications vienne par-dessus sans rien rendre obsolète.

**Unification du traitement des erreurs** — jamais de message technique affiché. Audit préalable des cas existants.

**Qualité et outillage** — état des lieux à faire : intégration continue, tests de bout en bout, surveillance en production. Jamais abordé à ce jour.

**Refonte du design** — quand l'application sera complète, décision de Clément.

---

## Hors trajectoire

Gamification · scoring mène par mène · header collant et couleur sous la barre de statut (abandon assumé) · fédérations et licences officielles · applications natives · invitation par email · blocage d'un utilisateur (reporté à l'Horizon 3).

## Risques permanents

1. **Dispersion** (développeur solo, vision large) → un horizon actif, un ticket actif.
2. **Construire avant de spécifier** → toute nouvelle capacité passe par une spec avant migration.
3. **Sous-estimer l'ouverture publique** → l'Horizon 3 ne démarre qu'après son propre cadrage.
