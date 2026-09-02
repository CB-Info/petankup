import type {
  AccountMatch,
  CreateFreeMatchInput,
  FreeMatch,
  FriendshipBundle,
  FriendshipRequestOutcome,
  Profile,
  Team,
  Tournament,
  TournamentMatch,
  TournamentMember,
  UserProfileBundle,
} from '../types'

// Contrat de persistance pour le domaine pétanque. Toutes les méthodes
// sont asynchrones — l'implémentation actuelle (SupabaseRepository) fait
// des requêtes réseau, le contrat reste agnostique du backend pour
// faciliter d'éventuelles alternatives (mock, cache local, etc.).
//
// Convention d'écriture : chaque écriture dit explicitement ce qu'elle fait —
// createXxx (INSERT) ou updateXxx (UPDATE ciblé par id). Pas d'upsert
// fourre-tout : distinguer créer de modifier évite les pièges Postgres (un
// trigger BEFORE UPDATE ne s'applique pas à la phase INSERT spéculative d'un
// upsert). Tournois et matchs suivent ce pattern ; teams et members passent
// par des RPCs dédiées, le profil par un update ciblé — l'ensemble est homogène.
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
  createTournament(tournament: Tournament): Promise<void>
  updateTournament(tournament: Tournament): Promise<void>
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

  getMatchesByTournament(tournamentId: string): Promise<TournamentMatch[]>
  createMatches(matches: TournamentMatch[]): Promise<void>
  updateMatch(match: TournamentMatch): Promise<void>

  getMembersByTournament(tournamentId: string): Promise<TournamentMember[]>
  getMyMemberships(userId: string): Promise<TournamentMember[]>
  inviteMemberByDisplayName(tournamentId: string, displayName: string): Promise<TournamentMember>
  removeMember(memberId: string): Promise<void>

  // Profils utilisateurs. La table est peuplée par le trigger DB
  // au signup (cf. C.1), le repo ne fait ni création ni
  // suppression. Depuis A2, la table est lisible par tout utilisateur
  // authentifié (le pseudo est public ; c'est le CONTENU du profil,
  // stats et journal, qui est protégé en base via get_user_profile).
  // getProfileById retourne undefined si l'id n'existe pas (distingué
  // d'une erreur réseau via .maybeSingle) ; getProfilesByIds est
  // best-effort : les ids inconnus sont silencieusement absents.
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

  // Matchs libres (H2). Lecture avec les joueurs embarqués
  // (free_match_players(*)) ; getFreeMatchById retourne undefined si le
  // match n'est pas visible via RLS (maybeSingle), distingué d'une erreur
  // réseau. L'écriture passe EXCLUSIVEMENT par la RPC create_free_match
  // (match + joueurs atomiques, snapshot des pseudos côté DB, règles typées
  // remontées en FreeMatchError) et retourne l'id créé. deleteFreeMatch :
  // DELETE ciblé ; 0 ligne (non créateur, déjà supprimé) reste silencieux,
  // miroir de deleteTournament. findAccountByDisplayName : RPC d'égalité
  // exacte sur le pseudo, 0 ou 1 compte — undefined si aucun.
  getFreeMatchById(id: string): Promise<FreeMatch | undefined>
  createFreeMatch(input: CreateFreeMatchInput): Promise<string>
  deleteFreeMatch(id: string): Promise<void>
  findAccountByDisplayName(displayName: string): Promise<AccountMatch | undefined>

  // Amitié (A3). Toutes les écritures passent par les RPC A1 (la table
  // friendships est deny-total). requestFriendship prend le PSEUDO (la RPC
  // fait le lookup et lève display_name_not_found) et retourne l'issue :
  // 'pending' (demande envoyée) ou 'accepted' (demandes croisées — l'autre
  // avait déjà demandé, vous êtes amis immédiatement). Les autres actions
  // ciblent l'user_id de l'autre personne, fourni par les listes.
  // Erreurs métier remontées en FriendshipError typée ; removeFriendship
  // est idempotente côté base (cible absente = no-op silencieux).
  // getFriendships retourne les trois listes déjà triées par la RPC.
  getFriendships(): Promise<FriendshipBundle>
  requestFriendship(displayName: string): Promise<FriendshipRequestOutcome>
  acceptFriendship(userId: string): Promise<void>
  refuseFriendship(userId: string): Promise<void>
  cancelFriendshipRequest(userId: string): Promise<void>
  removeFriendship(userId: string): Promise<void>
}
