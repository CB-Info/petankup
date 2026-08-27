# Spec produit — Le match individuel (« match libre »)

> **Livrable H1.b.** Zéro code. Décisions produit actées lors de la session de cadrage du 2026-08-19, hypothèses par défaut marquées `[HYPOTHÈSE]` à valider ou amender par Clément. Ce document débloque : le ticket freeze (H1.a) et, plus tard, la conception DB de l'Horizon 2.

---

## 1. Définition

Un **match libre** est une partie de pétanque jouée hors de tout tournoi, enregistrée dans Pétankup par un de ses participants. Il alimente le journal et les stats des joueurs à compte, séparément des tournois.

## 2. Décisions actées

| #   | Décision                                   | Détail                                                                                                                                                                                                 |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **Participants mixtes**                    | Joueurs avec compte + joueurs libres (nom saisi, sans compte), comme dans les équipes de tournoi. Seuls les joueurs à compte ont des stats.                                                            |
| D2  | **Tous les formats**                       | Tête-à-tête, doublette, triplette (1 à 3 joueurs par côté — même borne que les équipes de tournoi).                                                                                                    |
| D3  | **Stats séparées + combinables**           | Le profil distingue « en tournoi » et « en match libre », et peut afficher un total combiné. Le combiné est **calculé à la lecture** (somme des deux sources), jamais stocké.                          |
| D4  | **Confiance totale**                       | Le créateur saisit le score ; le match est figé dès sa complétion. Pas de confirmation par l'adversaire.                                                                                               |
| D5  | **Visibilité au choix du créateur**        | Privé/public, même logique que les tournois.                                                                                                                                                           |
| D6  | **Création par tout participant à compte** | Celui qui crée devient l'owner du match (édition avant complétion, suppression). ⚠️ Un non-joueur ne peut pas créer un match libre (différence assumée avec le tournoi, où l'owner peut ne pas jouer). |

## 3. Hypothèses par défaut `[HYPOTHÈSE — à valider]`

- **H1 — Règles de score identiques aux matchs de tournoi** : scores ≥ 0, vainqueur à 13 minimum, pas d'égalité (mêmes CHECKs que `tournament_matches` aujourd'hui).
- **H2 — Date de jeu** : un champ « joué le » saisi par le créateur (défaut : aujourd'hui), pour pouvoir enregistrer une partie d'hier soir. Le journal trie dessus.
- **H3 — Cycle de vie minimal** : `pending` → `completed`. Pas d'étape intermédiaire. L'owner peut supprimer son match ; si le match était complété, les stats des joueurs concernés sont recalculées (même logique que la suppression d'un tournoi terminé aujourd'hui).
- **H4 — Pas de mènes/manches** : un score final par côté, point. (Le mène-par-mène reste hors scope, comme pour les tournois.)
- **H5 — Un joueur à compte ne peut apparaître que dans un seul côté du match** (pas des deux côtés) ; un même joueur libre non plus.

## 4. Implications sur le modèle (niveau spec — PAS une conception DB)

- **Le match libre ne réutilise PAS les équipes de tournoi.** L'audit a montré que `teams` est structurellement lié à un tournoi (FK composites). Le match libre aura **son propre modèle de participants**, calqué sur le pattern existant `team_players` (`user_id` nullable + snapshot du nom) — deux « côtés » de 1 à 3 participants.
- **Stats : une matérialisation par source.** L'existant (`user_tournament_results` → agrégat) reste intact ; le match libre ajoute sa propre matérialisation à sa complétion. L'agrégat par joueur distingue les deux sources ; le combiné se calcule à l'affichage. Les compteurs spécifiques tournoi (tournois joués/gagnés, podiums) n'ont pas d'équivalent match libre.
- **Prédicat de gel unifié** (résout la crainte de duplication) : _un match est figé si son tournoi parent est terminé, OU si c'est un match libre complété._ Une règle, deux déclencheurs. Le ticket freeze (H1.a) doit être écrit avec ce prédicat comme point d'application unique, même si sa V1 ne couvre que les tournois.
- **Visibilité** : le helper de visibilité existant côté tournois sert de modèle ; le match libre aura l'équivalent (owner OU participant OU public).

## 5. Risques acceptés (et leur date de péremption)

- **R1 — Stats auto-déclarées** : avec D4 (confiance totale) + D5 (matchs publics possibles), un utilisateur peut se fabriquer un palmarès en matchs libres. **Contenu** par D3 : les stats tournoi restent inviolées, la ligne « match libre » est déclarative par nature. **Accepté tant que l'app reste en cercle restreint. À RE-TRANCHER à l'Horizon 3** (ouverture publique) : confirmation adversaire, délai de contestation, ou badge « vérifié » seront alors sur la table.
- **R2 — Pas de garde anti-doublon** : rien n'empêche d'enregistrer deux fois la même partie. Accepté (même situation qu'un carnet papier).

## 6. Hors scope explicite

Confirmation du résultat par l'adversaire (→ H3) · mène-par-mène · classement Elo/rating · matchs multi-manches ou séries · défis/invitations à jouer · statistiques tête-à-tête entre deux joueurs (« rivalités » — post-MVP, se nourrira de ces données).

## 7. Ce que cette spec débloque

1. **Ticket H1.a (freeze)** : peut maintenant être écrit une seule fois, avec le prédicat unifié du §4, appliqué en V1 aux tournois.
2. **Révision du cahier des charges (H1.c)** : le match libre entre dans la vision, les §10/§17/§18 peuvent être réécrits avec ces décisions.
3. **Horizon 2** : la conception DB partira de ce document, pas d'hypothèses.
