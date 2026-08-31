import { describe, expect, it } from 'vitest'
import type { UserFreeMatchResult, UserTournamentResult } from '../../app/types'
import {
  JOURNAL_FILTERS,
  buildUnifiedJournal,
  filterJournal,
  isJournalFilter,
} from '../../app/utils/journal'

// Fixtures : UN SEUL style d'horodatage (+00:00) — recordedAt se compare
// comme du texte, mélanger deux styles fausserait le tri (cf. journal.ts).

function makeResult(overrides: Partial<UserTournamentResult> = {}): UserTournamentResult {
  return {
    tournamentId: 't-1',
    tournamentName: 'Tournoi',
    tournamentDate: '2026-05-10',
    tournamentCompletedAt: '2026-05-10T18:00:00.000+00:00',
    teamId: 'team-1',
    teamName: 'Team',
    wins: 2,
    losses: 1,
    pointsScored: 30,
    pointsConceded: 20,
    finalRank: 1,
    isWinner: true,
    isPodium: true,
    viewerCanOpen: true,
    teammates: [],
    ...overrides,
  }
}

function makeFreeMatch(overrides: Partial<UserFreeMatchResult> = {}): UserFreeMatchResult {
  return {
    matchId: 'm-1',
    playedOn: '2026-05-12',
    createdAt: '2026-05-12T19:00:00.000+00:00',
    scoreA: 13,
    scoreB: 7,
    side: 'A',
    viewerCanOpen: true,
    teammates: [],
    opponents: [],
    ...overrides,
  }
}

describe('buildUnifiedJournal', () => {
  it('mixes both kinds sorted by play day, most recent first', () => {
    const entries = buildUnifiedJournal(
      [makeResult({ tournamentId: 't-old', tournamentDate: '2026-05-01' })],
      [
        makeFreeMatch({ matchId: 'm-new', playedOn: '2026-05-12' }),
        makeFreeMatch({ matchId: 'm-mid', playedOn: '2026-05-05', createdAt: '2026-05-05T10:00:00.000+00:00' }),
      ],
    )
    expect(entries.map(entry => entry.key)).toEqual([
      'free_match:m-new',
      'free_match:m-mid',
      'tournament:t-old',
    ])
  })

  it('breaks a same-day tie between a tournament and a free match on recordedAt desc', () => {
    const entries = buildUnifiedJournal(
      [
        makeResult({
          tournamentId: 't-1',
          tournamentDate: '2026-05-10',
          tournamentCompletedAt: '2026-05-10T20:00:00.000+00:00',
        }),
      ],
      [
        makeFreeMatch({
          matchId: 'm-1',
          playedOn: '2026-05-10',
          createdAt: '2026-05-10T18:00:00.000+00:00',
        }),
      ],
    )
    expect(entries.map(entry => entry.kind)).toEqual(['tournament', 'free_match'])
  })

  it('sorts a tournament played early but completed late at its PLAY date, not its completion', () => {
    const entries = buildUnifiedJournal(
      [
        makeResult({
          tournamentId: 't-early-played',
          tournamentDate: '2026-05-01',
          tournamentCompletedAt: '2026-06-05T10:00:00.000+00:00', // terminé tard
        }),
        makeResult({
          tournamentId: 't-late-played',
          tournamentDate: '2026-06-01',
          tournamentCompletedAt: '2026-06-02T10:00:00.000+00:00',
        }),
      ],
      [],
    )
    expect(entries.map(entry => entry.key)).toEqual([
      'tournament:t-late-played',
      'tournament:t-early-played',
    ])
  })

  it('keeps the RPC order of free matches tying on both keys (stable sort)', () => {
    const sharedDay = { playedOn: '2026-05-10', createdAt: '2026-05-10T12:00:00.000+00:00' }
    const entries = buildUnifiedJournal(
      [],
      [
        makeFreeMatch({ matchId: 'm-first-from-rpc', ...sharedDay }),
        makeFreeMatch({ matchId: 'm-second-from-rpc', ...sharedDay }),
      ],
    )
    expect(entries.map(entry => entry.key)).toEqual([
      'free_match:m-first-from-rpc',
      'free_match:m-second-from-rpc',
    ])
  })

  it('handles empty inputs', () => {
    expect(buildUnifiedJournal([], [])).toEqual([])
    expect(buildUnifiedJournal([makeResult()], []).map(entry => entry.kind)).toEqual(['tournament'])
    expect(buildUnifiedJournal([], [makeFreeMatch()]).map(entry => entry.kind)).toEqual(['free_match'])
  })

  it('gives every entry a kind-prefixed unique key', () => {
    const entries = buildUnifiedJournal([makeResult({ tournamentId: 'same-id' })], [
      makeFreeMatch({ matchId: 'same-id' }),
    ])
    const keys = entries.map(entry => entry.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('does not mutate its inputs', () => {
    const results = [makeResult({ tournamentDate: '2026-01-01' })]
    const freeMatches = [makeFreeMatch({ playedOn: '2026-02-01' })]
    buildUnifiedJournal(results, freeMatches)
    expect(results[0]?.tournamentDate).toBe('2026-01-01')
    expect(freeMatches[0]?.playedOn).toBe('2026-02-01')
  })
})

describe('filterJournal', () => {
  const entries = buildUnifiedJournal(
    [makeResult({ tournamentId: 't-1' })],
    [makeFreeMatch({ matchId: 'm-1' })],
  )

  it('returns everything for "all"', () => {
    expect(filterJournal(entries, 'all')).toEqual(entries)
  })

  it('keeps only tournaments / only free matches', () => {
    expect(filterJournal(entries, 'tournaments').map(entry => entry.kind)).toEqual(['tournament'])
    expect(filterJournal(entries, 'free_matches').map(entry => entry.kind)).toEqual(['free_match'])
  })

  it('can produce an empty result (the page shows a readable message)', () => {
    const onlyTournaments = buildUnifiedJournal([makeResult()], [])
    expect(filterJournal(onlyTournaments, 'free_matches')).toEqual([])
  })
})

describe('isJournalFilter', () => {
  it('accepts exactly the three filter values', () => {
    for (const filter of JOURNAL_FILTERS) {
      expect(isJournalFilter(filter)).toBe(true)
    }
    expect(isJournalFilter('everything')).toBe(false)
    expect(isJournalFilter(3)).toBe(false)
    expect(isJournalFilter(null)).toBe(false)
  })
})
