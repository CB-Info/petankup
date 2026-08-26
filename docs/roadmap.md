# Pétankup — Roadmap

> **Dernière mise à jour : 2026-08-26.** Source de vérité de la trajectoire produit. Le `cahier_des_charges.md` décrit le produit ; ce document décrit l'ordre dans lequel il se construit.
>
> **Vision** : application de gestion de parties et de tournois de pétanque, destinée au grand public (France puis international). Deux usages : les joueurs aujourd'hui, les clubs et associations à terme. Nouvelle capacité produit spécifiée : le **match libre** (partie hors tournoi).

---

## État actuel

**Livré et vérifié** (298 tests verts, typecheck/build OK) :

- Cycle tournoi complet : création, équipes, matchs, scores, classement live, podium.
- Visibilité public/privé, invitations par pseudo, joueurs libres, RLS durcie.
- Profils joueurs : pseudo unique, **statistiques persistantes et journal de bord**.
- Redesign « Nuit & Corail », header unifié dans le layout.
- **Gel des tournois terminés** : immuabilité garantie côté base, deux exceptions (visibilité, suppression), réouverture possible vers « en cours ». Les statistiques ne peuvent plus diverger silencieusement.
- **Navigation joueur** : coéquipiers affichés dans le journal, entrées de journal cliquables vers leur tournoi (retour contextuel qui survit au rechargement), joueurs à compte cliquables depuis les cartes d'équipe.
- **Robustesse de chargement** : le profil se charge dès que l'identité est résolue (plus d'« introuvable » prématuré au rechargement) ; un identifiant d'URL malformé mène à l'état « introuvable » sans requête ni erreur technique affichée.
- **Accès aux tournois d'autrui** : le RPC de profil dérive `viewer_can_open` par entrée — un lien apparaît exactement là où le visiteur peut réellement ouvrir le tournoi (publics, et privés auxquels il a participé).

**Dettes ouvertes :**

| Gravité | Dette                                                                                                                                                                                           | Statut                                                                                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟡      | Divergence de classement TS ↔ SQL sur cycle parfait à 3+ équipes                                                                                                                                | **Dette assumée**, documentée, fixtures partagées en place. Ne pas « corriger » sans décision produit.                                                                      |
| 🟡      | Traitement des erreurs non unifié : un message technique brut de la base a pu s'afficher à l'écran (constaté sur un identifiant malformé, depuis corrigé au cas par cas). Le mécanisme demeure. | Chantier prévu **après l'Horizon 2**, avec audit préalable des cas d'erreur existants. Règle visée : jamais de texte technique affiché tel quel.                            |
| 🟡      | Boutons d'équipe (modifier, supprimer, ajouter) encore visibles quoique désactivés sur un tournoi terminé                                                                                       | Ouvert — ticket C                                                                                                                                                           |
| ⚪      | _God store_ : `tournament` porte aussi les profils, les équipes, les matchs et le classement. Le nom ne décrit plus son contenu.                                                                | **Décision : ne rien faire maintenant.** À réexaminer au moment du match libre, quand on saura ce que H2 doit réellement stocker. Découper par domaine plutôt que renommer. |
| ⚪      | Pseudo figé vs pseudo actuel : un visiteur non-owner voit le pseudo enregistré dans la carte d'équipe, alors que le profil lié affiche le pseudo à jour                                         | Corriger exigerait une requête supplémentaire. Coût disproportionné, laissé en l'état.                                                                                      |
| ⚪      | Réouverture de tournoi : capacité en base sans affordance UI                                                                                                                                    | **Choix assumé** — à construire si le besoin se présente                                                                                                                    |
| ⚪      | Contrainte orpheline en base (`text_array_has_no_blank_values`)                                                                                                                                 | Ouvert, basse priorité                                                                                                                                                      |

---

## Horizon 1 — Fondations & vérité documentaire ✅ **TERMINÉ**

- **H1.a — Gel des tournois terminés** ✅ Prédicat de gel unifié, conçu pour accueillir le second déclencheur (match libre complété) à l'Horizon 2 sans réécriture.
- **H1.b — Spec du match libre** ✅ → `docs/spec_match_individuel.md`.
- **H1.c — Révision du cahier des charges + versionnage des docs produit** ✅
- **H1.d — Navigation joueur** ✅ (+ correctifs A et B : chargement de profil, identifiants malformés, `viewer_can_open`).

## Horizon 2 — Le match libre

_Objectif : on peut jouer sur Pétankup sans organiser un tournoi._

1. **H2.a — Modèle de données**, selon `docs/spec_match_individuel.md`. ⚠️ Contrainte connue : les équipes sont structurellement liées à un tournoi (FK composites) — le match libre aura son propre modèle de participants, calqué sur le pattern `team_players`. **Démarrer par une session de conception**, pas par une migration.
2. **H2.b — Parcours de création rapide** (« on est 4 au terrain, on note »).
3. **H2.c — Extension des statistiques** : seconde source, distinguée de la source tournoi, combinable à l'affichage. Le prédicat de gel gagne son second déclencheur.
4. **H2.d — Journal enrichi** : matchs libres et tournois sur le profil.

_À réexaminer au démarrage : le découpage du store (cf. dettes)._

## Horizon 3 — Ouverture grand public

Onboarding pour des utilisateurs qui ne se connaissent pas · confidentialité par défaut re-validée + conformité RGPD · modération minimale · robustesse, quotas et coûts · internationalisation. Peu de schéma, forte exposition — cet horizon aura sa **propre phase de cadrage** avant lancement.

**Deux points à re-trancher ici :**

- Les statistiques de matchs libres sont **auto-déclarées** (pas de confirmation de l'adversaire — décision D4 de la spec). Acceptable en cercle restreint, à revoir à l'ouverture.
- **Visibilité des profils** : un visiteur voit aujourd'hui les **noms** des tournois privés d'autrui dans leur journal, ainsi que les coéquipiers de parties auxquelles il n'a pas participé. Décision antérieure assumée, à re-trancher pour un public d'inconnus.

## Horizon 4 — Clubs & associations

Entité organisation (membres, rôles), tournois rattachés à un club, multi-organisateurs, calendrier et inscriptions. **Aucune action maintenant.** Règle permanente : ne rien décider en H1-H3 qui suppose qu'un tournoi appartient à jamais à un individu unique (état actuel : conforme).

---

## Hors trajectoire (refusé sauf décision explicite)

Gamification (badges, XP — se nourrira des statistiques, pas l'inverse) · scoring mène par mène · header collant et couleur sous la barre de statut (abandon assumé) · fédérations et licences officielles · applications natives.

## Risques permanents

1. **Dispersion** (développeur solo, vision large) → un horizon actif, un ticket actif.
2. **Construire avant de spécifier** → toute nouvelle capacité passe par une spec avant migration.
3. **Sous-estimer l'ouverture publique** → l'Horizon 3 ne démarre qu'après son propre cadrage.

## Prochaine action

Ticket C (finition), puis **Horizon 2 — session de conception du modèle de données du match libre**.
