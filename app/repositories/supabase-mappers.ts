import type { Database } from '../types/database.types'
import type {
  AccountMatch,
  CreateFreeMatchInput,
  FreeMatch,
  FreeMatchPlayer,
  FriendshipBundle,
  FriendshipEntry,
  Profile,
  UserFreeMatchResult,
  UserFreeMatchStats,
  Team,
  TeamPlayer,
  Teammate,
  Tournament,
  TournamentMatch,
  TournamentMember,
  UserProfileBundle,
  UserStats,
  UserTournamentResult,
} from '../types'
import { sortFreeMatchPlayers } from '../utils/free-match'

// Traductions pures entre les rows Supabase (snake_case, nullables stricts)
// et les types domaine (camelCase, optionnels via `?`). Aucune logique
// métier ici : si une transformation devient conditionnelle, elle a sa
// place dans le repository ou le store, pas ici.

type TournamentRow = Database['public']['Tables']['tournaments']['Row']
type TournamentInsert = Database['public']['Tables']['tournaments']['Insert']
type TournamentUpdate = Database['public']['Tables']['tournaments']['Update']
type TeamRow = Database['public']['Tables']['teams']['Row']
type TeamPlayerRow = Database['public']['Tables']['team_players']['Row']
// (pas de TeamInsert : teams n'est plus écrit en direct, cf. RPCs.)
// teams est toujours lu avec ses joueurs embarqués (select '*, team_players(*)').
type TeamRowWithPlayers = TeamRow & { team_players: TeamPlayerRow[] }
type MatchRow = Database['public']['Tables']['tournament_matches']['Row']
type MatchInsert = Database['public']['Tables']['tournament_matches']['Insert']
type MatchUpdate = Database['public']['Tables']['tournament_matches']['Update']
type TournamentMemberRow = Database['public']['Tables']['tournament_members']['Row']
type ProfileRow = Database['public']['Tables']['profiles']['Row']
// Colonnes de profiles réellement lisibles par authenticated depuis A2
// (visibility est masquée du SELECT direct — grant par colonne) : le mapper
// ne doit jamais exiger plus que ce que la base accepte de servir.
type ProfileIdentityRow = Pick<ProfileRow, 'id' | 'display_name' | 'created_at' | 'updated_at'>
type FreeMatchRow = Database['public']['Tables']['free_matches']['Row']
type FreeMatchPlayerRow = Database['public']['Tables']['free_match_players']['Row']
// free_matches est toujours lu avec ses joueurs embarqués
// (select '*, free_match_players(*)'), comme teams avec team_players.
export type FreeMatchRowWithPlayers = FreeMatchRow & { free_match_players: FreeMatchPlayerRow[] }
type AccountLookupRow = Database['public']['Functions']['find_account_by_display_name']['Returns'][number]
type CreateFreeMatchRpcArgs = Database['public']['Functions']['create_free_match']['Args']
// La RPC accepte p_played_on NULL (coalesce vers la date de Paris), mais le
// générateur de types ignore la nullabilité des arguments de fonction et
// déclare `string`. Le payload porte la vraie forme ; le repository recadre
// au moment de l'appel (cast ciblé, documenté sur place).
export type CreateFreeMatchRpcPayload
  = Omit<CreateFreeMatchRpcArgs, 'p_played_on'> & { p_played_on: string | null }

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

// Domain → Update : uniquement les colonnes mutables. id sert de clé (eq),
// owner_id et format sont immutables, created_at / updated_at / completed_at
// sont pilotés par des triggers DB — tous volontairement absents pour ne
// jamais écraser une valeur gérée par la base (cf. invariant completed_at de
// la Phase I : c'est le trigger BEFORE UPDATE qui le remplit).
export function mapTournamentDomainToUpdate(
  tournament: Tournament,
): TournamentUpdate {
  return {
    name: tournament.name,
    date: tournament.date,
    location: tournament.location ?? null,
    description: tournament.description ?? null,
    status: tournament.status,
    visibility: tournament.visibility,
  }
}

// --- Team ---
// Pas de mapper Domain → Insert : les écritures sur teams passent
// exclusivement par les RPCs create_team_with_players /
// update_team_with_players (comme tournament_members et team_players).
// La lecture se fait toujours avec l'embed team_players(*).

