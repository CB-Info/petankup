import { describe, expect, it } from 'vitest'
import type { UserFreeMatchStats, UserStats } from '../../app/types'
import { combineUserStats, statsForSource } from '../../app/utils/user-stats'

const TOURNAMENT_STATS: UserStats = {
  matchesPlayed: 4,
  wins: 3,
  losses: 1,
  pointsScored: 50,
  pointsConceded: 30,
  tournamentsPlayed: 2,
  tournamentsWon: 1,
  podiums: 2,
  lastTournamentAt: '2026-05-10T00:00:00.000+00:00',
}

const FREE_MATCH_STATS: UserFreeMatchStats = {
  matchesPlayed: 3,
  wins: 2,
  losses: 1,
  pointsScored: 31,
  pointsConceded: 29,
}

describe('combineUserStats', () => {
  it('sums the five shared counters of both sources (tournament-only counters excluded)', () => {
    expect(combineUserStats(TOURNAMENT_STATS, FREE_MATCH_STATS)).toEqual({
      matchesPlayed: 7,
      wins: 5,
      losses: 2,
      pointsScored: 81,
      pointsConceded: 59,
    })
  })

  it('equals the single source when the other is null', () => {
    expect(combineUserStats(TOURNAMENT_STATS, null)).toEqual({
      matchesPlayed: 4,
      wins: 3,
      losses: 1,
      pointsScored: 50,
      pointsConceded: 30,
    })
    expect(combineUserStats(null, FREE_MATCH_STATS)).toEqual(FREE_MATCH_STATS)
  })

  it('returns null when neither source exists (empty state, not zeros)', () => {
    expect(combineUserStats(null, null)).toBeNull()
  })
})

describe('statsForSource', () => {
  it('returns the combined total for the default position', () => {
    expect(statsForSource('combined', TOURNAMENT_STATS, FREE_MATCH_STATS)).toEqual(
      combineUserStats(TOURNAMENT_STATS, FREE_MATCH_STATS),
    )
  })

  it('returns each source alone for its position', () => {
    expect(statsForSource('tournaments', TOURNAMENT_STATS, FREE_MATCH_STATS).matchesPlayed).toBe(4)
    expect(statsForSource('free_matches', TOURNAMENT_STATS, FREE_MATCH_STATS).matchesPlayed).toBe(3)
  })

  it('shows truthful zeros for a position whose source is null', () => {
    expect(statsForSource('free_matches', TOURNAMENT_STATS, null)).toEqual({
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      pointsScored: 0,
      pointsConceded: 0,
    })
    expect(statsForSource('combined', null, null).matchesPlayed).toBe(0)
  })
})
