import { describe, expect, it } from 'vitest'
import type { Profile, Teammate, TeamPlayer } from '../../app/types'
import {
  formatOpponentsLine,
  formatTeammatesLine,
  getPlayerDisplayName,
  getTeammateDisplayName,
} from '../../app/utils/team-player-display'

const NOW = '2026-01-01T00:00:00.000Z'
const USER_ID = '11111111-1111-4111-8111-111111111111'

function makePlayer(overrides: Partial<TeamPlayer> = {}): TeamPlayer {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    teamId: '33333333-3333-4333-8333-333333333333',
    tournamentId: '44444444-4444-4444-8444-444444444444',
    userId: null,
    displayNameSnapshot: 'Snapshot',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeProfile(displayName: string): Profile {
  return { id: USER_ID, displayName, createdAt: NOW, updatedAt: NOW }
}

describe('getPlayerDisplayName', () => {
  it('returns the live profile displayName for a linked player whose profile is hydrated', () => {
    const player = makePlayer({ userId: USER_ID, displayNameSnapshot: 'Old' })
    const profileById = { [USER_ID]: makeProfile('Alice') }
    expect(getPlayerDisplayName(player, profileById)).toBe('Alice')
  })

  it('falls back to the snapshot for a linked player whose profile is absent from the cache', () => {
    const player = makePlayer({ userId: USER_ID, displayNameSnapshot: 'Snapshot' })
    expect(getPlayerDisplayName(player, {})).toBe('Snapshot')
  })

  it('returns the snapshot for a free player (userId null)', () => {
    const player = makePlayer({ userId: null, displayNameSnapshot: 'Pierre' })
    const profileById = { [USER_ID]: makeProfile('Alice') }
    expect(getPlayerDisplayName(player, profileById)).toBe('Pierre')
  })

  it('prefers the live pseudo over a stale snapshot when they differ', () => {
    const player = makePlayer({ userId: USER_ID, displayNameSnapshot: 'StaleName' })
    const profileById = { [USER_ID]: makeProfile('FreshName') }
    expect(getPlayerDisplayName(player, profileById)).toBe('FreshName')
  })
})

describe('getTeammateDisplayName', () => {
  function makeTeammate(overrides: Partial<Teammate> = {}): Teammate {
    return { userId: null, displayName: 'Snapshot', ...overrides }
  }

  it('returns the live profile displayName for a linked teammate whose profile is hydrated', () => {
    const teammate = makeTeammate({ userId: USER_ID, displayName: 'Old' })
    const profileById = { [USER_ID]: makeProfile('Alice') }
    expect(getTeammateDisplayName(teammate, profileById)).toBe('Alice')
  })

  it('falls back to the snapshot for a linked teammate whose profile is absent from the cache', () => {
    const teammate = makeTeammate({ userId: USER_ID, displayName: 'Snapshot' })
    expect(getTeammateDisplayName(teammate, {})).toBe('Snapshot')
  })

  it('returns the snapshot for a free teammate (userId null)', () => {
    const teammate = makeTeammate({ userId: null, displayName: 'Pierre' })
    const profileById = { [USER_ID]: makeProfile('Alice') }
    expect(getTeammateDisplayName(teammate, profileById)).toBe('Pierre')
  })

  it('prefers the live pseudo over a stale snapshot when they differ', () => {
    const teammate = makeTeammate({ userId: USER_ID, displayName: 'StaleName' })
    const profileById = { [USER_ID]: makeProfile('FreshName') }
    expect(getTeammateDisplayName(teammate, profileById)).toBe('FreshName')
  })
})

describe('formatTeammatesLine', () => {
  it('returns null when there is no teammate (tête-à-tête)', () => {
    expect(formatTeammatesLine([])).toBeNull()
  })

  it('formats a single teammate', () => {
    expect(formatTeammatesLine(['Marc'])).toBe('avec Marc')
  })

  it('joins two teammates with « et »', () => {
    expect(formatTeammatesLine(['Marc', 'Julie'])).toBe('avec Marc et Julie')
  })

  it('joins three or more teammates with commas and a final « et »', () => {
    expect(formatTeammatesLine(['Marc', 'Julie', 'Paul'])).toBe(
      'avec Marc, Julie et Paul',
    )
  })
})

describe('formatOpponentsLine', () => {
  it('returns null when the opponents are unknown (non-openable entry)', () => {
    expect(formatOpponentsLine([])).toBeNull()
  })

  it('formats a single opponent', () => {
    expect(formatOpponentsLine(['Marc'])).toBe('contre Marc')
  })

  it('joins several opponents with « et »', () => {
    expect(formatOpponentsLine(['Marc', 'Julie'])).toBe('contre Marc et Julie')
  })
})
