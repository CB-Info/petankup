import { describe, expect, it } from 'vitest'
import type { Profile, Team, TeamPlayer, TournamentMember } from '../../app/types'
import { computeAvailablePlayerOptions } from '../../app/utils/team-player-options'

const NOW = '2026-01-01T00:00:00.000Z'
const TOURNAMENT_ID = 'tttttttt-tttt-4ttt-8ttt-tttttttttttt'
const OWNER_ID = '11111111-1111-4111-8111-111111111111'
const BOB_ID = '22222222-2222-4222-8222-222222222222'
const CARLA_ID = '33333333-3333-4333-8333-333333333333'

function makeProfile(id: string, displayName: string): Profile {
  return { id, displayName, createdAt: NOW, updatedAt: NOW }
}

function makeMember(userId: string): TournamentMember {
  return {
    id: `member-${userId}`,
    tournamentId: TOURNAMENT_ID,
    userId,
    memberEmail: `${userId}@example.com`,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makePlayer(userId: string | null, displayName: string): TeamPlayer {
  return {
    id: `player-${userId ?? displayName}`,
    teamId: 'team-x',
    tournamentId: TOURNAMENT_ID,
    userId,
    displayNameSnapshot: displayName,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makeTeam(id: string, name: string, players: TeamPlayer[]): Team {
  return {
    id,
    tournamentId: TOURNAMENT_ID,
    name,
    players,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

describe('computeAvailablePlayerOptions', () => {
  it('returns an empty list when no member exists and the owner is not hydrated', () => {
    const options = computeAvailablePlayerOptions({
      ownerId: OWNER_ID,
      members: [],
      profileById: {},
      teams: [],
      editingTeamId: null,
    })
    expect(options).toEqual([])
  })

  it('places the owner first, then members sorted alphabetically by displayName', () => {
    const options = computeAvailablePlayerOptions({
      ownerId: OWNER_ID,
      members: [makeMember(CARLA_ID), makeMember(BOB_ID)],
      profileById: {
        [OWNER_ID]: makeProfile(OWNER_ID, 'Zoé (owner)'),
        [BOB_ID]: makeProfile(BOB_ID, 'Bob'),
        [CARLA_ID]: makeProfile(CARLA_ID, 'Carla'),
      },
      teams: [],
      editingTeamId: null,
    })
    expect(options.map(option => option.displayName)).toEqual([
      'Zoé (owner)',
      'Bob',
      'Carla',
    ])
    expect(options.every(option => !option.disabled)).toBe(true)
  })

  it('omits a member whose profile is not hydrated', () => {
    const options = computeAvailablePlayerOptions({
      ownerId: OWNER_ID,
      members: [makeMember(BOB_ID), makeMember(CARLA_ID)],
      profileById: {
        [OWNER_ID]: makeProfile(OWNER_ID, 'Owner'),
        [BOB_ID]: makeProfile(BOB_ID, 'Bob'),
        // Carla absente du cache
      },
      teams: [],
      editingTeamId: null,
    })
    expect(options.map(option => option.userId)).toEqual([OWNER_ID, BOB_ID])
  })

  it('marks a member engaged in another team as disabled with the team name', () => {
    const otherTeam = makeTeam('team-1', 'Équipe 1', [makePlayer(BOB_ID, 'Bob')])
    const options = computeAvailablePlayerOptions({
      ownerId: OWNER_ID,
      members: [makeMember(BOB_ID)],
      profileById: {
        [OWNER_ID]: makeProfile(OWNER_ID, 'Owner'),
        [BOB_ID]: makeProfile(BOB_ID, 'Bob'),
      },
      teams: [otherTeam],
      editingTeamId: null,
    })
    const bobOption = options.find(option => option.userId === BOB_ID)
    expect(bobOption).toEqual({
      userId: BOB_ID,
      displayName: 'Bob',
      disabled: true,
      disabledReason: 'dans Équipe 1',
    })
  })

  it('does not disable players of the team currently being edited', () => {
    const editedTeam = makeTeam('team-1', 'Équipe 1', [makePlayer(BOB_ID, 'Bob')])
    const options = computeAvailablePlayerOptions({
      ownerId: OWNER_ID,
      members: [makeMember(BOB_ID)],
      profileById: {
        [OWNER_ID]: makeProfile(OWNER_ID, 'Owner'),
        [BOB_ID]: makeProfile(BOB_ID, 'Bob'),
      },
      teams: [editedTeam],
      editingTeamId: 'team-1',
    })
    const bobOption = options.find(option => option.userId === BOB_ID)
    expect(bobOption?.disabled).toBe(false)
  })

  it('does not duplicate the owner if they also appear in members', () => {
    const options = computeAvailablePlayerOptions({
      ownerId: OWNER_ID,
      members: [makeMember(OWNER_ID), makeMember(BOB_ID)],
      profileById: {
        [OWNER_ID]: makeProfile(OWNER_ID, 'Owner'),
        [BOB_ID]: makeProfile(BOB_ID, 'Bob'),
      },
      teams: [],
      editingTeamId: null,
    })
    expect(options.filter(option => option.userId === OWNER_ID)).toHaveLength(1)
  })
})
