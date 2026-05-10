import { describe, expect, it } from 'vitest'
import {
  computeRanking,
  generateRoundRobinMatches,
  tieBreak,
  validateScore,
} from '../../app/utils/tournament'
import type { Match, Ranking, Team } from '../../app/types'

const NOW = '2026-01-01T00:00:00.000Z'

function makeTeam(id: string, tournamentId = 't1'): Team {
  return {
    id,
    tournamentId,
    name: id,
    players: [id],
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makeCompletedMatch(
  teamAId: string,
  teamBId: string,
  scoreA: number,
  scoreB: number,
  roundNumber = 1,
  tournamentId = 't1',
): Match {
  return {
    id: crypto.randomUUID(),
    tournamentId,
    teamAId,
    teamBId,
    scoreA,
    scoreB,
    winnerId: scoreA > scoreB ? teamAId : teamBId,
    status: 'completed',
    roundNumber,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makeRanking(overrides: Partial<Ranking> = {}): Ranking {
  return {
    teamId: 'x',
    tournamentId: 't1',
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDifference: 0,
    rank: 0,
    ...overrides,
  }
}

describe('generateRoundRobinMatches', () => {
  it('returns no matches for 0 teams', () => {
    expect(generateRoundRobinMatches([], 't1', NOW)).toEqual([])
  })

  it('returns no matches for 1 team', () => {
    expect(generateRoundRobinMatches([makeTeam('a')], 't1', NOW)).toEqual([])
  })

  it('generates 1 match for 2 teams', () => {
    const matches = generateRoundRobinMatches(
      [makeTeam('a'), makeTeam('b')],
      't1',
      NOW,
    )
    expect(matches).toHaveLength(1)
    const ids = [matches[0]!.teamAId, matches[0]!.teamBId].sort()
    expect(ids).toEqual(['a', 'b'])
  })

  it('generates 3 matches for 3 teams (odd: bye excluded)', () => {
    const teams = ['a', 'b', 'c'].map(id => makeTeam(id))
    const matches = generateRoundRobinMatches(teams, 't1', NOW)
    expect(matches).toHaveLength(3)
    for (const id of ['a', 'b', 'c']) {
      const count = matches.filter(m => m.teamAId === id || m.teamBId === id).length
      expect(count).toBe(2)
    }
  })

  it('generates 6 matches for 4 teams, each team plays 3 others exactly once', () => {
    const teams = ['a', 'b', 'c', 'd'].map(id => makeTeam(id))
    const matches = generateRoundRobinMatches(teams, 't1', NOW)
    expect(matches).toHaveLength(6)
    for (const id of ['a', 'b', 'c', 'd']) {
      const count = matches.filter(m => m.teamAId === id || m.teamBId === id).length
      expect(count).toBe(3)
    }
    const pairs = new Set(
      matches.map(m => [m.teamAId, m.teamBId].sort().join('-')),
    )
    expect(pairs.size).toBe(6)
  })

  it('generates 10 matches for 5 teams (odd), each team plays 4', () => {
    const teams = ['a', 'b', 'c', 'd', 'e'].map(id => makeTeam(id))
    const matches = generateRoundRobinMatches(teams, 't1', NOW)
    expect(matches).toHaveLength(10)
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      const count = matches.filter(m => m.teamAId === id || m.teamBId === id).length
      expect(count).toBe(4)
    }
  })

  it('marks all generated matches as pending with null scores', () => {
    const teams = ['a', 'b', 'c', 'd'].map(id => makeTeam(id))
    const matches = generateRoundRobinMatches(teams, 't42', NOW)
    for (const m of matches) {
      expect(m.status).toBe('pending')
      expect(m.scoreA).toBeNull()
      expect(m.scoreB).toBeNull()
      expect(m.winnerId).toBeNull()
      expect(m.tournamentId).toBe('t42')
      expect(m.createdAt).toBe(NOW)
      expect(m.updatedAt).toBe(NOW)
      expect(m.roundNumber).toBeGreaterThanOrEqual(1)
    }
  })

  it('never returns a match referencing the internal bye marker', () => {
    const teams = ['a', 'b', 'c', 'd', 'e'].map(id => makeTeam(id))
    const matches = generateRoundRobinMatches(teams, 't1', NOW)
    for (const m of matches) {
      expect(m.teamAId).not.toBe('__bye__')
      expect(m.teamBId).not.toBe('__bye__')
    }
  })
})

describe('computeRanking', () => {
  it('returns empty array for 0 teams', () => {
    expect(computeRanking([], [])).toEqual([])
  })

  it('assigns ranks 1..N even with no completed matches', () => {
    const teams = ['a', 'b', 'c', 'd'].map(id => makeTeam(id))
    const result = computeRanking(teams, [])
    expect(result).toHaveLength(4)
    expect(result.map(r => r.rank).sort()).toEqual([1, 2, 3, 4])
    for (const r of result) {
      expect(r.wins).toBe(0)
      expect(r.losses).toBe(0)
      expect(r.pointsFor).toBe(0)
      expect(r.pointsAgainst).toBe(0)
      expect(r.pointDifference).toBe(0)
      expect(r.tournamentId).toBe('t1')
    }
  })

  it('ranks the team with 3 wins first in a 4-team round-robin', () => {
    const teams = ['a', 'b', 'c', 'd'].map(id => makeTeam(id))
    const matches = [
      makeCompletedMatch('a', 'b', 13, 7),
      makeCompletedMatch('a', 'c', 13, 5),
      makeCompletedMatch('a', 'd', 13, 9),
      makeCompletedMatch('b', 'c', 13, 10),
      makeCompletedMatch('b', 'd', 13, 8),
      makeCompletedMatch('c', 'd', 13, 12),
    ]
    const result = computeRanking(teams, matches)
    const byId = Object.fromEntries(result.map(r => [r.teamId, r]))
    expect(byId.a!.rank).toBe(1)
    expect(byId.a!.wins).toBe(3)
    expect(byId.b!.rank).toBe(2)
    expect(byId.b!.wins).toBe(2)
    expect(byId.c!.rank).toBe(3)
    expect(byId.c!.wins).toBe(1)
    expect(byId.d!.rank).toBe(4)
    expect(byId.d!.wins).toBe(0)
  })

  it('breaks ties on equal wins by point difference', () => {
    const teams = ['a', 'b', 'c'].map(id => makeTeam(id))
    const matches = [
      makeCompletedMatch('a', 'b', 13, 0),
      makeCompletedMatch('b', 'c', 13, 5),
      makeCompletedMatch('c', 'a', 13, 12),
    ]
    const result = computeRanking(teams, matches)
    const byId = Object.fromEntries(result.map(r => [r.teamId, r]))
    expect(byId.a!.wins).toBe(1)
    expect(byId.b!.wins).toBe(1)
    expect(byId.c!.wins).toBe(1)
    expect(byId.a!.pointDifference).toBe(12)
    expect(byId.b!.pointDifference).toBe(-5)
    expect(byId.c!.pointDifference).toBe(-7)
    expect(byId.a!.rank).toBe(1)
    expect(byId.b!.rank).toBe(2)
    expect(byId.c!.rank).toBe(3)
  })

  it('ignores pending matches', () => {
    const teams = ['a', 'b'].map(id => makeTeam(id))
    const pending: Match = {
      id: 'm1',
      tournamentId: 't1',
      teamAId: 'a',
      teamBId: 'b',
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      roundNumber: 1,
      createdAt: NOW,
      updatedAt: NOW,
    }
    const result = computeRanking(teams, [pending])
    for (const r of result) {
      expect(r.wins).toBe(0)
      expect(r.losses).toBe(0)
      expect(r.pointsFor).toBe(0)
    }
  })

  it('counts pointsFor/pointsAgainst symmetrically across teamA and teamB sides', () => {
    const teams = ['a', 'b'].map(id => makeTeam(id))
    const matches = [makeCompletedMatch('a', 'b', 13, 7)]
    const result = computeRanking(teams, matches)
    const byId = Object.fromEntries(result.map(r => [r.teamId, r]))
    expect(byId.a!.pointsFor).toBe(13)
    expect(byId.a!.pointsAgainst).toBe(7)
    expect(byId.b!.pointsFor).toBe(7)
    expect(byId.b!.pointsAgainst).toBe(13)
  })
})

describe('tieBreak', () => {
  it('orders by wins desc first', () => {
    const a = makeRanking({ teamId: 'a', wins: 2 })
    const b = makeRanking({ teamId: 'b', wins: 1 })
    expect(tieBreak(a, b, [])).toBeLessThan(0)
    expect(tieBreak(b, a, [])).toBeGreaterThan(0)
  })

  it('orders by point difference when wins are equal', () => {
    const a = makeRanking({ teamId: 'a', wins: 1, pointDifference: 5 })
    const b = makeRanking({ teamId: 'b', wins: 1, pointDifference: 2 })
    expect(tieBreak(a, b, [])).toBeLessThan(0)
  })

  it('orders by points scored when wins and diff are equal', () => {
    const a = makeRanking({ teamId: 'a', wins: 1, pointsFor: 20 })
    const b = makeRanking({ teamId: 'b', wins: 1, pointsFor: 15 })
    expect(tieBreak(a, b, [])).toBeLessThan(0)
  })

  it('uses direct match winner when wins, diff, and points are all equal', () => {
    const a = makeRanking({ teamId: 'a', wins: 1, pointsFor: 20 })
    const b = makeRanking({ teamId: 'b', wins: 1, pointsFor: 20 })
    const direct = makeCompletedMatch('a', 'b', 13, 7)
    expect(tieBreak(a, b, [direct])).toBeLessThan(0)
    expect(tieBreak(b, a, [direct])).toBeGreaterThan(0)
  })

  it('finds the direct match regardless of teamA/teamB ordering', () => {
    const a = makeRanking({ teamId: 'a', wins: 1, pointsFor: 20 })
    const b = makeRanking({ teamId: 'b', wins: 1, pointsFor: 20 })
    const direct = makeCompletedMatch('b', 'a', 7, 13)
    expect(tieBreak(a, b, [direct])).toBeLessThan(0)
  })

  it('returns 0 when all criteria match and no direct match exists', () => {
    const a = makeRanking({ teamId: 'a', wins: 1, pointsFor: 20 })
    const b = makeRanking({ teamId: 'b', wins: 1, pointsFor: 20 })
    expect(tieBreak(a, b, [])).toBe(0)
  })

  it('ignores pending direct matches', () => {
    const a = makeRanking({ teamId: 'a', wins: 1, pointsFor: 20 })
    const b = makeRanking({ teamId: 'b', wins: 1, pointsFor: 20 })
    const pending: Match = {
      id: 'm1',
      tournamentId: 't1',
      teamAId: 'a',
      teamBId: 'b',
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      roundNumber: 1,
      createdAt: NOW,
      updatedAt: NOW,
    }
    expect(tieBreak(a, b, [pending])).toBe(0)
  })
})

describe('validateScore', () => {
  it.each([
    [13, 7],
    [15, 12],
    [13, 0],
    [13, 12],
    [7, 13],
  ])('accepts %d-%d', (a, b) => {
    expect(validateScore(a, b)).toEqual({ valid: true })
  })

  it('rejects 12-11 (no team reached 13)', () => {
    const r = validateScore(12, 11)
    expect(r.valid).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('rejects 13-13 (no draws in pétanque)', () => {
    const r = validateScore(13, 13)
    expect(r.valid).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('rejects negative scores -1 vs 5', () => {
    const r = validateScore(-1, 5)
    expect(r.valid).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('rejects non-integer scores 5.5 vs 3', () => {
    const r = validateScore(5.5, 3)
    expect(r.valid).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('rejects 0-0 (no team reached 13)', () => {
    const r = validateScore(0, 0)
    expect(r.valid).toBe(false)
    expect(r.error).toBeTruthy()
  })
})
