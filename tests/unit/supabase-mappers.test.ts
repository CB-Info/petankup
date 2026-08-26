import { describe, expect, it } from 'vitest'
import type { Database } from '../../app/types/database.types'
import type { Match, Profile, Team, TeamPlayer, Teammate, Tournament, TournamentMember, UserProfileBundle } from '../../app/types'
import {
  mapMatchDomainToInsert,
  mapMatchDomainToUpdate,
  mapMatchRowToDomain,
  mapProfileRowToDomain,
  mapTeamPlayerRowToDomain,
  mapTeamRowToDomain,
  mapTournamentDomainToInsert,
  mapTournamentDomainToUpdate,
  mapTournamentMemberRowToDomain,
  mapTournamentRowToDomain,
  mapUserProfileBundleJsonToDomain,
  type RawUserProfileBundleJson,
} from '../../app/repositories/supabase-mappers'

type TournamentRow = Database['public']['Tables']['tournaments']['Row']
type TeamRow = Database['public']['Tables']['teams']['Row']
type TeamPlayerRow = Database['public']['Tables']['team_players']['Row']
type TeamRowWithPlayers = TeamRow & { team_players: TeamPlayerRow[] }
type MatchRow = Database['public']['Tables']['matches']['Row']
type TournamentMemberRow
  = Database['public']['Tables']['tournament_members']['Row']
type ProfileRow = Database['public']['Tables']['profiles']['Row']

const NOW = '2026-01-01T00:00:00.000Z'
const OWNER_ID = '11111111-1111-4111-8111-111111111111'
const TOURNAMENT_ID = '22222222-2222-4222-8222-222222222222'
const TEAM_A_ID = '33333333-3333-4333-8333-333333333333'
const TEAM_B_ID = '44444444-4444-4444-8444-444444444444'
const MATCH_ID = '55555555-5555-4555-8555-555555555555'
const MEMBER_ID = '66666666-6666-4666-8666-666666666666'
const INVITEE_USER_ID = '77777777-7777-4777-8777-777777777777'

