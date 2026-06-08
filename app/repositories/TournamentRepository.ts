import type { Match, Profile, Team, Tournament, TournamentMember } from '../types'

// Contrat de persistance pour le domaine pétanque. Toutes les méthodes
// sont asynchrones — l'implémentation actuelle (SupabaseRepository) fait
// des requêtes réseau, le contrat reste agnostique du backend pour
// faciliter d'éventuelles alternatives (mock, cache local, etc.).
//
// Membres : les insertions passent par la RPC inviteMemberByDisplayName (la
// DB y normalise le pseudo et applique les règles owner / self / doublon).
// Le repository reste pass-through : aucune normalisation côté client.
// Le repository est agnostique d'identité — getMyMemberships reçoit le
// userId résolu par le store (cf. currentUserId), il ne le découvre pas
// lui-même.
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

  getMembersByTournament(tournamentId: string): Promise<TournamentMember[]>
  getMyMemberships(userId: string): Promise<TournamentMember[]>
  inviteMemberByDisplayName(tournamentId: string, displayName: string): Promise<TournamentMember>
  removeMember(memberId: string): Promise<void>

  // Profils utilisateurs. La table est peuplée par le trigger DB
  // au signup (cf. C.1), le repo ne fait ni création ni
  // suppression. getProfileById retourne undefined si non visible
  // via RLS (distingué d'une erreur réseau via .maybeSingle).
  // getProfilesByIds est best-effort : les ids non visibles via
  // RLS sont silencieusement absents du retour.
  getProfileById(id: string): Promise<Profile | undefined>
  getProfilesByIds(ids: string[]): Promise<Profile[]>
  updateMyProfile(userId: string, displayName: string): Promise<Profile>
}
