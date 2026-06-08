import type { Database } from '../types/database.types'
import type { Match, Profile, Team, Tournament, TournamentMember } from '../types'

// Traductions pures entre les rows Supabase (snake_case, nullables stricts)
// et les types domaine (camelCase, optionnels via `?`). Aucune logique
// métier ici : si une transformation devient conditionnelle, elle a sa
// place dans le repository ou le store, pas ici.

type TournamentRow = Database['public']['Tables']['tournaments']['Row']
type TournamentInsert = Database['public']['Tables']['tournaments']['Insert']
type TeamRow = Database['public']['Tables']['teams']['Row']
type TeamInsert = Database['public']['Tables']['teams']['Insert']
type MatchRow = Database['public']['Tables']['matches']['Row']
type MatchInsert = Database['public']['Tables']['matches']['Insert']
type TournamentMemberRow = Database['public']['Tables']['tournament_members']['Row']
type ProfileRow = Database['public']['Tables']['profiles']['Row']

// --- Tournament ---

export function mapTournamentRowToDomain(row: TournamentRow): Tournament {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    location: row.location ?? undefined,
    description: row.description ?? undefined,
    format: row.format,
    status: row.status,
    visibility: row.visibility,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapTournamentDomainToInsert(
  tournament: Tournament,
): TournamentInsert {
  return {
    id: tournament.id,
    name: tournament.name,
    date: tournament.date,
    location: tournament.location ?? null,
    description: tournament.description ?? null,
    format: tournament.format,
    status: tournament.status,
    visibility: tournament.visibility,
    owner_id: tournament.ownerId,
  }
}

// --- Team ---

export function mapTeamRowToDomain(row: TeamRow): Team {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    players: row.players,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapTeamDomainToInsert(team: Team): TeamInsert {
  return {
    id: team.id,
    tournament_id: team.tournamentId,
    name: team.name,
    players: team.players,
  }
}

// --- Match ---

export function mapMatchRowToDomain(row: MatchRow): Match {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    teamAId: row.team_a_id,
    teamBId: row.team_b_id,
    scoreA: row.score_a,
    scoreB: row.score_b,
    winnerId: row.winner_id,
    status: row.status,
    roundNumber: row.round_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapMatchDomainToInsert(match: Match): MatchInsert {
  return {
    id: match.id,
    tournament_id: match.tournamentId,
    team_a_id: match.teamAId,
    team_b_id: match.teamBId,
    score_a: match.scoreA,
    score_b: match.scoreB,
    winner_id: match.winnerId,
    status: match.status,
    round_number: match.roundNumber,
  }
}

// --- TournamentMember ---
// Pas de mapper Domain → Insert : les insertions passent exclusivement
// par la RPC invite_tournament_member_by_display_name (cf. SupabaseRepository).

export function mapTournamentMemberRowToDomain(
  row: TournamentMemberRow,
): TournamentMember {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    userId: row.user_id,
    memberEmail: row.member_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// --- Profile ---
// Pas de mapper Domain → Insert : les profils sont créés
// automatiquement par le trigger `handle_new_user_profile` à la
// création du compte (cf. migration C.1). Les updates côté app
// n'écrivent que `display_name`, passé en littéral dans le repo.

export function mapProfileRowToDomain(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
