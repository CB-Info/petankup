# Spec — Amitié et confidentialité du profil

> **Document de cadrage produit.** Décisions prises en session le 2026-09-01. Il précède la conception du modèle de données, qui fera l'objet d'un document distinct.
>
> **Contexte** : jusqu'ici, l'accès à un profil était restreint — il fallait avoir joué ensemble. Ce chantier **supprime cette restriction** : la page devient ouverte à tout utilisateur connecté, et c'est son **contenu** qui est protégé, selon un réglage du propriétaire et une relation d'amitié.

---

## 1. Le modèle en une phrase

**La page est ouverte à tous. Le réglage du propriétaire et l'amitié décident de ce qu'elle contient.**

C'est le modèle des réseaux sociaux grand public : n'importe qui peut ouvrir une page, le contenu est ce qui est protégé.

⚠️ **La règle « avoir joué ensemble » est supprimée** par ce chantier. Maintenir une restriction d'accès en plus d'une restriction de contenu, c'est protéger deux fois la même chose avec deux règles à tenir cohérentes.

|             | Profil **public** | Profil **privé** |
| ----------- | ----------------- | ---------------- |
| **Ami**     | Tout              | Tout             |
| **Non-ami** | Tout              | Le pseudo seul   |

---

## 2. L'amitié

| #      | Décision                                            | Détail                                                                                                                            |
| ------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | **Relation mutuelle**                               | Demandée par l'un, acceptée par l'autre. Une seule relation, pas deux liens symétriques à tenir cohérents.                        |
| **A2** | **Demande par pseudo exact**                        | Même mécanisme que le sélecteur de joueurs. Pas de listage, pas de recherche partielle.                                           |
| **A3** | **Aucune condition préalable**                      | On peut demander quelqu'un avec qui on n'a jamais joué. Permet d'ajouter un joueur rencontré au terrain avant la première partie. |
| **A4** | **Retrait silencieux et unilatéral**                | Chacun peut retirer l'autre ; la relation disparaît des deux côtés, sans notification.                                            |
| **A5** | **Le refus efface la demande**                      | On peut redemander. Pas de trace, pas de verrou.                                                                                  |
| **A6** | **Pas de blocage en V1**                            | À traiter à l'ouverture publique.                                                                                                 |
| **A7** | **Demandes croisées : la seconde vaut acceptation** | Si chacun demande l'autre, ils deviennent amis — c'est ce que les deux voulaient.                                                 |
| **A8** | **Annulation d'une demande envoyée**                | Seul le demandeur peut annuler sa propre demande, tant qu'elle est en attente. La ligne est supprimée, comme pour un refus — aucune trace, on peut redemander. Silencieuse, sans notification. Sans elle, la liste des demandes envoyées serait inactionnable. |

**Actions disponibles** : demander, accepter, refuser, annuler (sa demande envoyée), retirer.

**Écran dédié** : sa liste d'amis, les demandes reçues, les demandes envoyées. Accessible depuis la page de compte.

**La recherche d'un joueur** se fait sur ce même écran, par un champ intégré : un seul endroit pour tout ce qui touche aux relations. C'est le **seul moyen d'entrer en relation** avec quelqu'un — sans elle, aucune première demande n'est possible.

**Un compteur sur l'entrée « Amis »** de la page de compte signale les demandes reçues en attente. Pas de mécanisme d'alerte dédié : un simple nombre à côté du libellé. Sans lui, une demande resterait invisible — il n'existe aucune notification.

⚠️ Une **section notifications** est envisagée à terme. Le compteur est délibérément minimal pour qu'elle vienne par-dessus sans rien rendre obsolète.

**Depuis un profil** : le statut d'amitié est visible et la demande peut partir de là. C'est le point d'entrée le plus naturel — on découvre quelqu'un en consultant son profil.

---

## 3. La confidentialité du profil

| #      | Décision                                          | Détail                                                                                                           |
| ------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **C1** | **Deux valeurs : public ou privé**                | Réglable depuis la **page de compte**, avec les autres paramètres de l'utilisateur — pas sur la page de profil.  |
| **C2** | **Public par défaut**                             | Un nouveau compte est visible. Le privé est un choix délibéré.                                                   |
| **C3** | **Profil public = tout, pour tous**               | Statistiques et journal complet, noms des partenaires compris.                                                   |
| **C4** | **Profil privé = le pseudo seul** pour un non-ami | Ni statistiques, ni journal. Un ami voit tout.                                                                   |
| **C5** | **Changement expliqué**                           | Basculer le réglage s'accompagne d'une explication de ce que ça change concrètement. Pas un simple interrupteur. |
| **C6** | **Aperçu extérieur**                              | Le propriétaire dispose d'un moyen de voir son profil **tel que les autres le voient**.                          |
| **C7** | **Le nombre d'amis n'est pas affiché**            | Ni sur un profil public, ni sur un profil privé.                                                                 |

