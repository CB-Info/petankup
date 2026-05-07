import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import type { Match, Team, Tournament } from '../types'
import type { TournamentRepository } from './TournamentRepository'
import {
  mapMatchDomainToInsert,
  mapMatchRowToDomain,
  mapTeamDomainToInsert,
  mapTeamRowToDomain,
  mapTournamentDomainToInsert,
  mapTournamentRowToDomain,
} from './supabase-mappers'

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
}
