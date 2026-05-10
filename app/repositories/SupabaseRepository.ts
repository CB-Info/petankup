import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import type {
  InviteMemberErrorCode,
  Match,
  Team,
  Tournament,
  TournamentMember,
} from '../types'
import { InviteMemberError } from '../types'
import type { TournamentRepository } from './TournamentRepository'
import {
  mapMatchDomainToInsert,
  mapMatchRowToDomain,
  mapTeamDomainToInsert,
  mapTeamRowToDomain,
  mapTournamentDomainToInsert,
  mapTournamentMemberRowToDomain,
  mapTournamentRowToDomain,
} from './supabase-mappers'

// Codes d'erreur connus levés par la RPC invite_tournament_member_by_email
// (cf. migration B.1). PostgREST surface le `raise exception 'code'`
// comme un message texte ; on reconnaît le code par sous-chaîne. Aucun
// code n'est sous-chaîne d'un autre, donc `includes` est suffisant et
// non ambigu.
const KNOWN_INVITE_ERROR_CODES: readonly InviteMemberErrorCode[] = [
  'invalid_email',
  'not_authenticated',
  'not_owner',
  'user_not_found',
  'self_invite',
  'already_member',
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
      .select('*')
      .eq('tournament_id', tournamentId)
    if (error !== null) throw new Error(error.message)
    return (data ?? []).map(mapTeamRowToDomain)
  }

  async saveTeam(team: Team): Promise<void> {
    const insertPayload = mapTeamDomainToInsert(team)
    const { error } = await this.client.from('teams').upsert(insertPayload)
    if (error !== null) throw new Error(error.message)
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

  // Invitation par email. Pass-through total : pas de normalisation
  // d'email côté client — la RPC fait `lower(trim(p_email))` côté DB.
  // Les erreurs métier (user_not_found, already_member, self_invite,
  // not_owner, invalid_email) sont mappées vers InviteMemberError via
  // parseInviteErrorCode. Tout autre cas (réseau, schéma DB inattendu,
  // data null sans error) tombe dans le code 'unknown'.
  async inviteMemberByEmail(
    tournamentId: string,
    email: string,
  ): Promise<TournamentMember> {
    const { data, error } = await this.client.rpc(
      'invite_tournament_member_by_email',
      { p_tournament_id: tournamentId, p_email: email },
    )
    if (error !== null) {
      throw new InviteMemberError(parseInviteErrorCode(error.message))
    }
    if (data === null) {
      throw new InviteMemberError('unknown')
    }
    return mapTournamentMemberRowToDomain(data)
  }

  async removeMember(memberId: string): Promise<void> {
    const { error } = await this.client
      .from('tournament_members')
      .delete()
      .eq('id', memberId)
    if (error !== null) throw new Error(error.message)
  }
}
