# Conception — Le match libre (Horizon 2)

> **Document de conception du modèle de données.** Complète `spec_match_individuel.md` (spec produit, H1.b) avec les décisions structurelles prises en session le 2026-08-26. Déclaratif : il décrit **ce que le modèle doit garantir**, pas le SQL — celui-ci sera écrit dans le ticket H2.a après inspection du repo.

---

## 1. Décision fondatrice : des tables dédiées

Le match libre est un **objet distinct**, avec ses propres tables. Les matchs de tournoi ne sont pas modifiés.

**Pourquoi pas une table unique** (`tournament_id` rendu facultatif) : la table de matchs actuelle est verrouillée autour du tournoi — clés composites garantissant que deux équipes d'un match appartiennent au même tournoi, unicité des paires par tournoi, numéro de tour obligatoire. Étendre rendrait ces garanties conditionnelles, donc plus faibles sur des données qui fonctionnent. Et le bénéfice attendu (code partagé) est faible : la spec impose déjà des **statistiques séparées**.

**Pourquoi pas une refonte « match d'abord »** (tournoi = regroupement de matchs) : plus élégant, mais c'est le plus gros chantier du projet — découplage des participants, réécriture de la couche statistiques livrée, gel, RPC de profil, chaîne TypeScript, ~300 tests, sur une application en usage réel. Bénéfice conceptuel, coût et risque immédiats.

**Contrainte de conception retenue** : le modèle de participants du match libre doit rester **suffisamment proche de l'existant** (`team_players`) pour qu'une convergence future soit une migration, pas une réécriture. Aucune particularité gratuite.

---

## 2. Décisions structurelles (session 2026-08-26)

| #       | Décision                                                                                                           | Conséquence                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **S1**  | **Pas d'équipe.** Chaque participant est une ligne rattachée à un **camp** (A ou B).                               | Pas de nom d'équipe, pas d'objet intermédiaire. Structure jumelle de `team_players`, l'équipe remplacée par le camp. |
| **S2**  | **Le match naît terminé.** Joueurs et score saisis en une fois ; aucun état intermédiaire.                         | Pas de match en attente, pas de match fantôme dans le journal. Le gel devient inutile (§3.4).                        |
| **S3**  | **Correction = suppression + nouvelle saisie.** Pas de réouverture, pas d'édition.                                 | Un match libre est **immuable** une fois créé. La seule opération d'écriture après création est la suppression.      |
| **S4**  | **Date de jeu saisissable**, par défaut la date du jour.                                                           | Permet de noter le dimanche soir les parties du week-end. Détermine l'ordre dans le journal.                         |
| **S5**  | **Journal unifié avec filtre.** Une liste chronologique mêlant tournois et matchs libres, plus un filtre par type. | La chronologie du parcours de joueur est préservée par défaut. Indépendant des statistiques, qui restent séparées.   |
| **S6**  | **Seul le créateur peut supprimer.**                                                                               | Voir risque R1, assumé pour la V1.                                                                                   |
| **S7**  | **Suppression de compte : le match survit**, pseudo conservé en texte, statistiques des autres inchangées.         | Même logique que les tournois aujourd'hui. Une partie jouée reste une partie jouée.                                  |
| **S8**  | **Match sans aucun participant à compte : supprimé automatiquement.**                                              | Quand le dernier compte participant disparaît, le match ne sert plus à personne.                                     |
| **S9**  | **Camps équilibrés.** Un match libre se joue en tête-à-tête, doublette ou triplette : les deux camps comptent le même nombre de joueurs (décision révisée le 2026-08-28 ; la version initiale autorisait 2 contre 3). | Une formation improvisée (2 contre 3) est refusée à la création, avec un code d'erreur dédié (`unbalanced_sides`), distinct de la règle d'effectif « 1 à 3 par camp » (`invalid_side_count`). |
| **S10** | **Une entrée de match libre est cliquable** dans le journal, comme un tournoi.                                     | Implique une page de détail et une règle d'accès — voir §3.3.                                                        |
| **S11** | **La date de jeu n'est jamais future** (décision du 2026-08-28).                                                | Le champ sert à noter une partie déjà jouée (S4), pas à en planifier une ; une date future fausserait la chronologie du journal. Bornée à « aujourd'hui » en date de Paris (le serveur est en UTC). |

