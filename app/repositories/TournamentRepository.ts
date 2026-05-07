import type { Match, Team, Tournament } from '../types'

// Contrat de persistance pour le domaine pétanque.
// Toutes les méthodes sont asynchrones pour accommoder n'importe quel
// backend : LocalStorageRepository enrobe un stockage navigateur sync,
// une future implémentation Supabase fera de vraies requêtes réseau.
export interface TournamentRepository {
  getAllTournaments(): Promise<Tournament[]>
  getTournamentById(id: string): Promise<Tournament | undefined>
  saveTournament(tournament: Tournament): Promise<void>
  deleteTournament(id: string): Promise<void>

  getTeamsByTournament(tournamentId: string): Promise<Team[]>
  saveTeam(team: Team): Promise<void>
  deleteTeam(id: string): Promise<void>

  getMatchesByTournament(tournamentId: string): Promise<Match[]>
  saveMatch(match: Match): Promise<void>
  saveMatches(matches: Match[]): Promise<void>
}
