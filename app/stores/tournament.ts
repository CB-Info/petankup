import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createRepository } from '../repositories'
import type { TournamentRepository } from '../repositories'
import type {
  Match,
  Ranking,
  ScoreValidationResult,
  Team,
  Tournament,
} from '../types'
import {
  computeRanking,
  generateRoundRobinMatches,
  validateScore,
} from '../utils/tournament'

type CreateTournamentInput = Omit<
  Tournament,
  'id' | 'status' | 'ownerId' | 'createdAt' | 'updatedAt'
>

type AddTeamInput = {
  name: string
  players: string[]
}

export const useTournamentStore = defineStore('tournament', () => {
  // Repository instancié une fois par store et non exposé : toute la
  // persistance passe par lui (cf. CLAUDE.md > pattern Repository).
  const repository: TournamentRepository = createRepository()

  const tournaments = ref<Tournament[]>([])
  const currentTournament = ref<Tournament | null>(null)
  const teams = ref<Team[]>([])
  const matches = ref<Match[]>([])
  const ranking = ref<Ranking[]>([])

  function nowIso(): string {
    return new Date().toISOString()
  }

  // Garde commune aux actions qui ne font sens que sur un tournoi chargé
  // (addTeam, generateMatches, submitScore, completeTournament). Lever
  // une erreur tôt évite de produire des entités orphelines.
  function requireCurrentTournament(): Tournament {
    if (currentTournament.value === null) {
      throw new Error('Aucun tournoi courant chargé')
    }
    return currentTournament.value
  }

  function replaceTournamentInList(updatedTournament: Tournament): void {
    const tournamentIndex = tournaments.value.findIndex(
      tournament => tournament.id === updatedTournament.id,
    )
    if (tournamentIndex !== -1) {
      tournaments.value[tournamentIndex] = updatedTournament
    }
  }

  function syncCurrentTournamentIfMatches(updatedTournament: Tournament): void {
    if (currentTournament.value?.id === updatedTournament.id) {
      currentTournament.value = updatedTournament
    }
  }

  function persistTournamentChange(updatedTournament: Tournament): void {
    repository.saveTournament(updatedTournament)
    replaceTournamentInList(updatedTournament)
    syncCurrentTournamentIfMatches(updatedTournament)
  }

  function loadTournaments(): void {
    tournaments.value = repository.getAllTournaments()
  }

  function createTournament(data: CreateTournamentInput): Tournament {
    const timestamp = nowIso()
    const newTournament: Tournament = {
      ...data,
      id: crypto.randomUUID(),
      status: 'draft',
      ownerId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    repository.saveTournament(newTournament)
    tournaments.value.push(newTournament)
    return newTournament
  }

  function loadTournament(id: string): void {
    const found = repository.getTournamentById(id)
    if (found === undefined) {
      currentTournament.value = null
      teams.value = []
      matches.value = []
      ranking.value = []
      return
    }
    currentTournament.value = found
    teams.value = repository.getTeamsByTournament(id)
    matches.value = repository.getMatchesByTournament(id)
    refreshRanking()
  }

  function updateTournament(tournament: Tournament): void {
    const updated: Tournament = { ...tournament, updatedAt: nowIso() }
    persistTournamentChange(updated)
  }

  function deleteTournament(id: string): void {
    repository.deleteTournament(id)
    tournaments.value = tournaments.value.filter(
      tournament => tournament.id !== id,
    )
    if (currentTournament.value?.id === id) {
      currentTournament.value = null
      teams.value = []
      matches.value = []
      ranking.value = []
    }
  }

  function addTeam(data: AddTeamInput): Team {
    const tournament = requireCurrentTournament()
    const timestamp = nowIso()
    const newTeam: Team = {
      id: crypto.randomUUID(),
      tournamentId: tournament.id,
      name: data.name,
      players: data.players,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    repository.saveTeam(newTeam)
    teams.value.push(newTeam)
    return newTeam
  }

  function updateTeam(team: Team): void {
    const updated: Team = { ...team, updatedAt: nowIso() }
    repository.saveTeam(updated)
    const teamIndex = teams.value.findIndex(existing => existing.id === updated.id)
    if (teamIndex !== -1) {
      teams.value[teamIndex] = updated
    }
  }

  function deleteTeam(id: string): void {
    const tournament = requireCurrentTournament()
    repository.deleteTeam(id)
    teams.value = teams.value.filter(team => team.id !== id)
    // La cascade côté repository a pu supprimer des matchs : on resynchronise
    // depuis la source de vérité plutôt que de filtrer en double.
    matches.value = repository.getMatchesByTournament(tournament.id)
    refreshRanking()
  }

  function generateMatches(): void {
    const tournament = requireCurrentTournament()
    const generatedMatches = generateRoundRobinMatches(
      teams.value,
      tournament.id,
      nowIso(),
    )
    repository.saveMatches(generatedMatches)
    matches.value = generatedMatches

    const tournamentInProgress: Tournament = {
      ...tournament,
      status: 'in_progress',
      updatedAt: nowIso(),
    }
    persistTournamentChange(tournamentInProgress)

    refreshRanking()
  }

  function submitScore(
    matchId: string,
    scoreA: number,
    scoreB: number,
  ): ScoreValidationResult {
    const validation = validateScore(scoreA, scoreB)
    if (!validation.valid) return validation

    const matchIndex = matches.value.findIndex(match => match.id === matchId)
    if (matchIndex === -1) {
      return { valid: false, error: 'Match introuvable.' }
    }

    const matchToUpdate = matches.value[matchIndex]!
    const updatedMatch: Match = {
      ...matchToUpdate,
      scoreA,
      scoreB,
      winnerId: scoreA > scoreB ? matchToUpdate.teamAId : matchToUpdate.teamBId,
      status: 'completed',
      updatedAt: nowIso(),
    }

    repository.saveMatch(updatedMatch)
    matches.value[matchIndex] = updatedMatch
    refreshRanking()

    return { valid: true }
  }

  function refreshRanking(): void {
    ranking.value = computeRanking(teams.value, matches.value)
  }

  function completeTournament(): boolean {
    const tournament = requireCurrentTournament()
    const hasPendingMatch = matches.value.some(
      match => match.status === 'pending',
    )
    if (hasPendingMatch) return false

    const completedTournament: Tournament = {
      ...tournament,
      status: 'completed',
      updatedAt: nowIso(),
    }
    persistTournamentChange(completedTournament)
    return true
  }

  loadTournaments()

  return {
    tournaments,
    currentTournament,
    teams,
    matches,
    ranking,
    loadTournaments,
    createTournament,
    loadTournament,
    updateTournament,
    deleteTournament,
    addTeam,
    updateTeam,
    deleteTeam,
    generateMatches,
    submitScore,
    refreshRanking,
    completeTournament,
  }
})
