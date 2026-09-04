import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import type {
  AccountMatch,
  CreateFreeMatchInput,
  FreeMatch,
  FriendshipBundle,
  FriendshipRequestOutcome,
  InviteMemberErrorCode,
  MyProfile,
  Profile,
  ProfileViewpoint,
  ProfileVisibility,
  Team,
  Tournament,
  TournamentMatch,
  TournamentMember,
  UserProfileBundle,
} from '../types'
import { FreeMatchError, FriendshipError, InviteMemberError, ProfileError } from '../types'
import { parseFreeMatchErrorCode } from '../utils/free-match-errors'
import { parseFriendshipErrorCode } from '../utils/friendship-errors'
import type { TournamentRepository } from './TournamentRepository'
import {
  mapAccountMatchRowToDomain,
  mapCreateFreeMatchInputToRpcPayload,
  mapFreeMatchRowToDomain,
  mapMatchDomainToInsert,
  mapMatchDomainToUpdate,
  mapMatchRowToDomain,
  mapMyProfileRowToDomain,
  mapProfileRowToDomain,
  mapTeamRowToDomain,
  mapTournamentDomainToInsert,
  mapTournamentDomainToUpdate,
  mapTournamentMemberRowToDomain,
  mapTournamentRowToDomain,
  mapFriendshipsJsonToDomain,
  mapUserProfileBundleJsonToDomain,
  type RawFriendshipsJson,
  type RawUserProfileBundleJson,
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

// Mappe le shape domaine de l'argument createTeam/updateTeam vers le payload
// jsonb attendu par les RPCs create_team_with_players /
// update_team_with_players (snake_case côté DB). Helper local : aucun usage
// hors de ce fichier, pas exporté.
function mapPlayersToRpcPayload(
  players: Array<{ userId: string | null, displayName: string }>,
): Array<{ user_id: string | null, display_name: string }> {
  return players.map(player => ({
    user_id: player.userId,
    display_name: player.displayName,
  }))
}

// Implémentation Supabase du contrat TournamentRepository.
// Les cascades de suppression sont gérées par la DB via ON DELETE CASCADE
// (voir migration initiale) — le repo se contente de DELETE l'entité ciblée.
//
// Gestion d'erreur, trois cas selon le contexte :
//   - Par défaut : Error standard portant le message Supabase, propagée au
//     site d'appel UI qui affiche un toast (cf. composables/useErrorToast).
//   - inviteMemberByDisplayName / removeMember : InviteMemberError typée
//     avec code discriminant, mappée depuis les raise exception SQL via
//     parseInviteErrorCode. Le composant dispatch via instanceof + switch.
//   - updateMyProfile : ProfileError('display_name_taken') sur conflit 23505
//     vérifié par code Postgres ET nom de l'index unique ; Error standard
//     pour les autres erreurs (réseau, RLS, etc.).
//   - createFreeMatch : FreeMatchError typée, mappée depuis les raise
//     exception SQL par parseFreeMatchErrorCode (égalité stricte du message,
//     cf. utils/free-match-errors). La page dispatch via instanceof + code.
// Le store gère le toggle isLoading dans tous les cas.
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

  async createTournament(tournament: Tournament): Promise<void> {
    const { error } = await this.client
      .from('tournaments')
      .insert(mapTournamentDomainToInsert(tournament))
    if (error !== null) throw new Error(error.message)
  }

  async updateTournament(tournament: Tournament): Promise<void> {
    const { error } = await this.client
      .from('tournaments')
      .update(mapTournamentDomainToUpdate(tournament))
      .eq('id', tournament.id)
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
    const playersPayload = mapPlayersToRpcPayload(players)
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
    const playersPayload = mapPlayersToRpcPayload(players)
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

  async getMatchesByTournament(tournamentId: string): Promise<TournamentMatch[]> {
    const { data, error } = await this.client
      .from('tournament_matches')
      .select('*')
      .eq('tournament_id', tournamentId)
    if (error !== null) throw new Error(error.message)
    return (data ?? []).map(mapMatchRowToDomain)
  }

  async createMatches(matches: TournamentMatch[]): Promise<void> {
    const { error } = await this.client
      .from('tournament_matches')
      .insert(matches.map(mapMatchDomainToInsert))
    if (error !== null) throw new Error(error.message)
  }

  async updateMatch(match: TournamentMatch): Promise<void> {
    const { error } = await this.client
      .from('tournament_matches')
      .update(mapMatchDomainToUpdate(match))
      .eq('id', match.id)
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
  // migration C.1). Le repo ne fait ni insert ni delete : SELECT batch,
  // et pour soi la RPC get_my_profile (lecture) et deux UPDATE
  // (display_name, visibility).
  // Depuis A2 (20260902100000), la table est lisible par tout
  // authentifié (colonnes id/display_name/created_at/updated_at — le
  // réglage visibility n'est PAS lisible en direct, ni en select ni en
  // RETURNING : seule get_my_profile le rend, à son propriétaire) : le
  // pseudo est public, c'est le CONTENU du profil qui est protégé en
  // base, dans get_user_profile. L'UPDATE n'autorise toujours que self.

  async getMyProfile(): Promise<MyProfile | undefined> {
    const { data, error } = await this.client.rpc('get_my_profile')
    if (error !== null) throw new Error(error.message)
    // `returns table` : un tableau d'au plus une ligne — la sienne, résolue
    // sur auth.uid(). Vide = pas de ligne profiles (cas dégénéré).
    const myRow = data?.[0]
    return myRow === undefined ? undefined : mapMyProfileRowToDomain(myRow)
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

  // Pas de .select() : RETURNING lirait la colonne visibility, masquée
  // (grant SELECT par colonne) — 42501. Le compte de lignes, lui, ne lit
  // rien : c'est le seul signal de succès disponible, et il en faut un —
  // sans lui, un UPDATE filtré par la RLS à 0 ligne (identité décalée,
  // ligne absente) passerait pour un succès et l'écran confirmerait un
  // réglage que la base n'a pas.
  async updateMyProfileVisibility(userId: string, visibility: ProfileVisibility): Promise<void> {
    const { error, count } = await this.client
      .from('profiles')
      .update({ visibility }, { count: 'exact' })
      .eq('id', userId)
    if (error !== null) throw new Error(error.message)
    if (count !== 1) {
      throw new Error(`profile visibility update matched ${count ?? 'no'} row`)
    }
  }

  async getUserProfile(userId: string, viewpoint: ProfileViewpoint): Promise<UserProfileBundle> {
    // Le booléen est toujours envoyé explicitement (jamais omis) : le
    // point de vue fait partie du contrat de l'appel.
    const { data, error } = await this.client.rpc('get_user_profile', {
      p_user_id: userId,
      p_as_stranger: viewpoint === 'stranger',
    })
    if (error !== null) throw new Error(error.message)
    if (data === null) {
      throw new Error('get_user_profile returned null')
    }
    // Le retour de la RPC est typé Json (cf. database.types.ts). On le cast
    // vers la forme brute attendue par le mapper avant traduction. Pas de
    // classe d'erreur typée (cf. décision Phase J) : 'not_authenticated'
    // et 'not_owner' remontent tels quels dans le message de l'Error
    // standard.
    return mapUserProfileBundleJsonToDomain(data as RawUserProfileBundleJson)
  }

  // --- Free matches ---

  async getFreeMatchById(id: string): Promise<FreeMatch | undefined> {
    const { data, error } = await this.client
      .from('free_matches')
      .select('*, free_match_players(*)')
      .eq('id', id)
      .maybeSingle()
    if (error !== null) throw new Error(error.message)
    if (data === null) return undefined
    return mapFreeMatchRowToDomain(data)
  }

  async createFreeMatch(input: CreateFreeMatchInput): Promise<string> {
    const payload = mapCreateFreeMatchInputToRpcPayload(input)
    // Cast ciblé : le type généré déclare p_played_on: string alors que la
    // RPC accepte NULL (« aujourd'hui » en date de Paris) — le générateur ne
    // connaît pas la nullabilité des arguments de fonction. La vraie forme
    // est celle de CreateFreeMatchRpcPayload.
    const { data, error } = await this.client.rpc(
      'create_free_match',
      payload as Database['public']['Functions']['create_free_match']['Args'],
    )
    if (error !== null) {
      throw new FreeMatchError(parseFreeMatchErrorCode(error.message))
    }
    if (typeof data !== 'string') throw new FreeMatchError('unknown')
    return data
  }

  async deleteFreeMatch(id: string): Promise<void> {
    const { error } = await this.client
      .from('free_matches')
      .delete()
      .eq('id', id)
    if (error !== null) throw new Error(error.message)
  }

  async findAccountByDisplayName(displayName: string): Promise<AccountMatch | undefined> {
    const { data, error } = await this.client.rpc('find_account_by_display_name', {
      p_display_name: displayName,
    })
    if (error !== null) throw new Error(error.message)
    const firstRow = (data ?? [])[0]
    return firstRow === undefined ? undefined : mapAccountMatchRowToDomain(firstRow)
  }

  // --- Amitié (A3) ---
  // Toutes les erreurs de ces RPC sont remontées en FriendshipError typée
  // (le message PostgREST est exactement le code) — jamais en Error nue :
  // c'est ce qui garantit qu'aucun code brut n'atteint un toast.

  async getFriendships(): Promise<FriendshipBundle> {
    const { data, error } = await this.client.rpc('get_friendships')
    if (error !== null) {
      throw new FriendshipError(parseFriendshipErrorCode(error.message))
    }
    if (data === null) throw new FriendshipError('unknown')
    // Retour typé Json (cf. database.types.ts) : cast vers la forme brute
    // attendue par le mapper, comme pour get_user_profile.
    return mapFriendshipsJsonToDomain(data as unknown as RawFriendshipsJson)
  }

  async requestFriendship(displayName: string): Promise<FriendshipRequestOutcome> {
    const { data, error } = await this.client.rpc('request_friendship', {
      p_display_name: displayName,
    })
    if (error !== null) {
      throw new FriendshipError(parseFriendshipErrorCode(error.message))
    }
    if (data !== 'pending' && data !== 'accepted') throw new FriendshipError('unknown')
    return data
  }

  async acceptFriendship(userId: string): Promise<void> {
    const { error } = await this.client.rpc('accept_friendship', { p_user_id: userId })
    if (error !== null) {
      throw new FriendshipError(parseFriendshipErrorCode(error.message))
    }
  }

  async refuseFriendship(userId: string): Promise<void> {
    const { error } = await this.client.rpc('refuse_friendship', { p_user_id: userId })
    if (error !== null) {
      throw new FriendshipError(parseFriendshipErrorCode(error.message))
    }
  }

  async cancelFriendshipRequest(userId: string): Promise<void> {
    const { error } = await this.client.rpc('cancel_friendship_request', { p_user_id: userId })
    if (error !== null) {
      throw new FriendshipError(parseFriendshipErrorCode(error.message))
    }
  }

  async removeFriendship(userId: string): Promise<void> {
    const { error } = await this.client.rpc('remove_friendship', { p_user_id: userId })
    if (error !== null) {
      throw new FriendshipError(parseFriendshipErrorCode(error.message))
    }
  }
}