**Ce qui reste toujours visible** : le pseudo. Un profil privé n'est pas une page vide — on sait de qui il s'agit.

**Ce qui change** : l'accès à la page n'est plus restreint. Tout utilisateur connecté peut ouvrir n'importe quel profil ; il n'y verra que le pseudo si celui-ci est privé et qu'il n'est pas ami.

⚠️ **Point ouvert** : l'accès devient libre, mais il n'existe **aucun annuaire** — on arrive sur un profil par un tournoi, un match ou un lien direct. Ouvrir l'accès rend les profils _ouvrables_, pas _trouvables_. Une recherche d'utilisateurs sera peut-être souhaitable — hors périmètre.

---

## 4. Justification de C3 — les tierces personnes

Un journal nomme les partenaires et adversaires. Rendre son profil public expose donc, indirectement, **avec qui on joue** — sans que ces personnes aient été consultées.

**Décision : assumé.** Deux raisons.

Un profil privé affiche **déjà** son pseudo à quiconque l'ouvre. Voir ce même pseudo dans le journal d'un tiers ne révèle donc rien de nouveau sur l'identité de la personne — seulement la relation.

Et le produit a une vocation sociale : un parcours de joueur est fait de rencontres, on ne peut pas le raconter sans les nommer. Un journal anonymisé manquerait son objet.

**À re-trancher à l'ouverture publique**, quand des inconnus s'inscriront. L'anonymisation du journal pour les non-amis sera alors la réponse à considérer.

---

## 5. Risques assumés pour la V1

**R4 — Insistance possible.** Sans blocage (A6) et avec un refus qui autorise à redemander (A5), rien n'empêche quelqu'un de solliciter indéfiniment. Acceptable en cercle restreint, à re-trancher à l'ouverture publique en même temps que le blocage.

**R5 — Exposition des tierces personnes** par le journal d'un profil public (§4). Assumé, à re-trancher à l'ouverture publique.

**R6 — Les objets publics restent lisibles avec leurs participants.** La confidentialité du profil protège l'**agrégat** (la page de profil). Un match libre public ou un tournoi public reste lisible de tous, participants compris — même si l'un d'eux a un profil privé : un tiers peut donc reconstruire la part du journal d'un profil privé qui figure dans des objets publics. C'est le modèle de visibilité des objets, inchangé par ce chantier. Assumé (cohérent avec §4), à re-trancher à l'ouverture publique.

**R3 (rappel, hors périmètre)** — l'enrôlement sans consentement dans un match libre reste possible. L'amitié fournit désormais le **matériau** pour le fermer, mais la restriction elle-même n'est **pas** dans ce chantier : elle empêcherait de lier un joueur rencontré au terrain, ce qui casserait le parcours de saisie rapide. À décider une fois l'amitié en usage, quand on saura si les amis dans l'application correspondent aux partenaires de jeu réels.

---

## 6. Hors périmètre

- **Sélecteur de joueurs alimenté par la liste d'amis** — raffinement qui se posera par-dessus, en un petit ticket, sans rien défaire.
- **Restriction de l'enrôlement aux amis** (R3).
- **Blocage** d'un utilisateur (A6).
- **Notifications** — aucune notification n'est prévue, ni pour une demande, ni pour une acceptation, ni pour un retrait.
- **Système d'invitation généralisé** aux tournois et matchs libres — chantier distinct, qui pourra s'appuyer sur l'amitié.
- **Recherche d'utilisateurs / annuaire** — la découverte des profils reste par lien, tournoi ou match.

---

## 7. Ce que ce document débloque

1. **Conception du modèle de données** : la relation d'amitié et ses états, le réglage de confidentialité, et l'extension de la règle qui décide du contenu d'un profil.
2. **Les tickets de base** puis **les tickets d'interface** : écran de gestion des amis, réglage dans le compte, aperçu extérieur, statut et demande depuis un profil.

**Dette documentaire à corriger au passage** : `CLAUDE.md` affirme encore que les profils sont tous publics entre utilisateurs authentifiés. C'est faux depuis longtemps, et ce chantier le rend franchement trompeur.
