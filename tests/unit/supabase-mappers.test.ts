import { describe, expect, it } from 'vitest'
import type { Database } from '../../app/types/database.types'
import type { Match, Profile, Team, Tournament, TournamentMember } from '../../app/types'
import {
  mapMatchDomainToInsert,
  mapMatchRowToDomain,
  mapProfileRowToDomain,
  mapTeamDomainToInsert,
  mapTeamRowToDomain,
  mapTournamentDomainToInsert,
  mapTournamentMemberRowToDomain,
  mapTournamentRowToDomain,
} from '../../app/repositories/supabase-mappers'

type TournamentRow = Database['public']['Tables']['tournaments']['Row']
type TeamRow = Database['public']['Tables']['teams']['Row']
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

describe('mapTeamRowToDomain', () => {
  it('translates a complete row to a Team', () => {
    const row: TeamRow = {
      id: TEAM_A_ID,
      tournament_id: TOURNAMENT_ID,
      name: 'Les Boulistes',
      players: ['Alice', 'Bob'],
      created_at: NOW,
      updated_at: NOW,
    }

    expect(mapTeamRowToDomain(row)).toEqual<Team>({
      id: TEAM_A_ID,
      tournamentId: TOURNAMENT_ID,
      name: 'Les Boulistes',
      players: ['Alice', 'Bob'],
      createdAt: NOW,
      updatedAt: NOW,
    })
  })
})

describe('mapTeamDomainToInsert', () => {
  it('translates a domain Team to an Insert payload', () => {
    const team: Team = {
      id: TEAM_A_ID,
      tournamentId: TOURNAMENT_ID,
      name: 'Les Boulistes',
      players: ['Alice', 'Bob'],
      createdAt: NOW,
      updatedAt: NOW,
    }

    const insert = mapTeamDomainToInsert(team)
    expect(insert).toEqual({
      id: TEAM_A_ID,
      tournament_id: TOURNAMENT_ID,
      name: 'Les Boulistes',
      players: ['Alice', 'Bob'],
    })
    expect(insert).not.toHaveProperty('created_at')
    expect(insert).not.toHaveProperty('updated_at')
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