describe('mapTournamentRowToDomain', () => {
  it('translates a complete row to a Tournament with snake_case → camelCase', () => {
    const row: TournamentRow = {
      id: TOURNAMENT_ID,
      name: 'Tournoi du dimanche',
      date: '2026-05-10',
      location: 'Parc Bordelais',
      description: 'Tournoi entre amis',
      format: 'round_robin',
      status: 'in_progress',
      visibility: 'private',
      owner_id: OWNER_ID,
      created_at: NOW,
      updated_at: NOW,
    }

    expect(mapTournamentRowToDomain(row)).toEqual<Tournament>({
      id: TOURNAMENT_ID,
      name: 'Tournoi du dimanche',
      date: '2026-05-10',
      location: 'Parc Bordelais',
      description: 'Tournoi entre amis',
      format: 'round_robin',
      status: 'in_progress',
      visibility: 'private',
      ownerId: OWNER_ID,
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('converts null location and description to undefined', () => {
    const row: TournamentRow = {
      id: TOURNAMENT_ID,
      name: 'Tournoi minimal',
      date: '2026-05-10',
      location: null,
      description: null,
      format: 'round_robin',
      status: 'draft',
      visibility: 'private',
      owner_id: OWNER_ID,
      created_at: NOW,
      updated_at: NOW,
    }

    const tournament = mapTournamentRowToDomain(row)
    expect(tournament.location).toBeUndefined()
    expect(tournament.description).toBeUndefined()
  })

  it('preserves the visibility field (public)', () => {
    const row: TournamentRow = {
      id: TOURNAMENT_ID,
      name: 'Tournoi public',
      date: '2026-05-10',
      location: null,
      description: null,
      format: 'round_robin',
      status: 'draft',
      visibility: 'public',
      owner_id: OWNER_ID,
      created_at: NOW,
      updated_at: NOW,
    }

    expect(mapTournamentRowToDomain(row).visibility).toBe('public')
  })
})

describe('mapTournamentDomainToInsert', () => {
  it('translates a domain Tournament to an Insert payload (camelCase → snake_case)', () => {
    const tournament: Tournament = {
      id: TOURNAMENT_ID,
      name: 'Tournoi du dimanche',
      date: '2026-05-10',
      location: 'Parc Bordelais',
      description: 'Tournoi entre amis',
      format: 'round_robin',
      status: 'in_progress',
      visibility: 'private',
      ownerId: OWNER_ID,
      createdAt: NOW,
      updatedAt: NOW,
    }

    const insert = mapTournamentDomainToInsert(tournament)
    expect(insert).toEqual({
      id: TOURNAMENT_ID,
      name: 'Tournoi du dimanche',
      date: '2026-05-10',
      location: 'Parc Bordelais',
      description: 'Tournoi entre amis',
      format: 'round_robin',
      status: 'in_progress',
      visibility: 'private',
      owner_id: OWNER_ID,
    })
    // Les timestamps sont gérées par la DB (defaults + trigger).
    expect(insert).not.toHaveProperty('created_at')
    expect(insert).not.toHaveProperty('updated_at')
  })

  it('converts undefined location and description to null', () => {
    const tournament: Tournament = {
      id: TOURNAMENT_ID,
      name: 'Tournoi minimal',
      date: '2026-05-10',
      format: 'round_robin',
      status: 'draft',
      visibility: 'private',
      ownerId: OWNER_ID,
      createdAt: NOW,
      updatedAt: NOW,
    }

    const insert = mapTournamentDomainToInsert(tournament)
    expect(insert.location).toBeNull()
    expect(insert.description).toBeNull()
  })

  it('passes through the visibility field (public)', () => {
    const tournament: Tournament = {
      id: TOURNAMENT_ID,
      name: 'Tournoi public',
      date: '2026-05-10',
      format: 'round_robin',
      status: 'draft',
      visibility: 'public',
      ownerId: OWNER_ID,
      createdAt: NOW,
      updatedAt: NOW,
    }

    expect(mapTournamentDomainToInsert(tournament).visibility).toBe('public')
  })
})

const PLAYER_FREE_ID = '88888888-8888-4888-8888-888888888888'
const PLAYER_LINKED_ID = '99999999-9999-4999-8999-999999999999'

function makeTeamPlayerRow(overrides: Partial<TeamPlayerRow> = {}): TeamPlayerRow {
  return {
    id: PLAYER_FREE_ID,
    team_id: TEAM_A_ID,
    tournament_id: TOURNAMENT_ID,
    user_id: null,
    display_name: 'Alice',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

describe('mapTeamPlayerRowToDomain', () => {
  it('translates a free player row (user_id null)', () => {
    expect(mapTeamPlayerRowToDomain(makeTeamPlayerRow())).toEqual<TeamPlayer>({
      id: PLAYER_FREE_ID,
      teamId: TEAM_A_ID,
      tournamentId: TOURNAMENT_ID,
      userId: null,
      displayNameSnapshot: 'Alice',
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('translates a linked player row (user_id set)', () => {
    const row = makeTeamPlayerRow({
      id: PLAYER_LINKED_ID,
      user_id: INVITEE_USER_ID,
      display_name: 'Bob',
    })
    expect(mapTeamPlayerRowToDomain(row)).toEqual<TeamPlayer>({
      id: PLAYER_LINKED_ID,
      teamId: TEAM_A_ID,
      tournamentId: TOURNAMENT_ID,
      userId: INVITEE_USER_ID,
      displayNameSnapshot: 'Bob',
      createdAt: NOW,
      updatedAt: NOW,
    })
  })
})

describe('mapTeamRowToDomain', () => {
  it('translates a complete row with embedded team_players to a Team', () => {
    const row: TeamRowWithPlayers = {
      id: TEAM_A_ID,
      tournament_id: TOURNAMENT_ID,
      name: 'Les Boulistes',
      created_at: NOW,
      updated_at: NOW,
      team_players: [
        makeTeamPlayerRow(),
        makeTeamPlayerRow({
          id: PLAYER_LINKED_ID,
          user_id: INVITEE_USER_ID,
          display_name: 'Bob',
        }),
      ],
    }

    expect(mapTeamRowToDomain(row)).toEqual<Team>({
      id: TEAM_A_ID,
      tournamentId: TOURNAMENT_ID,
      name: 'Les Boulistes',
      players: [
        {
          id: PLAYER_FREE_ID,
          teamId: TEAM_A_ID,
          tournamentId: TOURNAMENT_ID,
          userId: null,
          displayNameSnapshot: 'Alice',
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: PLAYER_LINKED_ID,
          teamId: TEAM_A_ID,
          tournamentId: TOURNAMENT_ID,
          userId: INVITEE_USER_ID,
          displayNameSnapshot: 'Bob',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('maps an empty team_players embed to an empty players array', () => {
    const row: TeamRowWithPlayers = {
      id: TEAM_A_ID,
      tournament_id: TOURNAMENT_ID,
      name: 'Équipe vide',
      created_at: NOW,
      updated_at: NOW,
      team_players: [],
    }
    expect(mapTeamRowToDomain(row).players).toEqual([])
  })
})

describe('mapMatchRowToDomain', () => {
  it('translates a completed match row to a Match', () => {
    const row: MatchRow = {
      id: MATCH_ID,
      tournament_id: TOURNAMENT_ID,
      team_a_id: TEAM_A_ID,
      team_b_id: TEAM_B_ID,
      score_a: 13,
      score_b: 7,
      winner_id: TEAM_A_ID,
      status: 'completed',
      round_number: 2,
      created_at: NOW,
      updated_at: NOW,
    }

    expect(mapMatchRowToDomain(row)).toEqual<Match>({
      id: MATCH_ID,
      tournamentId: TOURNAMENT_ID,
      teamAId: TEAM_A_ID,
      teamBId: TEAM_B_ID,
      scoreA: 13,
      scoreB: 7,
      winnerId: TEAM_A_ID,
      status: 'completed',
      roundNumber: 2,
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('preserves null for pending match scores and winner', () => {
    const row: MatchRow = {
      id: MATCH_ID,
      tournament_id: TOURNAMENT_ID,
      team_a_id: TEAM_A_ID,
      team_b_id: TEAM_B_ID,
      score_a: null,
      score_b: null,
      winner_id: null,
      status: 'pending',
      round_number: 1,
      created_at: NOW,
      updated_at: NOW,
    }

    const match = mapMatchRowToDomain(row)
    expect(match.scoreA).toBeNull()
    expect(match.scoreB).toBeNull()
    expect(match.winnerId).toBeNull()
    expect(match.status).toBe('pending')
  })
})

describe('mapMatchDomainToInsert', () => {
  it('translates a domain Match to an Insert payload (roundNumber → round_number)', () => {
    const match: Match = {
      id: MATCH_ID,
      tournamentId: TOURNAMENT_ID,
      teamAId: TEAM_A_ID,
      teamBId: TEAM_B_ID,
      scoreA: 13,
      scoreB: 7,
      winnerId: TEAM_A_ID,
      status: 'completed',
      roundNumber: 2,
      createdAt: NOW,
      updatedAt: NOW,
    }

    const insert = mapMatchDomainToInsert(match)
    expect(insert).toEqual({
      id: MATCH_ID,
      tournament_id: TOURNAMENT_ID,
      team_a_id: TEAM_A_ID,
      team_b_id: TEAM_B_ID,
      score_a: 13,
      score_b: 7,
      winner_id: TEAM_A_ID,
      status: 'completed',
      round_number: 2,
    })
    expect(insert).not.toHaveProperty('created_at')
    expect(insert).not.toHaveProperty('updated_at')
  })

  it('preserves null for pending match scores and winner', () => {
    const match: Match = {
      id: MATCH_ID,
      tournamentId: TOURNAMENT_ID,
      teamAId: TEAM_A_ID,
      teamBId: TEAM_B_ID,
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'pending',
      roundNumber: 1,
      createdAt: NOW,
      updatedAt: NOW,
    }

    const insert = mapMatchDomainToInsert(match)
    expect(insert.score_a).toBeNull()
    expect(insert.score_b).toBeNull()
    expect(insert.winner_id).toBeNull()
  })
})

describe('mapTournamentMemberRowToDomain', () => {
  it('translates a complete row to a TournamentMember (snake_case → camelCase)', () => {
    const row: TournamentMemberRow = {
      id: MEMBER_ID,
      tournament_id: TOURNAMENT_ID,
      user_id: INVITEE_USER_ID,
      member_email: 'guest@example.com',
      created_at: NOW,
      updated_at: NOW,
    }

    expect(mapTournamentMemberRowToDomain(row)).toEqual<TournamentMember>({
      id: MEMBER_ID,
      tournamentId: TOURNAMENT_ID,
      userId: INVITEE_USER_ID,
      memberEmail: 'guest@example.com',
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('preserves the snapshot member_email field as-is', () => {
    // Le snapshot d'email est conservé pour permettre au modal "Gérer
    // les invités" d'afficher l'email original sans appel auth.users —
    // pas de transformation côté mapper.
    const row: TournamentMemberRow = {
      id: MEMBER_ID,
      tournament_id: TOURNAMENT_ID,
      user_id: INVITEE_USER_ID,
      member_email: 'Mixed.Case+tag@Example.COM',
      created_at: NOW,
      updated_at: NOW,
    }

    expect(mapTournamentMemberRowToDomain(row).memberEmail).toBe(
      'Mixed.Case+tag@Example.COM',
    )
  })
})

describe('mapProfileRowToDomain', () => {
  it('translates a complete row to a Profile with snake_case → camelCase', () => {
    const row: ProfileRow = {
      id: OWNER_ID,
      display_name: 'Alice',
      created_at: NOW,
      updated_at: NOW,
    }

    expect(mapProfileRowToDomain(row)).toEqual<Profile>({
      id: OWNER_ID,
      displayName: 'Alice',
      createdAt: NOW,
      updatedAt: NOW,
    })
  })
})

describe('mapUserProfileBundleJsonToDomain', () => {
  function makeRawBundle(
    overrides: Partial<RawUserProfileBundleJson> = {},
  ): RawUserProfileBundleJson {
    return {
      profile: {
        id: OWNER_ID,
        display_name: 'Alice',
        created_at: NOW,
        updated_at: NOW,
      },
      stats: {
        matches_played: 4,
        wins: 3,
        losses: 1,
        points_scored: 50,
        points_conceded: 30,
        tournaments_played: 2,
        tournaments_won: 1,
        podiums: 2,
        last_tournament_at: NOW,
      },
      results: [
        {
          tournament_id: TOURNAMENT_ID,
          tournament_name: 'Tournoi du dimanche',
          tournament_date: '2026-05-10',
          tournament_completed_at: NOW,
          team_id: TEAM_A_ID,
          team_name: 'Les Fanny',
          wins: 2,
          losses: 1,
          points_scored: 30,
          points_conceded: 20,
          final_rank: 1,
          is_winner: true,
          is_podium: true,
          viewer_can_open: true,
          teammates: [{ user_id: INVITEE_USER_ID, display_name: 'Bob' }],
        },
      ],
      ...overrides,
    }
  }

  it('translates a complete bundle snake_case → camelCase', () => {
    expect(
      mapUserProfileBundleJsonToDomain(makeRawBundle()),
    ).toEqual<UserProfileBundle>({
      profile: {
        id: OWNER_ID,
        displayName: 'Alice',
        createdAt: NOW,
        updatedAt: NOW,
      },
      stats: {
        matchesPlayed: 4,
        wins: 3,
        losses: 1,
        pointsScored: 50,
        pointsConceded: 30,
        tournamentsPlayed: 2,
        tournamentsWon: 1,
        podiums: 2,
        lastTournamentAt: NOW,
      },
      results: [
        {
          tournamentId: TOURNAMENT_ID,
          tournamentName: 'Tournoi du dimanche',
          tournamentDate: '2026-05-10',
          tournamentCompletedAt: NOW,
          teamId: TEAM_A_ID,
          teamName: 'Les Fanny',
          wins: 2,
          losses: 1,
          pointsScored: 30,
          pointsConceded: 20,
          finalRank: 1,
          isWinner: true,
          isPodium: true,
          viewerCanOpen: true,
          teammates: [{ userId: INVITEE_USER_ID, displayName: 'Bob' }],
        },
      ],
    })
  })

  it('defaults viewerCanOpen to false when the RPC omits viewer_can_open (deploy skew)', () => {
    const raw = makeRawBundle()
    delete raw.results[0]?.viewer_can_open

    const bundle = mapUserProfileBundleJsonToDomain(raw)

    expect(bundle.results[0]?.viewerCanOpen).toBe(false)
  })

  it('preserves the order of results (no sorting in the mapper)', () => {
    const raw = makeRawBundle({
      results: [
        {
          tournament_id: TOURNAMENT_ID,
          tournament_name: 'Récent',
          tournament_date: '2026-05-10',
          tournament_completed_at: '2026-05-10T00:00:00.000Z',
          team_id: TEAM_A_ID,
          team_name: 'A',
          wins: 1,
          losses: 0,
          points_scored: 13,
          points_conceded: 5,
          final_rank: 1,
          is_winner: true,
          is_podium: true,
          teammates: [],
        },
        {
          tournament_id: TOURNAMENT_ID,
          tournament_name: 'Ancien',
          tournament_date: '2026-01-01',
          tournament_completed_at: '2026-01-01T00:00:00.000Z',
          team_id: TEAM_B_ID,
          team_name: 'B',
          wins: 0,
          losses: 1,
          points_scored: 5,
          points_conceded: 13,
          final_rank: 2,
          is_winner: false,
          is_podium: true,
          teammates: [],
        },
      ],
    })

    expect(
      mapUserProfileBundleJsonToDomain(raw).results.map(
        result => result.tournamentName,
      ),
    ).toEqual(['Récent', 'Ancien'])
  })

  it('maps a null profile to null', () => {
    expect(
      mapUserProfileBundleJsonToDomain(makeRawBundle({ profile: null })).profile,
    ).toBeNull()
  })

  it('maps null stats to null', () => {
    expect(
      mapUserProfileBundleJsonToDomain(makeRawBundle({ stats: null })).stats,
    ).toBeNull()
  })

  it('maps empty results to []', () => {
    expect(
      mapUserProfileBundleJsonToDomain(makeRawBundle({ results: [] })).results,
    ).toEqual([])
  })

  it('keeps a free teammate (user_id null) as userId null with its snapshot name', () => {
    const raw = makeRawBundle({
      results: [
        {
          tournament_id: TOURNAMENT_ID,
          tournament_name: 'Tournoi',
          tournament_date: '2026-05-10',
          tournament_completed_at: NOW,
          team_id: TEAM_A_ID,
          team_name: 'Team',
          wins: 1,
          losses: 0,
          points_scored: 13,
          points_conceded: 7,
          final_rank: 1,
          is_winner: true,
          is_podium: true,
          teammates: [{ user_id: null, display_name: 'Pierre' }],
        },
      ],
    })

    expect(
      mapUserProfileBundleJsonToDomain(raw).results[0]!.teammates,
    ).toEqual<Teammate[]>([{ userId: null, displayName: 'Pierre' }])
  })

  it('maps a null last_tournament_at to null', () => {
    const raw = makeRawBundle({
      stats: {
        matches_played: 0,
        wins: 0,
        losses: 0,
        points_scored: 0,
        points_conceded: 0,
        tournaments_played: 0,
        tournaments_won: 0,
        podiums: 0,
        last_tournament_at: null,
      },
    })

    expect(
      mapUserProfileBundleJsonToDomain(raw).stats?.lastTournamentAt,
    ).toBeNull()
  })
})

describe('mapTournamentDomainToUpdate', () => {
  const tournament: Tournament = {
    id: TOURNAMENT_ID,
    name: 'Tournoi',
    date: '2026-05-10',
    location: 'Parc Bordelais',
    description: 'Tournoi entre amis',
    format: 'round_robin',
    status: 'in_progress',
    visibility: 'public',
    ownerId: OWNER_ID,
    createdAt: NOW,
    updatedAt: NOW,
  }

  it('emits only the mutable columns', () => {
    expect(mapTournamentDomainToUpdate(tournament)).toEqual({
      name: 'Tournoi',
      date: '2026-05-10',
      location: 'Parc Bordelais',
      description: 'Tournoi entre amis',
      status: 'in_progress',
      visibility: 'public',
    })
  })

  it('omits id, immutable and DB-managed columns', () => {
    const update = mapTournamentDomainToUpdate(tournament)
    expect(update).not.toHaveProperty('id')
    expect(update).not.toHaveProperty('owner_id')
    expect(update).not.toHaveProperty('format')
    expect(update).not.toHaveProperty('created_at')
    expect(update).not.toHaveProperty('updated_at')
    expect(update).not.toHaveProperty('completed_at')
  })

  it('maps absent location/description to null', () => {
    const update = mapTournamentDomainToUpdate({
      ...tournament,
      location: undefined,
      description: undefined,
    })
    expect(update.location).toBeNull()
    expect(update.description).toBeNull()
  })
})

describe('mapMatchDomainToUpdate', () => {
  const match: Match = {
    id: MATCH_ID,
    tournamentId: TOURNAMENT_ID,
    teamAId: TEAM_A_ID,
    teamBId: TEAM_B_ID,
    scoreA: 13,
    scoreB: 7,
    winnerId: TEAM_A_ID,
    status: 'completed',
    roundNumber: 1,
    createdAt: NOW,
    updatedAt: NOW,
  }

  it('emits only the score/outcome columns', () => {
    expect(mapMatchDomainToUpdate(match)).toEqual({
      score_a: 13,
      score_b: 7,
      winner_id: TEAM_A_ID,
      status: 'completed',
    })
  })

  it('omits id, structural and DB-managed columns', () => {
    const update = mapMatchDomainToUpdate(match)
    expect(update).not.toHaveProperty('id')
    expect(update).not.toHaveProperty('tournament_id')
    expect(update).not.toHaveProperty('team_a_id')
    expect(update).not.toHaveProperty('team_b_id')
    expect(update).not.toHaveProperty('round_number')
    expect(update).not.toHaveProperty('created_at')
    expect(update).not.toHaveProperty('updated_at')
  })
})
