import { describe, expect, it } from 'vitest'
import type { Profile, TeamPlayer } from '../../app/types'
import { getPlayerDisplayName } from '../../app/utils/team-player-display'

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
