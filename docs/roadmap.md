# Pétankup — Roadmap

> **Dernière mise à jour : 2026-08-20.** Source de vérité de la trajectoire produit. Le `cahier_des_charges.md` décrit le produit ; ce document décrit l'ordre dans lequel il se construit.
>
> **Vision** : application de gestion de parties et de tournois de pétanque, destinée au grand public (France puis international). Deux usages : les joueurs aujourd'hui, les clubs et associations à terme. Nouvelle capacité produit spécifiée : le **match libre** (partie hors tournoi).

---

## État actuel

**Livré et vérifié** (265 tests verts, typecheck/build OK) :

- Cycle tournoi complet : création, équipes, matchs, scores, classement live, podium.
- Visibilité public/privé, invitations par pseudo, joueurs libres, RLS durcie.
- Profils joueurs : pseudo unique, **statistiques persistantes et journal de bord** (tables matérialisées, triggers, RPC de profil, chaîne TypeScript complète).
- Redesign « Nuit & Corail », header unifié dans le layout.
- **Gel des tournois terminés** (Horizon 1 / H1.a) : immuabilité garantie côté base, avec deux exceptions (visibilité, suppression) et une réouverture possible vers « en cours ». Les statistiques ne peuvent plus diverger silencieusement des données.

**Dettes ouvertes :**

| Gravité | Dette                                                                                                                 | Statut                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 🟡      | Divergence de classement TS ↔ SQL sur cycle parfait à 3+ équipes                                                      | **Dette assumée**, documentée, fixtures partagées en place. Ne pas « corriger » sans décision produit. |
| 🟡      | Coéquipiers fournis par la base et chargés, mais non affichés dans le journal                                         | Ouvert — H1.d                                                                                          |
| 🟡      | Avatars cliquables uniquement dans la modale invités (pas équipes ni journal)                                         | Ouvert — H1.d                                                                                          |
| ⚪      | Micro-orphelins : `VisibilityBadge.vue`, exports sans consommateur, `app/plugins/` vide, contrainte orpheline en base | Ouvert, basse priorité                                                                                 |
| ⚪      | Réouverture de tournoi : capacité en base sans affordance UI                                                          | **Choix assumé** — à construire si le besoin se présente                                               |

---

## Horizon 1 — Fondations & vérité documentaire

_Objectif : une base dont les données sont inviolables et des documents qui disent la vérité._

- **H1.a — Gel des tournois terminés** ✅ **LIVRÉ** (migration `20260819190000_tournament_freeze`). Prédicat de gel unifié, conçu pour accueillir le second déclencheur (match libre complété) à l'Horizon 2 sans réécriture.
- **H1.b — Spec du match libre** ✅ **LIVRÉ** → `docs/spec_match_individuel.md`. Six décisions actées, hypothèses par défaut à amender librement.
- **H1.c — Révision du cahier des charges + versionnage des docs produit** 🔄 **EN COURS**.
- **H1.d — Petits gains UI** ⏳ _optionnel_ : afficher les coéquipiers dans le journal (donnée déjà chargée, pur affichage) ; avatars cliquables dans les équipes et le journal ; micro-cleanup des orphelins.

**Sortie :** données inviolables, docs véridiques, spec du match libre prête à construire.

## Horizon 2 — Le match libre

_Objectif : on peut jouer sur Pétankup sans organiser un tournoi._

1. **H2.a — Modèle de données**, selon `docs/spec_match_individuel.md`. ⚠️ Contrainte connue : les équipes sont structurellement liées à un tournoi (FK composites) — le match libre aura son propre modèle de participants, calqué sur le pattern `team_players`.
2. **H2.b — Parcours de création rapide** (« on est 4 au terrain, on note »).
3. **H2.c — Extension des statistiques** : seconde source, distinguée de la source tournoi, combinable à l'affichage. Le gel gagne son second déclencheur.
4. **H2.d — Journal enrichi** : matchs libres et tournois sur le profil.

## Horizon 3 — Ouverture grand public

Onboarding pour des utilisateurs qui ne te connaissent pas · confidentialité par défaut re-validée + conformité RGPD · modération minimale · robustesse, quotas et coûts · internationalisation. Peu de schéma, forte exposition — cet horizon aura sa **propre phase de cadrage** avant lancement.

⚠️ À re-trancher ici : les statistiques de matchs libres sont **auto-déclarées** (pas de confirmation de l'adversaire — décision D4 de la spec). Acceptable en cercle restreint, à revoir à l'ouverture publique.

## Horizon 4 — Clubs & associations

Entité organisation (membres, rôles), tournois rattachés à un club, multi-organisateurs, calendrier et inscriptions. **Aucune action maintenant.** Règle permanente : ne rien décider en H1-H3 qui suppose qu'un tournoi appartient à jamais à un individu unique (état actuel : conforme).

---

## Hors trajectoire (refusé sauf décision explicite)

Gamification (badges, XP — se nourrira des statistiques, pas l'inverse) · scoring mène par mène · header collant et couleur sous la barre de statut (abandon assumé) · fédérations et licences officielles · applications natives iOS/Android.

## Risques permanents

1. **Dispersion** (développeur solo, vision large) → un horizon actif, un ticket actif.
2. **Construire avant de spécifier** → toute nouvelle capacité passe par une spec avant migration.
3. **Sous-estimer l'ouverture publique** → l'Horizon 3 ne démarre qu'après son propre cadrage.

## Prochaine action

Terminer **H1.c**, puis choisir : **H1.d** (petits gains rapides) ou attaquer l'**Horizon 2**.
