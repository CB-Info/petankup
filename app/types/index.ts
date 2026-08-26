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

export interface Match {
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

export interface UserProfileBundle {
  // null si la RPC ne trouve pas de ligne profiles pour le user (cas
  // dégénéré : user supprimé, etc.).
  profile: Profile | null;
  // null si le user n'a aucun tournoi completed à son palmarès (absence
  // de ligne user_stats côté DB).
  stats: UserStats | null;
  // [] si pas d'historique. Trié par tournamentCompletedAt desc côté RPC,
  // l'ordre est à conserver tel quel.
  results: UserTournamentResult[];
}
