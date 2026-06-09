import type { Match, Profile, Team, Tournament, TournamentMember, UserProfileBundle } from '../types'

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
//
// Équipes : les écritures (createTeam / updateTeam) passent EXCLUSIVEMENT par
// les RPCs create_team_with_players / update_team_with_players (écriture
// atomique team + team_players, snapshot de pseudo côté DB). getTeamsByTournament
// lit l'embed team_players(*). removeMember passe par la RPC
// remove_tournament_member (gates owner + completed + member_in_team) et peut
// throw InviteMemberError.
export interface TournamentRepository {
  getAllTournaments(): Promise<Tournament[]>
  getTournamentById(id: string): Promise<Tournament | undefined>
  saveTournament(tournament: Tournament): Promise<void>
  deleteTournament(id: string): Promise<void>

  getTeamsByTournament(tournamentId: string): Promise<Team[]>
  createTeam(
    tournamentId: string,
    name: string,
    players: Array<{ userId: string | null, displayName: string }>,
  ): Promise<Team>
  updateTeam(
    teamId: string,
    name: string,
    players: Array<{ userId: string | null, displayName: string }>,
  ): Promise<Team>
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

  // Récupère le bundle complet (profil + stats agrégées + journal de
  // tournois) d'un user. Implémenté via la RPC SQL get_user_profile :
  // la table user_tournament_results n'est jamais lue en direct.
  //
  // La RPC peut throw 'not_authenticated' si la session n'est pas
  // résolue ; remontée en Error standard (pas de classe typée, cf.
  // décision Phase J).
  getUserProfile(userId: string): Promise<UserProfileBundle>
}
