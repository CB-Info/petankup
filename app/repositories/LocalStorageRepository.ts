import type { Match, Team, Tournament } from '../types'
import type { TournamentRepository } from './TournamentRepository'

const TOURNAMENTS_KEY = 'tournaments'
const TEAMS_KEY = 'teams'
const MATCHES_KEY = 'matches'

export class LocalStorageRepository implements TournamentRepository {
  // --- Tournaments ---

  getAllTournaments(): Tournament[] {
    return readArrayFromStorage<Tournament>(TOURNAMENTS_KEY)
  }

  getTournamentById(id: string): Tournament | undefined {
    return this.getAllTournaments().find(tournament => tournament.id === id)
  }

  saveTournament(tournament: Tournament): void {
    const allTournaments = this.getAllTournaments()
    const updatedTournaments = upsertById(allTournaments, tournament)
    writeArrayToStorage(TOURNAMENTS_KEY, updatedTournaments)
  }

  // Suppression en cascade : on retire le tournoi puis toutes ses équipes
  // et tous ses matchs. Évite de laisser des orphelins en localStorage.
  deleteTournament(id: string): void {
    const remainingTournaments = this.getAllTournaments()
      .filter(tournament => tournament.id !== id)
    writeArrayToStorage(TOURNAMENTS_KEY, remainingTournaments)

    const remainingTeams = readArrayFromStorage<Team>(TEAMS_KEY)
      .filter(team => team.tournamentId !== id)
    writeArrayToStorage(TEAMS_KEY, remainingTeams)

    const remainingMatches = readArrayFromStorage<Match>(MATCHES_KEY)
      .filter(match => match.tournamentId !== id)
    writeArrayToStorage(MATCHES_KEY, remainingMatches)
  }

  // --- Teams ---

  getTeamsByTournament(tournamentId: string): Team[] {
    return readArrayFromStorage<Team>(TEAMS_KEY)
      .filter(team => team.tournamentId === tournamentId)
  }

  saveTeam(team: Team): void {
    const allTeams = readArrayFromStorage<Team>(TEAMS_KEY)
    const updatedTeams = upsertById(allTeams, team)
    writeArrayToStorage(TEAMS_KEY, updatedTeams)
  }

  // Suppression en cascade : on retire l'équipe puis tous les matchs
  // dont elle est l'un des deux participants (côté A ou côté B).
  deleteTeam(id: string): void {
    const remainingTeams = readArrayFromStorage<Team>(TEAMS_KEY)
      .filter(team => team.id !== id)
    writeArrayToStorage(TEAMS_KEY, remainingTeams)

    const remainingMatches = readArrayFromStorage<Match>(MATCHES_KEY)
      .filter(match => match.teamAId !== id && match.teamBId !== id)
    writeArrayToStorage(MATCHES_KEY, remainingMatches)
  }

  // --- Matches ---

  getMatchesByTournament(tournamentId: string): Match[] {
    return readArrayFromStorage<Match>(MATCHES_KEY)
      .filter(match => match.tournamentId === tournamentId)
  }

  saveMatch(match: Match): void {
    const allMatches = readArrayFromStorage<Match>(MATCHES_KEY)
    const updatedMatches = upsertById(allMatches, match)
    writeArrayToStorage(MATCHES_KEY, updatedMatches)
  }

  // Upsert en lot : un seul read et un seul write, peu importe le nombre
  // de matchs. Évite les N accès localStorage de la version naïve
  // (utile quand `generateRoundRobinMatches` génère 6+ matchs d'un coup).
  saveMatches(matches: Match[]): void {
    let updatedMatches = readArrayFromStorage<Match>(MATCHES_KEY)
    for (const matchToUpsert of matches) {
      updatedMatches = upsertById(updatedMatches, matchToUpsert)
    }
    writeArrayToStorage(MATCHES_KEY, updatedMatches)
  }
}

// --- Helpers privés au module ---

// Lit la valeur stockée pour `key` et la parse comme un tableau de T.
// Renvoie un tableau vide si :
//   - localStorage n'existe pas (contexte SSR / non-navigateur)
//   - la clé n'existe pas encore
//   - la valeur n'est pas un JSON valide ou pas un tableau
function readArrayFromStorage<T>(key: string): T[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const rawValue = localStorage.getItem(key)
    if (rawValue === null) return []
    const parsedValue = JSON.parse(rawValue)
    return Array.isArray(parsedValue) ? parsedValue : []
  }
  catch (error) {
    console.warn(
      `[LocalStorageRepository] Lecture impossible pour la clé "${key}":`,
      error,
    )
    return []
  }
}

// Écrit `items` dans localStorage sous `key`, sérialisé en JSON.
// Échoue silencieusement (avec un warn) si :
//   - localStorage n'existe pas
//   - le quota est dépassé ou le mode privé bloque l'écriture
function writeArrayToStorage<T>(key: string, items: T[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(items))
  }
  catch (error) {
    console.warn(
      `[LocalStorageRepository] Écriture impossible pour la clé "${key}":`,
      error,
    )
  }
}

// Upsert immutable par `id` : remplace l'élément existant si trouvé,
// sinon ajoute en queue. Renvoie un nouveau tableau, ne mute pas l'entrée.
function upsertById<T extends { id: string }>(
  items: T[],
  itemToUpsert: T,
): T[] {
  const existingIndex = items.findIndex(
    existing => existing.id === itemToUpsert.id,
  )
  if (existingIndex === -1) {
    return [...items, itemToUpsert]
  }
  const updatedItems = [...items]
  updatedItems[existingIndex] = itemToUpsert
  return updatedItems
}