**Rappel des décisions produit (spec H1.b)** : participants mixtes (comptes + joueurs libres) · tous formats, 1 à 3 par camp · statistiques séparées mais combinables · confiance totale (pas de confirmation de l'adversaire) · visibilité au choix du créateur · création par tout participant ayant un compte.

---

## 3. Ce que le modèle doit garantir

### 3.1 Le match

- Porte son **créateur** (seul habilité à supprimer), sa **date de jeu**, son **score par camp**, sa **visibilité**.
- Le vainqueur est déterminé par le score. **Règle stricte** (décision du 2026-08-28) : le vainqueur marque **exactement 13**, le perdant **entre 0 et 12** — on joue toujours en 13, la non-égalité en découle. Plus stricte que la règle actuelle des tournois (« au moins 13 », qui laisse passer un 20-0) : défaut connu, à corriger côté tournoi dans un ticket séparé sur données existantes ; le match libre n'a aucune donnée et part avec la règle juste.
- La **date de jeu** ne peut pas être future (S11), en date de Paris.
- **Immuable après création** (S3) : aucune mise à jour autorisée, seulement la suppression.
- Le créateur doit être **participant** du match (spec H1.b).

### 3.2 Les participants

- Deux camps de **même effectif**, **1 à 3 participants chacun** (S9 révisée : tête-à-tête, doublette ou triplette — un 2 contre 3 est refusé).
- Chaque participant porte un **camp**, un **lien vers un compte** (facultatif) et un **pseudo enregistré** (toujours présent).
- Un même compte ne peut apparaître **qu'une fois** dans un match, tous camps confondus.
- La perte du compte efface le lien mais **conserve le pseudo** (S7).

### 3.3 La visibilité et l'accès

- Choisie par le créateur : publique ou privée.
- Un match privé est visible de ses **participants à compte** ; un match public, de tout utilisateur connecté.
- ⚠️ **Réutiliser le mécanisme de visibilité existant** plutôt que d'en écrire un second. Si le helper actuel est trop lié au tournoi pour être réemployé tel quel, le signaler — la règle doit rester exprimée à un seul endroit par famille d'objets.
- **Conséquence de S10** : le journal d'un autre utilisateur peut lister un match libre privé que le visiteur ne peut pas ouvrir. C'est exactement le problème résolu pour les tournois par `viewer_can_open` — **réutiliser le même motif** : le lien n'apparaît que là où le visiteur peut réellement ouvrir. Ne pas réintroduire de règle de visibilité côté client.

### 3.4 Le gel

Un match libre étant immuable dès sa création, il n'a **pas besoin d'un mécanisme de gel** comparable à celui des tournois : l'absence de chemin de modification suffit.

Le prédicat unifié `tournament_is_frozen` reste tel quel. ⚠️ Le commentaire qui y annonce un « second déclencheur (match libre complété) » **devient faux** — à corriger dans le ticket H2.a, en expliquant que l'immuabilité du match libre est structurelle et non conditionnelle.

### 3.5 Les statistiques

- **Source distincte** de `user_tournament_results`. Les compteurs de tournoi (tournois joués, gagnés, podiums) n'ont pas d'équivalent.
- Compteurs attendus : matchs joués, victoires, défaites, points marqués, points encaissés.
- **Matérialisation à la création** du match (il naît terminé), **dématérialisation à la suppression** — réutiliser la fonction commune extraite en H1.a plutôt que d'en écrire une seconde.
- Le **total combiné** (tournois + matchs libres) est calculé **à la lecture**, jamais stocké.
- Les joueurs libres n'ont pas de statistiques (pas de compte).
- **Un compte supprimé n'a plus de statistiques** : le recalcul commun est un no-op pour un compte disparu (il purge ses lignes et sort) et ne ré-insère jamais rien pendant la cascade de suppression — sinon la cascade des tournois, qui recalcule le compte supprimé lui-même, violerait la clé étrangère vers `auth.users` et annulerait la suppression (bug latent corrigé en H2.a).

---

## 4. Risques assumés pour la V1

**R1 — Un participant ne peut pas corriger un match erroné.** Combinaison de S3 (correction = suppression) et S6 (seul le créateur supprime) : si le créateur saisit un mauvais score et ne le corrige pas, les autres participants ont un match faux dans leurs statistiques, sans recours.

**R2 — Match orphelin de son créateur.** Si le créateur supprime son compte alors que d'autres participants à compte restent, le match survit (S7) mais plus personne ne peut le supprimer.

**R3 — Enrôlement sans consentement.** Tout créateur peut lier n'importe quel compte comme participant (par identifiant), ce qui écrit dans le journal et les statistiques de cette personne sans qu'elle ait rien accepté — R1 et R2 ne couvrent que les erreurs du créateur lui-même. Côté tournoi, un joueur lié doit être organisateur ou membre invité ; le match libre n'a pas d'équivalent en V1.

**Décision : les trois sont assumés pour la V1** — modèle minimal, usage en cercle restreint où une erreur se règle par un message plutôt que par une fonctionnalité.

**Solution identifiée si le besoin se manifeste** — le **retrait individuel** : un participant ne supprime pas le match, il s'en retire (lien vers le compte effacé, pseudo conservé, statistiques recalculées). C'est exactement le mécanisme déjà décidé en S7 pour la suppression de compte, donc **purement additif** : aucun changement du modèle, un point d'entrée en plus. Il fermerait R1 et R2 d'un coup — R2 parce que chaque participant restant pourrait se retirer d'un match orphelin, jusqu'à déclencher S8.

Pour R3, le remède prévu n'est pas le retrait individuel mais un **système d'invitation** : un joueur à compte ne sera lié qu'après avoir accepté, dans les tournois comme dans les matchs libres. Chantier transversal, hors H2.a. Le retrait individuel reste une solution intermédiaire si le besoin surgit avant.

À re-trancher à l'Horizon 3 (ouverture publique), où la confiance entre inconnus ne pourra plus être présumée.

---

## 5. Ce que ce document débloque

1. **Ticket H2.a** — migration : tables, contraintes, RLS, matérialisation des statistiques, suppression automatique (S8), correction du commentaire obsolète du prédicat de gel.
2. **Ticket H2.b** — parcours de création rapide (« on est 4 au terrain, on note »).
3. **Ticket H2.c** — journal unifié avec filtre (S5), statistiques combinées, accès aux matchs libres depuis le journal (S10 + motif `viewer_can_open`).

À réexaminer au démarrage de H2.a : le **découpage du store** (le store `tournament` porte déjà les profils ; le match libre y ajouterait une troisième famille).
