import { describe, expect, it } from 'vitest'
import { computeRanking } from '../../app/utils/tournament'
import type { Match, Team } from '../../app/types'
import {
  rankingVectors,
  type RankingVector,
  type RankMap,
} from '../fixtures/ranking-vectors'

// Ces tests consomment les fixtures partagées TS ↔ SQL (tests/fixtures/
// ranking-vectors.ts) côté TypeScript. Ils figent que computeRanking produit
// EXACTEMENT expectedRanksTS pour chaque vecteur. Le pendant SQL est vérifié
// manuellement via supabase/tests/ranking_fixtures_check.sql (hors CI).
// Voir l'en-tête de la fixture pour la frontière de divergence caractérisée.

const NOW = '2026-01-01T00:00:00.000Z'
const TOURNAMENT_ID = 'fixture-tournament'

function makeTeam(id: string): Team {
  return {
    id,
    tournamentId: TOURNAMENT_ID,
    name: id,
    // Le classement ne dépend pas des joueurs : tableau vide accepté.
    players: [],
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makeCompletedMatch(
  teamAId: string,
  teamBId: string,
  scoreA: number,
  scoreB: number,
  roundNumber: number,
): Match {
  return {
    id: `${teamAId}-${teamBId}-r${roundNumber}`,
    tournamentId: TOURNAMENT_ID,
    teamAId,
    teamBId,
    scoreA,
    scoreB,
    // winnerId déduit du score, comme en production.
    winnerId: scoreA > scoreB ? teamAId : teamBId,
    status: 'completed',
    roundNumber,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

// Rejoue un vecteur dans computeRanking en respectant l'ordre d'entrée des
// équipes (signifiant : il pilote le tri stable), et réduit le résultat en
// { [teamId]: rank }.
function actualTsRanks(vector: RankingVector): RankMap {
  const teams = vector.teamIds.map(makeTeam)
  const matches = vector.matches.map((match, index) =>
    makeCompletedMatch(
      match.teamA,
      match.teamB,
      match.scoreA,
      match.scoreB,
      index + 1,
    ),
  )

  const ranks: RankMap = {}
  for (const ranking of computeRanking(teams, matches)) {
    ranks[ranking.teamId] = ranking.rank
  }
  return ranks
}

function rankMapsEqual(a: RankMap, b: RankMap): boolean {
  const keysA = Object.keys(a).sort()
  const keysB = Object.keys(b).sort()
  if (keysA.length !== keysB.length) return false
  return keysA.every((key, index) => key === keysB[index] && a[key] === b[key])
}

describe('ranking fixtures — TS side (computeRanking)', () => {
  it.each(rankingVectors)(
    'produit expectedRanksTS pour "$name"',
    (vector) => {
      expect(actualTsRanks(vector)).toEqual(vector.expectedRanksTS)
    },
  )
})

describe('ranking fixtures — intégrité des vecteurs', () => {
  // Garde anti-pourrissement : le verdict ne peut pas mentir. converge SSI
  // les deux Record de rangs sont égaux.
  it.each(rankingVectors)(
    'verdict cohérent avec l\'égalité TS/SQL pour "$name"',
    (vector) => {
      const ranksAreEqual = rankMapsEqual(
        vector.expectedRanksTS,
        vector.expectedRanksSQL,
      )
      expect(ranksAreEqual).toBe(vector.verdict === 'converge')
    },
  )

  it('contient au moins un vecteur divergent (la frontière est testée)', () => {
    const hasDivergingVector = rankingVectors.some(
      (vector) => vector.verdict === 'diverge',
    )
    expect(hasDivergingVector).toBe(true)
  })

  it('contient au moins un vecteur convergent impliquant un cycle (convergence accidentelle testée)', () => {
    const hasCycleConvergingVector = rankingVectors.some(
      (vector) => vector.verdict === 'converge' && vector.name.includes('cycle'),
    )
    expect(hasCycleConvergingVector).toBe(true)
  })
})
