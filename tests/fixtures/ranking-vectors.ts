// ============================================================================
// Fixtures de classement partagées TS ↔ SQL — source de vérité unique.
//
// Pourquoi : le classement est calculé en double — `computeRanking`
// (app/utils/tournament.ts, live) et le bloc `ranked` de
// `private.materialize_tournament_results`
// (supabase/migrations/20260609180000_phase_i_stats_db.sql, qui alimente
// user_tournament_results.final_rank → is_winner / is_podium des profils).
// Un drift silencieux entre les deux fausserait les stats. Ces vecteurs
// FIGENT la frontière : ils prouvent que TS et SQL coïncident partout SAUF
// sur un cas précis, explicitement listé et accepté. C'est un test de
// non-régression de la frontière, PAS un test de convergence.
//
// La frontière (mesurée, pas supposée) :
//   Les deux algos trient sur la même cascade scalaire
//   (wins desc → pointDiff desc → pointsFor desc), identique par
//   construction, puis départagent au head-to-head. La divergence n'apparaît
//   que sur un CYCLE h2h PARFAIT à 3+ équipes scalairement à égalité (chacune
//   bat une et perd contre une, h2h_wins_in_group = 1 partout) dont l'ordre
//   d'entrée diffère de l'ordre team_id :
//     - SQL  : départage final déterministe par team_id.
//     - TS   : `tieBreak` consulte le MATCH DIRECT, qui dans un cycle a
//              toujours un vainqueur → renvoie ±1 (jamais 0). Le comparateur
//              devient NON TRANSITIF, et le résultat de Array.prototype.sort
//              (V8) dépend de l'ordre d'entrée de façon non triviale.
//
//   Conséquence importante : quand TS et SQL coïncident DANS un cycle
//   (vecteurs `perfect-3-cycle-entry-equals-id-order` et
//   `4-team-3way-cycle-top-entry-reversed`), c'est ACCIDENTEL — l'ordre de
//   sortie du sort V8 tombe par hasard sur l'ordre team_id. À ne jamais lire
//   comme une garantie.
//
// ⚠ Synchro manuelle : supabase/tests/ranking_fixtures_check.sql rejoue ces
// mêmes vecteurs côté DB et compare à expectedRanksSQL. Il n'y a PAS de
// génération croisée : si tu modifies un vecteur ici, répercute-le à la main
// dans le script SQL, sinon les deux divergent en silence.
// ============================================================================

// UUID-like triables : l'ordre lexicographique a < b < c < d reproduit le
// départage final par team_id du SQL, et rend la fixture lisible.
export const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const TEAM_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const TEAM_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

export interface RankingFixtureMatch {
  teamA: string;
  teamB: string;
  scoreA: number;
  scoreB: number;
}

// Rang attendu par équipe : { [teamId]: rank }.
export type RankMap = Record<string, number>;

export interface RankingVector {
  name: string;
  // Ordre d'entrée des équipes — SIGNIFIANT : c'est lui qui pilote le tri
  // stable de computeRanking sur les cas non tranchés par les scalaires.
  teamIds: string[];
  // winnerId se déduit du score (scoreA > scoreB), comme en production.
  matches: RankingFixtureMatch[];
  expectedRanksTS: RankMap;
  expectedRanksSQL: RankMap;
  // 'converge' SSI expectedRanksTS et expectedRanksSQL sont égaux. Vérifié
  // par une garde dans ranking-fixtures.test.ts (le verdict ne peut pas mentir).
  verdict: "converge" | "diverge";
}

// Helper de lisibilité : `beats(X, Y)` = X bat Y 13-7. Score arbitraire mais
// valide (≥ 13, pas de nul), identique partout pour neutraliser les scalaires.
function beats(winner: string, loser: string): RankingFixtureMatch {
  return { teamA: winner, teamB: loser, scoreA: 13, scoreB: 7 };
}

