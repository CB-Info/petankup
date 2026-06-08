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
