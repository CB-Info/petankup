import type { TournamentMatch, Ranking, Team } from "../types";

const BYE_MARKER = "__bye__";

// Algorithme du cercle (circle method) : la première équipe reste fixe,
// les autres tournent d'un cran à chaque round, et on apparie la position
// `i` avec la position `totalSlots - 1 - i`. Si l'effectif est impair, on
// ajoute une équipe « bye » fictive — l'équipe qui tombe en face est au
// repos ce round-là (le match correspondant est exclu du calendrier).
export function generateRoundRobinMatches(
  teams: Team[],
  tournamentId: string,
  now: string,
): TournamentMatch[] {
  if (teams.length < 2) return [];

  const teamIdsInCircle: string[] = teams.map((team) => team.id);
  const teamCountIsOdd = teamIdsInCircle.length % 2 !== 0;
  if (teamCountIsOdd) {
    teamIdsInCircle.push(BYE_MARKER);
  }

  const totalSlots = teamIdsInCircle.length;
  const matchesPerRound = totalSlots / 2;
  const totalRounds = totalSlots - 1;

  const generatedMatches: TournamentMatch[] = [];

  for (let roundNumber = 1; roundNumber <= totalRounds; roundNumber++) {
    for (let pairIndex = 0; pairIndex < matchesPerRound; pairIndex++) {
      const teamAId = teamIdsInCircle[pairIndex]!;
      const teamBId = teamIdsInCircle[totalSlots - 1 - pairIndex]!;

      const oneTeamIsAtRest = teamAId === BYE_MARKER || teamBId === BYE_MARKER;
      if (oneTeamIsAtRest) continue;

      generatedMatches.push(
        buildPendingMatch(teamAId, teamBId, roundNumber, tournamentId, now),
      );
    }
    rotateAllExceptFirst(teamIdsInCircle);
  }

  return generatedMatches;
}

function buildPendingMatch(
  teamAId: string,
  teamBId: string,
  roundNumber: number,
  tournamentId: string,
  now: string,
): TournamentMatch {
  return {
    id: crypto.randomUUID(),
    tournamentId,
    teamAId,
    teamBId,
    scoreA: null,
    scoreB: null,
    winnerId: null,
    status: "pending",
    roundNumber,
    createdAt: now,
    updatedAt: now,
  };
}

// Fait glisser tout le tableau d'un cran vers la gauche, sauf l'index 0
// qui reste fixe. C'est le pas de rotation de l'algorithme du cercle.
// Mute le tableau passé en paramètre.
function rotateAllExceptFirst(items: string[]): void {
  const movableItems = items.slice(1);
  const lastItem = movableItems.pop()!;
  movableItems.unshift(lastItem);
  items.splice(1, items.length - 1, ...movableItems);
}

export function computeRanking(teams: Team[], matches: TournamentMatch[]): Ranking[] {
  if (teams.length === 0) return [];

  const completedMatches = matches.filter(
    (match) => match.status === "completed",
  );
  const tournamentId = teams[0]!.tournamentId;

  const rankings = teams.map((team) =>
    buildRankingForTeam(team, tournamentId, completedMatches),
  );

  rankings.sort((rankingA, rankingB) =>
    tieBreak(rankingA, rankingB, completedMatches),
  );
  rankings.forEach((ranking, sortedIndex) => {
    ranking.rank = sortedIndex + 1;
  });

  return rankings;
}

function buildRankingForTeam(
  team: Team,
  tournamentId: string,
  completedMatches: TournamentMatch[],
): Ranking {
  let wins = 0;
  let losses = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;

  for (const match of completedMatches) {
    const teamPlayedAsTeamA = match.teamAId === team.id;
    const teamPlayedAsTeamB = match.teamBId === team.id;
    if (!teamPlayedAsTeamA && !teamPlayedAsTeamB) continue;

    const pointsScoredByThisTeam = teamPlayedAsTeamA
      ? match.scoreA
      : match.scoreB;
    const pointsScoredByOpponent = teamPlayedAsTeamA
      ? match.scoreB
      : match.scoreA;
    pointsFor += pointsScoredByThisTeam ?? 0;
    pointsAgainst += pointsScoredByOpponent ?? 0;

    if (match.winnerId === team.id) wins++;
    else losses++;
  }

  return {
    teamId: team.id,
    tournamentId,
    wins,
    losses,
    pointsFor,
    pointsAgainst,
    pointDifference: pointsFor - pointsAgainst,
    rank: 0,
  };
}

// Comparateur de tri pour le classement.
// Retourne un nombre négatif si `rankingA` doit passer devant `rankingB`,
// positif sinon, 0 en cas d'égalité totale.
// Ordre de départage défini dans CLAUDE.md > Domaine métier > Classement.
export function tieBreak(
  rankingA: Ranking,
  rankingB: Ranking,
  matches: TournamentMatch[],
): number {
  if (rankingA.wins !== rankingB.wins) {
    return rankingB.wins - rankingA.wins;
  }
  if (rankingA.pointDifference !== rankingB.pointDifference) {
    return rankingB.pointDifference - rankingA.pointDifference;
  }
  if (rankingA.pointsFor !== rankingB.pointsFor) {
    return rankingB.pointsFor - rankingA.pointsFor;
  }

  const directMatch = findCompletedMatchBetween(
    rankingA.teamId,
    rankingB.teamId,
    matches,
  );
  if (directMatch?.winnerId === rankingA.teamId) return -1;
  if (directMatch?.winnerId === rankingB.teamId) return 1;

  return 0;
}

function findCompletedMatchBetween(
  firstTeamId: string,
  secondTeamId: string,
  matches: TournamentMatch[],
): TournamentMatch | undefined {
  return matches.find((match) => {
    if (match.status !== "completed") return false;
    const aVsB =
      match.teamAId === firstTeamId && match.teamBId === secondTeamId;
    const bVsA =
      match.teamAId === secondTeamId && match.teamBId === firstTeamId;
    return aVsB || bVsA;
  });
}
