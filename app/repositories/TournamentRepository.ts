import type { Match, Team, Tournament } from '../types'

// Contrat de persistance pour le domaine pétanque.
// Toutes les méthodes sont synchrones en V1 (stockage local navigateur).
// Une éventuelle implémentation V2 (Supabase) introduira une variante
// asynchrone — pas d'anticipation prématurée ici.
export interface TournamentRepository {
  getAllTournaments(): Tournament[]
  getTournamentById(id: string): Tournament | undefined
  saveTournament(tournament: Tournament): void
  deleteTournament(id: string): void

  getTeamsByTournament(tournamentId: string): Team[]
  saveTeam(team: Team): void
  deleteTeam(id: string): void

  getMatchesByTournament(tournamentId: string): Match[]
  saveMatch(match: Match): void
  saveMatches(matches: Match[]): void
}