export function mapTeamPlayerRowToDomain(row: TeamPlayerRow): TeamPlayer {
  return {
    id: row.id,
    teamId: row.team_id,
    tournamentId: row.tournament_id,
    userId: row.user_id,
    displayNameSnapshot: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapTeamRowToDomain(row: TeamRowWithPlayers): Team {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    players: row.team_players.map(mapTeamPlayerRowToDomain),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// --- TournamentMatch ---

export function mapMatchRowToDomain(row: MatchRow): TournamentMatch {
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

export function mapMatchDomainToInsert(match: TournamentMatch): MatchInsert {
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

// Domain → Update : uniquement les colonnes mutables d'un match (le score et
// son issue). id sert de clé (eq) ; tournament_id / team_a_id / team_b_id /
// round_number sont fixés à la création ; timestamps gérés par trigger.
export function mapMatchDomainToUpdate(match: TournamentMatch): MatchUpdate {
  return {
    score_a: match.scoreA,
    score_b: match.scoreB,
    winner_id: match.winnerId,
    status: match.status,
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

export function mapProfileRowToDomain(row: ProfileIdentityRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// --- UserProfileBundle (RPC get_user_profile) ---
// Forme brute du JSON retourné par public.get_user_profile. Snake_case,
// nullable strict, miroir exact du json_build_object côté SQL. Exporté car
// le repository (et les tests) en ont besoin pour typer le cast du retour
// RPC (typé Json dans database.types.ts).
export type RawUserProfileBundleJson = {
  profile: {
    id: string
    display_name: string
    created_at: string
    updated_at: string
  } | null
  stats: {
    matches_played: number
    wins: number
    losses: number
    points_scored: number
    points_conceded: number
    tournaments_played: number
    tournaments_won: number
    podiums: number
    last_tournament_at: string | null
  } | null
  results: Array<{
    tournament_id: string
    tournament_name: string
    tournament_date: string
    tournament_completed_at: string
    team_id: string
    team_name: string
    wins: number
    losses: number
    points_scored: number
    points_conceded: number
    final_rank: number
    is_winner: boolean
    is_podium: boolean
    // Optionnel : absent si l'app est déployée avant la migration DB qui
    // l'ajoute (décalage de déploiement). Le mapper retombe alors sur false
    // — fail-closed : carte statique, jamais de lien mort.
    viewer_can_open?: boolean
    teammates: Array<{ user_id: string | null, display_name: string }>
  }>
  // Optionnelles : absentes si l'app est déployée avant la migration
  // H2.c-1 (décalage de déploiement). Le mapper retombe sur [] / null.
  free_matches?: Array<{
    match_id: string
    played_on: string
    created_at: string
    score_a: number
    score_b: number
    side: 'A' | 'B'
    viewer_can_open?: boolean
    teammates: Array<{ user_id: string | null, display_name: string }>
    opponents: Array<{ user_id: string | null, display_name: string }>
  }>
  free_match_stats?: {
    matches_played: number
    wins: number
    losses: number
    points_scored: number
    points_conceded: number
  } | null
}

// Sous-formes brutes dérivées par accès indexé : évite de redéclarer les
// shapes et garde une source unique (RawUserProfileBundleJson).
type RawUserStatsJson = NonNullable<RawUserProfileBundleJson['stats']>
type RawUserTournamentResultJson = RawUserProfileBundleJson['results'][number]
type RawTeammateJson = RawUserTournamentResultJson['teammates'][number]
type RawUserFreeMatchResultJson
  = NonNullable<RawUserProfileBundleJson['free_matches']>[number]
type RawUserFreeMatchStatsJson
  = NonNullable<RawUserProfileBundleJson['free_match_stats']>

function mapUserStatsJsonToDomain(raw: RawUserStatsJson): UserStats {
  return {
    matchesPlayed: raw.matches_played,
    wins: raw.wins,
    losses: raw.losses,
    pointsScored: raw.points_scored,
    pointsConceded: raw.points_conceded,
    tournamentsPlayed: raw.tournaments_played,
    tournamentsWon: raw.tournaments_won,
    podiums: raw.podiums,
    lastTournamentAt: raw.last_tournament_at,
  }
}

function mapTeammateJsonToDomain(raw: RawTeammateJson): Teammate {
  return {
    userId: raw.user_id,
    displayName: raw.display_name,
  }
}

function mapUserTournamentResultJsonToDomain(
  raw: RawUserTournamentResultJson,
): UserTournamentResult {
  return {
    tournamentId: raw.tournament_id,
    tournamentName: raw.tournament_name,
    tournamentDate: raw.tournament_date,
    tournamentCompletedAt: raw.tournament_completed_at,
    teamId: raw.team_id,
    teamName: raw.team_name,
    wins: raw.wins,
    losses: raw.losses,
    pointsScored: raw.points_scored,
    pointsConceded: raw.points_conceded,
    finalRank: raw.final_rank,
    isWinner: raw.is_winner,
    isPodium: raw.is_podium,
    viewerCanOpen: raw.viewer_can_open ?? false,
    teammates: raw.teammates.map(mapTeammateJsonToDomain),
  }
}

// Coéquipiers et adversaires d'un match libre partagent la forme Teammate
// des coéquipiers de tournoi — mapTeammateJsonToDomain sert aux deux listes.
function mapUserFreeMatchResultJsonToDomain(
  raw: RawUserFreeMatchResultJson,
): UserFreeMatchResult {
  return {
    matchId: raw.match_id,
    playedOn: raw.played_on,
    createdAt: raw.created_at,
    scoreA: raw.score_a,
    scoreB: raw.score_b,
    side: raw.side,
    // Même garde fail-closed que viewer_can_open des tournois.
    viewerCanOpen: raw.viewer_can_open ?? false,
    teammates: raw.teammates.map(mapTeammateJsonToDomain),
    opponents: raw.opponents.map(mapTeammateJsonToDomain),
  }
}

function mapUserFreeMatchStatsJsonToDomain(
  raw: RawUserFreeMatchStatsJson,
): UserFreeMatchStats {
  return {
    matchesPlayed: raw.matches_played,
    wins: raw.wins,
    losses: raw.losses,
    pointsScored: raw.points_scored,
    pointsConceded: raw.points_conceded,
  }
}

// Traduction technique pure snake_case → camelCase. Aucune logique métier :
// pas de tri (l'ordre des results et des free_matches est garanti côté
// RPC — la fusion chronologique vit dans utils/journal.ts), pas
// d'agrégation, pas de re-hydratation de pseudo (faite au render).
export function mapUserProfileBundleJsonToDomain(
  raw: RawUserProfileBundleJson,
): UserProfileBundle {
  // ?? null : free_match_stats absent (décalage de déploiement) vaut null.
  const rawFreeMatchStats = raw.free_match_stats ?? null
  return {
    profile: raw.profile === null ? null : mapProfileRowToDomain(raw.profile),
    stats: raw.stats === null ? null : mapUserStatsJsonToDomain(raw.stats),
    results: (raw.results ?? []).map(mapUserTournamentResultJsonToDomain),
    freeMatches: (raw.free_matches ?? []).map(mapUserFreeMatchResultJsonToDomain),
    freeMatchStats:
      rawFreeMatchStats === null
        ? null
        : mapUserFreeMatchStatsJsonToDomain(rawFreeMatchStats),
  }
}

// --- FreeMatch ---
// Pas de mapper Domain → Insert : l'écriture passe exclusivement par la RPC
// create_free_match (match + joueurs atomiques, snapshot des pseudos côté
// DB). La lecture se fait toujours avec l'embed free_match_players(*).

export function mapFreeMatchPlayerRowToDomain(row: FreeMatchPlayerRow): FreeMatchPlayer {
  return {
    id: row.id,
    matchId: row.match_id,
    side: row.side,
    userId: row.user_id,
    displayNameSnapshot: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// Les joueurs sont triés ici (ordre déterministe, cf. sortFreeMatchPlayers) :
// la base ne conserve pas d'ordre de saisie, l'ordre fait partie de la
// forme domaine.
export function mapFreeMatchRowToDomain(row: FreeMatchRowWithPlayers): FreeMatch {
  return {
    id: row.id,
    createdBy: row.created_by,
    playedOn: row.played_on,
    scoreA: row.score_a,
    scoreB: row.score_b,
    visibility: row.visibility,
    players: sortFreeMatchPlayers(row.free_match_players.map(mapFreeMatchPlayerRowToDomain)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapAccountMatchRowToDomain(row: AccountLookupRow): AccountMatch {
  return {
    userId: row.user_id,
    displayName: row.display_name,
  }
}

// Domain → arguments de la RPC create_free_match (snake_case côté DB).
export function mapCreateFreeMatchInputToRpcPayload(
  input: CreateFreeMatchInput,
): CreateFreeMatchRpcPayload {
  return {
    p_played_on: input.playedOn,
    p_visibility: input.visibility,
    p_score_a: input.scoreA,
    p_score_b: input.scoreB,
    p_players: input.players.map(player => ({
      side: player.side,
      user_id: player.userId,
      display_name: player.displayName,
    })),
  }
}

// --- Amitié (RPC get_friendships, A3) ---
// Forme brute du JSON retourné par public.get_friendships. Chaque entrée
// désigne L'AUTRE personne de la relation ; l'ordre de stockage du duo et
// le demandeur brut ne sont jamais exposés. Exporté pour typer le cast du
// retour RPC (typé Json dans database.types.ts).
export interface RawFriendshipEntryJson {
  user_id: string
  display_name: string
}

export interface RawFriendshipsJson {
  friends: RawFriendshipEntryJson[]
  received: RawFriendshipEntryJson[]
  sent: RawFriendshipEntryJson[]
}

export function mapFriendshipEntryJsonToDomain(raw: RawFriendshipEntryJson): FriendshipEntry {
  return {
    userId: raw.user_id,
    displayName: raw.display_name,
  }
}

// PAS de retri : l'ordre est garanti par la RPC (amis par pseudo insensible
// à la casse, demandes de la plus récente à la plus ancienne) — même règle
// que results/free_matches du bundle de profil. Le coalesce('[]') côté SQL
// garantit des tableaux jamais nuls.
export function mapFriendshipsJsonToDomain(raw: RawFriendshipsJson): FriendshipBundle {
  return {
    friends: raw.friends.map(mapFriendshipEntryJsonToDomain),
    received: raw.received.map(mapFriendshipEntryJsonToDomain),
    sent: raw.sent.map(mapFriendshipEntryJsonToDomain),
  }
}
