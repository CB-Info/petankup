# Pétankup — Roadmap

> **Dernière mise à jour : 2026-08-31.** Source de vérité de la trajectoire produit. Le `cahier_des_charges.md` décrit le produit ; ce document décrit l'ordre dans lequel il se construit.
>
> **Vision** : application de gestion de parties et de tournois de pétanque, destinée au grand public (France puis international). Deux usages : les joueurs aujourd'hui, les clubs et associations à terme.

---

## État actuel

**Livré et vérifié** (467 tests verts, typecheck/build OK) :

- **Tournois** : cycle complet, visibilité public/privé, invitations par pseudo, joueurs libres, RLS durcie, gel des tournois terminés.
- **Matchs libres** : une partie hors tournoi, enregistrée en une fois par un participant, née terminée et immuable. Création, page de détail, suppression par le créateur.
- **Profils joueurs** : pseudo unique, statistiques persistantes pour les deux pratiques, journal unifié avec filtre, total combinable à l'affichage.
- **Accès** : un lien n'apparaît que là où le visiteur peut réellement ouvrir la ressource ; un match public montre ses joueurs, un match privé ne les montre qu'à ses participants.
- **Architecture** : trois stores aux frontières nettes (tournoi, profil, identité), authentification amorcée au démarrage de l'application, chaque page ne chargeant que ce qu'elle affiche. Retour contextuel générique, partagé par les deux domaines.
- **Design** : « Nuit & Corail » sur tous les écrans, en-tête unifié dans le layout.

**Dettes ouvertes :**

| Gravité | Dette                                                                                                                                                                           | Statut                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 🟠      | **Règle de score des tournois** : le vainqueur doit atteindre 13, mais rien ne l'empêche de dépasser — un 20-0 est accepté. Les matchs libres appliquent déjà la règle stricte. | En cours de traitement                                                                                                         |
| 🟠      | **Visibilité des profils** : la règle exige un tournoi commun. Deux participants d'un match libre privé ne voient pas le pseudo à jour l'un de l'autre.                         | En cours de traitement                                                                                                         |
| 🟡      | **Divergence de classement TS ↔ SQL** sur un cycle parfait entre trois équipes ou plus. Le calcul TypeScript n'est lui-même pas un ordre total dans ce cas.                     | **Dette assumée**, documentée, fixtures partagées. Ne se lève qu'avec une décision produit : quel critère départage un cycle ? |
| 🟡      | **Traitement des erreurs non unifié** : un message technique de la base a pu s'afficher à l'écran. Corrigé au cas par cas, le mécanisme demeure.                                | Chantier prévu après l'Horizon 3, avec audit préalable                                                                         |
| ⚪      | **Chargement groupé des profils depuis l'accueil**, où aucun joueur n'est affiché ni cliquable. Volume croissant avec le nombre de tournois.                                    | À déplacer vers l'ouverture d'un tournoi                                                                                       |
| ⚪      | **Email des membres de tournoi** : vestige d'un système d'invitation par email abandonné. Vérifier qu'aucun consommateur ne le lit avant de retirer.                            | Ouvert                                                                                                                         |
| ⚪      | Pseudo figé affiché au lieu du pseudo à jour pour un visiteur non-propriétaire sur les cartes d'équipe                                                                          | Corriger exigerait une requête supplémentaire. Laissé en l'état                                                                |
| ⚪      | Réouverture de tournoi : capacité en base sans affordance dans l'interface                                                                                                      | **Choix assumé** — à construire si le besoin se présente                                                                       |
| ⚪      | Contrainte orpheline en base ; commentaire manquant sur le helper de visibilité des matchs libres                                                                               | Basse priorité                                                                                                                 |

---

## Horizon 1 — Fondations & vérité documentaire ✅ **TERMINÉ**

Gel des tournois terminés · spécification du match libre · révision du cahier des charges et versionnage des documents produit · navigation joueur (coéquipiers, entrées cliquables, joueurs liés à leur profil) · robustesse du chargement de profil.

## Horizon 2 — Le match libre ✅ **TERMINÉ**

Modèle de données dédié · recherche de compte par pseudo · écran de création et page de détail · journal unifié et statistiques combinées.

_Refactors menés en cours de route_ : renommage de la table des matchs de tournoi, découpage des stores, sortie de l'amorçage d'authentification, généralisation du retour contextuel.

## Horizon 2.5 — Finitions 🔄 **EN COURS**

- Durcir la règle de score des tournois, puis remonter la règle dans le composant de saisie partagé.
- Étendre la visibilité des profils aux matchs communs.
- Mise à jour de la documentation.

## Horizon 3 — Ouverture grand public

Onboarding pour des utilisateurs qui ne se connaissent pas · confidentialité par défaut re-validée + conformité RGPD · modération minimale · robustesse, quotas et coûts · internationalisation.

**Peu de schéma, forte exposition** — cet horizon aura sa **propre phase de cadrage** avant lancement.

**Trois points à re-trancher ici :**

- Les statistiques de matchs libres sont **auto-déclarées** : pas de confirmation de l'adversaire. Acceptable en cercle restreint.
- **Enrôlement sans consentement** : on peut désigner un compte comme participant sans son accord. Remède prévu : le système d'invitation.
- **Énumération de pseudos** : la recherche par pseudo exact permet de tester des noms un par un. Lente et sans listage, mais praticable.

## Horizon 4 — Clubs & associations

Entité organisation (membres, rôles), tournois rattachés à un club, multi-organisateurs, calendrier et inscriptions. **Aucune action maintenant.** Règle permanente : ne rien décider qui suppose qu'un tournoi appartient à jamais à un individu unique.

---

## Chantiers transversaux (hors horizons)

**Système d'amis et d'invitation** — un joueur ne serait lié à une partie qu'après avoir accepté. Résout l'enrôlement sans consentement, rend la recherche par pseudo secondaire, et remplace la source du sélecteur de joueurs. À cadrer : le consentement par invitation est incompatible avec un match qui naît terminé ; une liste d'amis résout ce conflit en donnant le consentement en amont.

**Unification du traitement des erreurs** — une règle simple : jamais de message technique affiché tel quel. Audit préalable des cas existants.

**Refonte du design** — à faire quand l'application sera complète, décision de Clément.

---

## Hors trajectoire

Gamification · scoring mène par mène · header collant et couleur sous la barre de statut (abandon assumé) · fédérations et licences officielles · applications natives · invitation par email.

## Risques permanents

1. **Dispersion** (développeur solo, vision large) → un horizon actif, un ticket actif.
2. **Construire avant de spécifier** → toute nouvelle capacité passe par une spec avant migration.
3. **Sous-estimer l'ouverture publique** → l'Horizon 3 ne démarre qu'après son propre cadrage.
