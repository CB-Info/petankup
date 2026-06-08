import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import type {
  InviteMemberErrorCode,
  Match,
  Profile,
  Team,
  Tournament,
  TournamentMember,
} from '../types'
import { InviteMemberError, ProfileError } from '../types'
import type { TournamentRepository } from './TournamentRepository'
import {
  mapMatchDomainToInsert,
  mapMatchRowToDomain,
  mapProfileRowToDomain,
  mapTeamRowToDomain,
  mapTournamentDomainToInsert,
  mapTournamentMemberRowToDomain,
  mapTournamentRowToDomain,
} from './supabase-mappers'

// Codes d'erreur connus levés par la RPC invite_tournament_member_by_display_name
// (cf. migration Phase E). PostgREST surface le `raise exception 'code'`
// comme un message texte ; on reconnaît le code par sous-chaîne. Aucun
// code n'est sous-chaîne d'un autre, donc `includes` est suffisant et
// non ambigu.
const KNOWN_INVITE_ERROR_CODES: readonly InviteMemberErrorCode[] = [
  'not_authenticated',
  'not_owner',
  'display_name_not_found',
  'self_invite',
  'already_member',
  'tournament_completed',
  'member_in_team',
]

function parseInviteErrorCode(rawMessage: string): InviteMemberErrorCode {
  const matched = KNOWN_INVITE_ERROR_CODES.find(code => rawMessage.includes(code))
  return matched ?? 'unknown'
}

