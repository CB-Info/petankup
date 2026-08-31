import type { UserFreeMatchResult, UserTournamentResult } from '../types'

// Journal de bord unifié : tournois et matchs libres dans UNE liste
// chronologique (S5), fusionnée à l'affichage — la base fournit deux
// tableaux, chacun dans son ordre RPC.
//
// Clés de tri, communes aux deux familles :
//   - playedOn : jour de JEU (tournaments.date / free_matches.played_on) —
//     la chronologie du parcours du joueur. ⚠️ Pour les tournois, c'est un
//     changement assumé : le journal seul suivait completedAt desc ; un
//     tournoi antidaté mais terminé tard redescend à sa date de jeu.
//   - recordedAt : moment de l'enregistrement (tournamentCompletedAt /
//     createdAt), départage des égalités jour/jour. Comparaison textuelle :
//     les deux sont sérialisés par le même appel SQL dans le même style —
//     ne jamais mélanger deux styles d'horodatage dans des fixtures.
// Le tri est stable (ES2019+) : à clés égales, l'ordre RPC de chaque
// famille est conservé (cas réel pour les matchs libres, où il tient lieu
// du « id desc » du RPC).

export type JournalFilter = 'all' | 'tournaments' | 'free_matches'

export const JOURNAL_FILTERS: readonly JournalFilter[] = [
  'all',
  'tournaments',
  'free_matches',
]

export function isJournalFilter(value: unknown): value is JournalFilter {
  return (
    typeof value === 'string'
    && (JOURNAL_FILTERS as readonly string[]).includes(value)
  )
}

// Union discriminée : la page choisit la carte par `kind`, la clé de rendu
// est préfixée par type (aucune collision entre ids de familles distinctes).
export type JournalEntry =
  | {
    kind: 'tournament'
    key: string
    playedOn: string
    recordedAt: string
    result: UserTournamentResult
  }
  | {
    kind: 'free_match'
    key: string
    playedOn: string
    recordedAt: string
    freeMatch: UserFreeMatchResult
  }

function toTournamentEntry(result: UserTournamentResult): JournalEntry {
  return {
    kind: 'tournament',
    key: `tournament:${result.tournamentId}`,
    playedOn: result.tournamentDate,
    recordedAt: result.tournamentCompletedAt,
    result,
  }
}

function toFreeMatchEntry(freeMatch: UserFreeMatchResult): JournalEntry {
  return {
    kind: 'free_match',
    key: `free_match:${freeMatch.matchId}`,
    playedOn: freeMatch.playedOn,
    recordedAt: freeMatch.createdAt,
    freeMatch,
  }
}

// Ordre décroissant : jour de jeu, puis moment d'enregistrement (les ISO
// se comparent comme du texte).
function compareJournalEntriesDesc(
  firstEntry: JournalEntry,
  secondEntry: JournalEntry,
): number {
  return (
    secondEntry.playedOn.localeCompare(firstEntry.playedOn)
    || secondEntry.recordedAt.localeCompare(firstEntry.recordedAt)
  )
}

export function buildUnifiedJournal(
  results: UserTournamentResult[],
  freeMatches: UserFreeMatchResult[],
): JournalEntry[] {
  const entries = [
    ...results.map(toTournamentEntry),
    ...freeMatches.map(toFreeMatchEntry),
  ]
  return entries.sort(compareJournalEntriesDesc)
}

export function filterJournal(
  entries: JournalEntry[],
  filter: JournalFilter,
): JournalEntry[] {
  if (filter === 'all') return entries
  const kindToKeep = filter === 'tournaments' ? 'tournament' : 'free_match'
  return entries.filter(entry => entry.kind === kindToKeep)
}