export const rankingVectors: RankingVector[] = [
  // Aucune égalité : a > b > c > d sur les victoires. Sanity de base.
  {
    name: "clean-4-team-no-tie",
    teamIds: [TEAM_A, TEAM_B, TEAM_C, TEAM_D],
    matches: [
      beats(TEAM_A, TEAM_B),
      beats(TEAM_A, TEAM_C),
      beats(TEAM_A, TEAM_D),
      beats(TEAM_B, TEAM_C),
      beats(TEAM_B, TEAM_D),
      beats(TEAM_C, TEAM_D),
    ],
    expectedRanksTS: { [TEAM_A]: 1, [TEAM_B]: 2, [TEAM_C]: 3, [TEAM_D]: 4 },
    expectedRanksSQL: { [TEAM_A]: 1, [TEAM_B]: 2, [TEAM_C]: 3, [TEAM_D]: 4 },
    verdict: "converge",
  },

  // Deux paires scalairement à égalité ({a,c} en haut, {b,d} en bas),
  // chacune départagée par le résultat direct (a bat c, b bat d). Le h2h
  // intra-groupe tranche identiquement des deux côtés → converge.
  {
    name: "4-team-two-tied-pairs",
    teamIds: [TEAM_A, TEAM_B, TEAM_C, TEAM_D],
    matches: [
      beats(TEAM_A, TEAM_C),
      beats(TEAM_A, TEAM_B),
      beats(TEAM_D, TEAM_A),
      beats(TEAM_C, TEAM_B),
      beats(TEAM_C, TEAM_D),
      beats(TEAM_B, TEAM_D),
    ],
    expectedRanksTS: { [TEAM_A]: 1, [TEAM_C]: 2, [TEAM_B]: 3, [TEAM_D]: 4 },
    expectedRanksSQL: { [TEAM_A]: 1, [TEAM_C]: 2, [TEAM_B]: 3, [TEAM_D]: 4 },
    verdict: "converge",
  },

  // Cycle parfait a > b > c > a, scalaires égaux. L'ordre d'entrée (a,b,c)
  // coïncide avec l'ordre team_id → les deux donnent 1,2,3. CONVERGENCE
  // ACCIDENTELLE : le sort V8 tombe par hasard sur l'ordre team_id.
  {
    name: "perfect-3-cycle-entry-equals-id-order",
    teamIds: [TEAM_A, TEAM_B, TEAM_C],
    matches: [beats(TEAM_A, TEAM_B), beats(TEAM_B, TEAM_C), beats(TEAM_C, TEAM_A)],
    expectedRanksTS: { [TEAM_A]: 1, [TEAM_B]: 2, [TEAM_C]: 3 },
    expectedRanksSQL: { [TEAM_A]: 1, [TEAM_B]: 2, [TEAM_C]: 3 },
    verdict: "converge",
  },

  // Même cycle, ordre d'entrée c,a,b ≠ ordre team_id. TS conserve l'ordre
  // d'entrée (c,a,b), SQL départage par team_id (a,b,c). DIVERGE.
  {
    name: "perfect-3-cycle-entry-c-a-b",
    teamIds: [TEAM_C, TEAM_A, TEAM_B],
    matches: [beats(TEAM_A, TEAM_B), beats(TEAM_B, TEAM_C), beats(TEAM_C, TEAM_A)],
    expectedRanksTS: { [TEAM_C]: 1, [TEAM_A]: 2, [TEAM_B]: 3 },
    expectedRanksSQL: { [TEAM_A]: 1, [TEAM_B]: 2, [TEAM_C]: 3 },
    verdict: "diverge",
  },

  // Même cycle, ordre d'entrée b,c,a. TS → b,c,a ; SQL → a,b,c. DIVERGE.
  {
    name: "perfect-3-cycle-entry-b-c-a",
    teamIds: [TEAM_B, TEAM_C, TEAM_A],
    matches: [beats(TEAM_A, TEAM_B), beats(TEAM_B, TEAM_C), beats(TEAM_C, TEAM_A)],
    expectedRanksTS: { [TEAM_B]: 1, [TEAM_C]: 2, [TEAM_A]: 3 },
    expectedRanksSQL: { [TEAM_A]: 1, [TEAM_B]: 2, [TEAM_C]: 3 },
    verdict: "diverge",
  },

  // a,b,c en cycle parfait au sommet (chacun bat d), d dernier. Ordre
  // d'entrée inversé (d,c,b,a) — pourtant TS retombe sur a,b,c,d comme SQL.
  // Montre qu'un cycle ne DIVERGE pas toujours : ici le sort V8, avec la 4ᵉ
  // équipe présente, ne conserve PAS l'ordre d'entrée. Convergence accidentelle.
  {
    name: "4-team-3way-cycle-top-entry-reversed",
    teamIds: [TEAM_D, TEAM_C, TEAM_B, TEAM_A],
    matches: [
      beats(TEAM_A, TEAM_B),
      beats(TEAM_B, TEAM_C),
      beats(TEAM_C, TEAM_A),
      beats(TEAM_A, TEAM_D),
      beats(TEAM_B, TEAM_D),
      beats(TEAM_C, TEAM_D),
    ],
    expectedRanksTS: { [TEAM_A]: 1, [TEAM_B]: 2, [TEAM_C]: 3, [TEAM_D]: 4 },
    expectedRanksSQL: { [TEAM_A]: 1, [TEAM_B]: 2, [TEAM_C]: 3, [TEAM_D]: 4 },
    verdict: "converge",
  },
];
