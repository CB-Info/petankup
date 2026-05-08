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

export interface Team {
  id: string;
  tournamentId: string;
  name: string;
  players: string[];
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
