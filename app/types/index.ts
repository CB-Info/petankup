export type TournamentFormat = "round_robin";
export type TournamentStatus = "draft" | "in_progress" | "completed";
export type TournamentVisibility = "private" | "public";
export type MatchStatus = "pending" | "completed";
export type ScoreValidationResult = { valid: boolean; error?: string };

export interface Tournament {
  id: string;
  name: string;
  date: string;
  location?: string;
  description?: string;
  format: TournamentFormat;
  status: TournamentStatus;
  visibility: TournamentVisibility;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamPlayer {
  id: string;
  teamId: string;
  tournamentId: string;
  // null = joueur libre (saisi à la main, pas de compte) ; non-null = joueur
  // lié à un compte. Mis à NULL si le compte est supprimé (cascade DB).
  userId: string | null;
  // Snapshot DB du pseudo au moment de l'écriture. Pour un joueur lié, l'UI
  // préfère le pseudo live (cf. getPlayerDisplayName) ; ce snapshot reste le
  // fallback (profil non hydraté, ou compte supprimé).
  displayNameSnapshot: string;
  createdAt: string;
  updatedAt: string;
}

export interface Team {
  id: string;
  tournamentId: string;
  name: string;
  players: TeamPlayer[];
  createdAt: string;
  updatedAt: string;
}

export interface TournamentMatch {
  id: string;
  tournamentId: string;
  teamAId: string;
  teamBId: string;
  scoreA: number | null;
  scoreB: number | null;
  winnerId: string | null;
  status: MatchStatus;
  roundNumber: number;
  createdAt: string;
  updatedAt: string;
}

export interface Ranking {
  teamId: string;
  tournamentId: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifference: number;
  rank: number;
}

export interface TournamentMember {
  id: string;
  tournamentId: string;
  userId: string;
  memberEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  id: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export type ProfileVisibility = "private" | "public";

// Sa propre ligne de profil, la seule qui porte le réglage de
// confidentialité (RPC get_my_profile — la colonne est masquée pour tout
// autre lecteur). Le réglage est tenu À CÔTÉ de l'identité : il n'entre
// jamais dans un Profile, donc jamais dans le cache des profils.
export interface MyProfile {
  profile: Profile;
  visibility: ProfileVisibility;
}

// Point de vue demandé à la base pour composer un bundle de profil : le
// visiteur réel (règle A2 : soi, profil public ou ami accepté), ou un tiers
// quelconque (aperçu extérieur C6 — la base le réserve au propriétaire).
export type ProfileViewpoint = "viewer" | "stranger";

export type InviteMemberErrorCode =
  | "not_authenticated"
  | "not_owner"
  | "display_name_not_found"
  | "self_invite"
  | "already_member"
  | "tournament_completed"
  | "member_in_team"
  | "unknown";

export class InviteMemberError extends Error {
  constructor(public readonly code: InviteMemberErrorCode) {
    super(code);
    this.name = "InviteMemberError";
  }
}

export type ProfileErrorCode = "display_name_taken";

export class ProfileError extends Error {
  constructor(public readonly code: ProfileErrorCode) {
    super(code);
    this.name = "ProfileError";
  }
}

export interface UserStats {
  matchesPlayed: number;
  wins: number;
  losses: number;
  pointsScored: number;
  pointsConceded: number;
  tournamentsPlayed: number;
  tournamentsWon: number;
  podiums: number;
  lastTournamentAt: string | null;
}

export interface Teammate {
  // null = joueur libre (pas de compte). Pour les coéquipiers liés à un
  // compte, l'UI (Phase K) résoudra le pseudo live via getPlayerDisplayName
  // en lisant profileById ; sinon elle retombe sur le snapshot.
  userId: string | null;
  displayName: string;
}

export interface UserTournamentResult {
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string; // ISO date (cf. tournaments.date)
  tournamentCompletedAt: string; // ISO timestamp
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  pointsScored: number;
  pointsConceded: number;
  finalRank: number;
  isWinner: boolean;
  isPodium: boolean;
  // Dérivé par la base RELATIVEMENT AU VISITEUR courant (helper de
  // visibilité partagé) : le tournoi de cette entrée lui est-il ouvrable ?
  // Jamais la visibilité brute du tournoi — aucune information nouvelle.
  viewerCanOpen: boolean;
  teammates: Teammate[];
}

export interface UserFreeMatchResult {
  matchId: string;
  playedOn: string; // ISO date (YYYY-MM-DD)
  // Moment de l'enregistrement (pendant de tournamentCompletedAt) :
  // départage des égalités jour/jour dans le journal unifié.
  createdAt: string;
  scoreA: number;
  scoreB: number;
  // Camp du joueur consulté — son résultat s'en déduit (freeMatchOutcomeOf).
  side: FreeMatchSide;
  // Dérivé par la base RELATIVEMENT AU VISITEUR courant (helper de
  // visibilité partagé H2.a) — jamais la visibilité brute du match.
  viewerCanOpen: boolean;
  // Même camp (le joueur consulté exclu) / camp adverse. VIDES quand
  // viewerCanOpen est faux : les participants d'un match privé ne sont
  // jamais divulgués à un tiers (décision H2.c-1).
  teammates: Teammate[];
  opponents: Teammate[];
}

// Compteurs de match libre, séparés de UserStats : seuls les cinq communs
// se combinent, à l'affichage (D3) — jamais stockés sommés.
export interface UserFreeMatchStats {
  matchesPlayed: number;
  wins: number;
  losses: number;
  pointsScored: number;
  pointsConceded: number;
}

// Les trois formes de réponse de get_user_profile, deux à deux
// distinguables par `kind` (même motif que JournalEntry) :
//   - full : le contenu complet — ses cinq champs restent OBLIGATOIRES ;
//   - restricted : profil privé consulté par un non-ami (A2) — le pseudo
//     seul, la base n'a rien calculé d'autre (les clés de contenu sont
//     absentes du JSON, pas vides) ;
//   - not_found : aucune ligne profiles pour cet id.
export interface FullUserProfileBundle {
  kind: "full";
  profile: Profile;
  // null si le user n'a aucun tournoi completed à son palmarès (absence
  // de ligne user_stats côté DB).
  stats: UserStats | null;
  // [] si pas d'historique. Trié par tournamentCompletedAt desc côté RPC,
  // l'ordre est à conserver tel quel.
  results: UserTournamentResult[];
  // [] si aucun match libre. Trié par playedOn desc, createdAt desc côté
  // RPC ; la fusion chronologique avec les tournois est faite à
  // l'affichage (utils/journal.ts).
  freeMatches: UserFreeMatchResult[];
  // null si le joueur n'a aucun match libre (absence de ligne
  // user_free_match_stats côté DB).
  freeMatchStats: UserFreeMatchStats | null;
}

export interface RestrictedUserProfileBundle {
  kind: "restricted";
  profile: Profile;
}

export interface NotFoundUserProfileBundle {
  kind: "not_found";
}

export type UserProfileBundle =
  | FullUserProfileBundle
  | RestrictedUserProfileBundle
  | NotFoundUserProfileBundle;

// --- Match libre (H2) ---
// Une partie hors tournoi, notée après coup : deux camps A / B de même
// effectif (1 à 3 joueurs), un score final strict (vainqueur à 13 exactement,
// perdant de 0 à 12), une date et une visibilité. Créée par la RPC
// create_free_match, jamais modifiée ensuite (aucun UPDATE côté base) ;
// supprimable par son créateur seul.

export type FreeMatchSide = "A" | "B";
export type FreeMatchVisibility = "private" | "public";
// Le format n'est pas stocké : il se déduit de l'effectif par camp (1 / 2 / 3).
export type FreeMatchFormat = "tete_a_tete" | "doublette" | "triplette";

export interface FreeMatchPlayer {
  id: string;
  matchId: string;
  side: FreeMatchSide;
  // null = joueur libre, ou compte supprimé depuis (SET NULL côté base).
  userId: string | null;
  // Pseudo figé à l'enregistrement (cf. TeamPlayer.displayNameSnapshot).
  displayNameSnapshot: string;
  createdAt: string;
  updatedAt: string;
}

export interface FreeMatch {
  id: string;
  // null si le compte du créateur a été supprimé (SET NULL côté base).
  createdBy: string | null;
  playedOn: string; // ISO date (YYYY-MM-DD)
  scoreA: number;
  scoreB: number;
  visibility: FreeMatchVisibility;
  players: FreeMatchPlayer[];
  createdAt: string;
  updatedAt: string;
}

// Résultat de la recherche d'un compte par pseudo exact
// (find_account_by_display_name) : le pseudo renvoyé est la forme canonique
// du profil (casse, espaces), pas la saisie.
export interface AccountMatch {
  userId: string;
  displayName: string;
}

export interface CreateFreeMatchPlayerInput {
  side: FreeMatchSide;
  userId: string | null;
  displayName: string;
}

export interface CreateFreeMatchInput {
  // null = date non renseignée : la base applique « aujourd'hui » en date de
  // Paris (cf. règle S11), sans dépendre du fuseau du navigateur.
  playedOn: string | null;
  visibility: FreeMatchVisibility;
  scoreA: number;
  scoreB: number;
  players: CreateFreeMatchPlayerInput[];
}

// Codes levés par la RPC create_free_match (`raise exception '<code>'`), dans
// l'ordre de vérification côté base. `unknown` couvre tout le reste (réseau,
// RLS, contrainte non prévue) — jamais affiché tel quel.
export type FreeMatchErrorCode =
  | "not_authenticated"
  | "invalid_players"
  | "invalid_side"
  | "invalid_display_name"
  | "not_participant"
  | "invalid_side_count"
  | "unbalanced_sides"
  | "duplicate_player"
  | "invalid_score"
  | "invalid_played_on"
  | "player_user_not_found"
  | "unknown";

export class FreeMatchError extends Error {
  constructor(public readonly code: FreeMatchErrorCode) {
    super(code);
    this.name = "FreeMatchError";
  }
}

// --- Amitié (A3) ---

// Une personne dans une relation d'amitié, vue depuis l'utilisateur
// courant : toujours L'AUTRE personne du duo (la RPC get_friendships ne
// révèle jamais l'ordre de stockage ni le demandeur brut).
export interface FriendshipEntry {
  userId: string;
  displayName: string;
}

// Les trois listes de la RPC get_friendships. Tris garantis côté base :
// amis par pseudo (insensible à la casse), demandes de la plus récente à
// la plus ancienne. Jamais null — listes vides.
export interface FriendshipBundle {
  friends: FriendshipEntry[];
  received: FriendshipEntry[];
  sent: FriendshipEntry[];
}

// Issue d'une demande (request_friendship) : 'accepted' = demandes
// croisées (A7) — l'autre avait déjà demandé, l'appel a accepté sa
// demande, vous êtes amis immédiatement.
export type FriendshipRequestOutcome = "pending" | "accepted";

// Relation de l'utilisateur courant avec un profil, dérivée localement du
// bundle (utils/friendship.ts). Vocabulaire de la spec : « statut
// d'amitié ».
export type FriendshipStatus =
  | "self"
  | "friends"
  | "request_sent"
  | "request_received"
  | "none";

// Codes levés par les RPC d'amitié (`raise exception '<code>'`). `unknown`
// couvre tout le reste (réseau, panne) — jamais affiché tel quel.
export type FriendshipErrorCode =
  | "not_authenticated"
  | "display_name_not_found"
  | "self_request"
  | "already_requested"
  | "already_friends"
  | "request_not_found"
  | "not_addressee"
  | "not_requester"
  | "unknown";

export class FriendshipError extends Error {
  constructor(public readonly code: FriendshipErrorCode) {
    super(code);
    this.name = "FriendshipError";
  }
}
