import type { UserFreeMatchStats, UserStats } from '../types'

// Combinaison des statistiques à l'AFFICHAGE (D3) : les deux sources
// restent séparées en base, la somme n'est jamais stockée. Seuls les cinq
// compteurs communs se combinent — tournois joués / gagnés / podiums n'ont
// pas d'équivalent match libre et ne passent jamais par ici.

// Position du toggle de détail des statistiques du profil.
export type StatsSource = 'combined' | 'tournaments' | 'free_matches'

export const STATS_SOURCES: readonly StatsSource[] = [
  'combined',
  'tournaments',
  'free_matches',
]

export type CombinableStats = {
  matchesPlayed: number
  wins: number
  losses: number
  pointsScored: number
  pointsConceded: number
}

function zeroStats(): CombinableStats {
  return {
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    pointsScored: 0,
    pointsConceded: 0,
  }
}

// Les cinq compteurs communs d'une source ; une source absente compte pour
// zéro (véridique : aucune partie de cette source).
function combinablePartOf(
  sourceStats: UserStats | UserFreeMatchStats | null,
): CombinableStats {
  if (sourceStats === null) return zeroStats()
  return {
    matchesPlayed: sourceStats.matchesPlayed,
    wins: sourceStats.wins,
    losses: sourceStats.losses,
    pointsScored: sourceStats.pointsScored,
    pointsConceded: sourceStats.pointsConceded,
  }
}

// Total combiné, ou null quand AUCUNE source n'existe (l'écran affiche
// alors son état vide plutôt que des zéros sans histoire).
export function combineUserStats(
  stats: UserStats | null,
  freeMatchStats: UserFreeMatchStats | null,
): CombinableStats | null {
  if (stats === null && freeMatchStats === null) return null
  const tournamentPart = combinablePartOf(stats)
  const freeMatchPart = combinablePartOf(freeMatchStats)
  return {
    matchesPlayed: tournamentPart.matchesPlayed + freeMatchPart.matchesPlayed,
    wins: tournamentPart.wins + freeMatchPart.wins,
    losses: tournamentPart.losses + freeMatchPart.losses,
    pointsScored: tournamentPart.pointsScored + freeMatchPart.pointsScored,
    pointsConceded: tournamentPart.pointsConceded + freeMatchPart.pointsConceded,
  }
}

// Valeurs des tuiles pour une position du toggle. Une position dont la
// source est absente reste active et montre des zéros.
export function statsForSource(
  source: StatsSource,
  stats: UserStats | null,
  freeMatchStats: UserFreeMatchStats | null,
): CombinableStats {
  if (source === 'tournaments') return combinablePartOf(stats)
  if (source === 'free_matches') return combinablePartOf(freeMatchStats)
  return combineUserStats(stats, freeMatchStats) ?? zeroStats()
}