// Implémentation Supabase du contrat TournamentRepository.
// Les cascades de suppression sont gérées par la DB via ON DELETE CASCADE
// (voir migration initiale) — le repo se contente de DELETE l'entité ciblée.
// Sur erreur Supabase, on throw une Error nue ; le store gère le toggle
// isLoading et propage l'erreur au site d'appel UI qui affiche un toast
// (voir composables/useErrorToast.ts).
export class SupabaseRepository implements TournamentRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  // --- Tournaments ---

  async getAllTournaments(): Promise<Tournament[]> {
    const { data, error } = await this.client.from('tournaments').select('*')
    if (error !== null) throw new Error(error.message)
    return (data ?? []).map(mapTournamentRowToDomain)
  }

  async getTournamentById(id: string): Promise<Tournament | undefined> {
    const { data, error } = await this.client
      .from('tournaments')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error !== null) throw new Error(error.message)
    return data === null ? undefined : mapTournamentRowToDomain(data)
  }

  async saveTournament(tournament: Tournament): Promise<void> {
    const insertPayload = mapTournamentDomainToInsert(tournament)
    const { error } = await this.client
      .from('tournaments')
      .upsert(insertPayload)
    if (error !== null) throw new Error(error.message)
  }

  async deleteTournament(id: string): Promise<void> {
    const { error } = await this.client
      .from('tournaments')
      .delete()
      .eq('id', id)
    if (error !== null) throw new Error(error.message)
  }

  // --- Teams ---

  async getTeamsByTournament(tournamentId: string): Promise<Team[]> {
    const { data, error } = await this.client
      .from('teams')
      .select('*, team_players(*)')
      .eq('tournament_id', tournamentId)
    if (error !== null) throw new Error(error.message)
    return (data ?? []).map(mapTeamRowToDomain)
  }

  // Reconstitue un Team complet (avec ses joueurs) après une RPC qui ne
  // retourne que l'id. Deux round-trips assumés (write RPC puis read embed).
  private async getTeamByIdWithPlayers(teamId: string): Promise<Team> {
    const { data, error } = await this.client
      .from('teams')
      .select('*, team_players(*)')
      .eq('id', teamId)
      .single()
    if (error !== null) throw new Error(error.message)
    return mapTeamRowToDomain(data)
  }

  // Écriture atomique team + joueurs via RPC. Le payload mappe le contrat
  // domaine { userId, displayName } vers le jsonb attendu par la RPC
  // { user_id, display_name }.
  async createTeam(
    tournamentId: string,
    name: string,
    players: Array<{ userId: string | null, displayName: string }>,
  ): Promise<Team> {
    const playersPayload = players.map(player => ({
      user_id: player.userId,
      display_name: player.displayName,
    }))
    const { data: createdTeamId, error } = await this.client.rpc(
      'create_team_with_players',
      { p_tournament_id: tournamentId, p_name: name, p_players: playersPayload },
    )
    if (error !== null) throw new Error(error.message)
    if (createdTeamId === null) {
      throw new Error('create_team_with_players returned null')
    }
    return this.getTeamByIdWithPlayers(createdTeamId)
  }

  async updateTeam(
    teamId: string,
    name: string,
    players: Array<{ userId: string | null, displayName: string }>,
  ): Promise<Team> {
    const playersPayload = players.map(player => ({
      user_id: player.userId,
      display_name: player.displayName,
    }))
    const { data: updatedTeamId, error } = await this.client.rpc(
      'update_team_with_players',
      { p_team_id: teamId, p_name: name, p_players: playersPayload },
    )
    if (error !== null) throw new Error(error.message)
    if (updatedTeamId === null) {
      throw new Error('update_team_with_players returned null')
    }
    return this.getTeamByIdWithPlayers(updatedTeamId)
  }

  async deleteTeam(id: string): Promise<void> {
    const { error } = await this.client.from('teams').delete().eq('id', id)
    if (error !== null) throw new Error(error.message)
  }

  // --- Matches ---

  async getMatchesByTournament(tournamentId: string): Promise<Match[]> {
    const { data, error } = await this.client
      .from('matches')
      .select('*')
      .eq('tournament_id', tournamentId)
    if (error !== null) throw new Error(error.message)
    return (data ?? []).map(mapMatchRowToDomain)
  }

  async saveMatch(match: Match): Promise<void> {
    const insertPayload = mapMatchDomainToInsert(match)
    const { error } = await this.client.from('matches').upsert(insertPayload)
    if (error !== null) throw new Error(error.message)
  }

  async saveMatches(matches: Match[]): Promise<void> {
    const insertPayloads = matches.map(mapMatchDomainToInsert)
    const { error } = await this.client.from('matches').upsert(insertPayloads)
    if (error !== null) throw new Error(error.message)
  }

  // --- Tournament members ---

  async getMembersByTournament(tournamentId: string): Promise<TournamentMember[]> {
    const { data, error } = await this.client
      .from('tournament_members')
      .select('*')
      .eq('tournament_id', tournamentId)
    if (error !== null) throw new Error(error.message)
    return (data ?? []).map(mapTournamentMemberRowToDomain)
  }

  async getMyMemberships(userId: string): Promise<TournamentMember[]> {
    const { data, error } = await this.client
      .from('tournament_members')
      .select('*')
      .eq('user_id', userId)
    if (error !== null) throw new Error(error.message)
    return (data ?? []).map(mapTournamentMemberRowToDomain)
  }

  // Invitation par pseudo. Pass-through total : pas de normalisation côté
  // client — la RPC fait `lower(trim(p_display_name))` côté DB. Les erreurs
  // métier (display_name_not_found, already_member, self_invite, not_owner)
  // sont mappées vers InviteMemberError via parseInviteErrorCode. Tout autre
  // cas (réseau, schéma DB inattendu, data null sans error) tombe dans le
  // code 'unknown'.
  async inviteMemberByDisplayName(
    tournamentId: string,
    displayName: string,
  ): Promise<TournamentMember> {
    const { data, error } = await this.client.rpc(
      'invite_tournament_member_by_display_name',
      { p_tournament_id: tournamentId, p_display_name: displayName },
    )
    if (error !== null) {
      throw new InviteMemberError(parseInviteErrorCode(error.message))
    }
    if (data === null) {
      throw new InviteMemberError('unknown')
    }
    return mapTournamentMemberRowToDomain(data)
  }

  // Retrait d'un membre via la RPC remove_tournament_member (le DELETE direct
  // n'est plus autorisé depuis G.1 — policy retirée). Gates côté DB : owner,
  // tournoi non terminé, et member_in_team. Les codes métier remontent en
  // InviteMemberError (même mécanique que inviteMemberByDisplayName).
  async removeMember(memberId: string): Promise<void> {
    const { error } = await this.client.rpc('remove_tournament_member', {
      p_member_id: memberId,
    })
    if (error !== null) {
      throw new InviteMemberError(parseInviteErrorCode(error.message))
    }
  }

  // --- Profiles ---
  // La table profiles est peuplée par le trigger DB au signup (cf.
  // migration C.1). Le repo ne fait ni insert ni delete : seulement
  // SELECT (un et batch) et UPDATE de display_name pour soi.
  // RLS C.1 garantit que la visibilité est scopée par co-tournoi
  // avec granularité fine, et que l'UPDATE n'autorise que self.

  async getProfileById(id: string): Promise<Profile | undefined> {
    const { data, error } = await this.client
      .from('profiles')
      .select('id, display_name, created_at, updated_at')
      .eq('id', id)
      .maybeSingle()
    if (error !== null) throw new Error(error.message)
    return data === null ? undefined : mapProfileRowToDomain(data)
  }

  async getProfilesByIds(ids: string[]): Promise<Profile[]> {
    if (ids.length === 0) return []
    const uniqueIds = [...new Set(ids)]
    const { data, error } = await this.client
      .from('profiles')
      .select('id, display_name, created_at, updated_at')
      .in('id', uniqueIds)
    if (error !== null) throw new Error(error.message)
    return (data ?? []).map(mapProfileRowToDomain)
  }

  async updateMyProfile(userId: string, displayName: string): Promise<Profile> {
    const { data, error } = await this.client
      .from('profiles')
      .update({ display_name: displayName })
      .eq('id', userId)
      .select('id, display_name, created_at, updated_at')
      .single()
    if (error !== null) {
      // 23505 = unique_violation Postgres. On vérifie en plus le nom de
      // l'index pour ne pas confondre avec un futur autre unique sur
      // profiles (cf. index unique posé en D.1).
      const isDisplayNameConflict
        = error.code === '23505'
          && typeof error.message === 'string'
          && error.message.includes('profiles_display_name_lower_idx')
      if (isDisplayNameConflict) throw new ProfileError('display_name_taken')
      throw new Error(error.message)
    }
    return mapProfileRowToDomain(data)
  }
}
