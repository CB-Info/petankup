import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { TournamentRepository } from '../../app/repositories/TournamentRepository'
import type { Match, Team, Tournament } from '../../app/types'

// Référence mutable hissée avant l'évaluation du `vi.mock`. Permet de
// régénérer un mock vierge dans chaque `beforeEach`, tout en laissant
// `createRepository()` (appelé par le store à l'init) renvoyer
// l'instance courante.
const mockRepositoryRef = vi.hoisted(() => ({
  current: null as TournamentRepository | null,
}))

vi.mock('../../app/repositories', () => ({
  createRepository: () => mockRepositoryRef.current!,
}))

// Import APRÈS le `vi.mock` pour la lisibilité (vitest hisse les deux
// de toute façon, donc l'ordre textuel est sans effet sur l'exécution).
import { useTournamentStore } from '../../app/stores/tournament'

const NOW = '2026-01-01T00:00:00.000Z'
const UUID_V4_REGEX
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function makeTournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: crypto.randomUUID(),
    name: 'Tournoi de test',
    date: NOW,
    format: 'round_robin',
    status: 'draft',
    ownerId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

// Mock en mémoire qui respecte le contrat TournamentRepository, y compris
// les cascades de suppression (tournament → teams + matches ;
// team → matches où elle apparaît). Reproduit le comportement de
// LocalStorageRepository sans toucher au stockage navigateur.
function createMockRepository(): TournamentRepository {
  let tournaments: Tournament[] = []
  let teams: Team[] = []
  let matches: Match[] = []

  function upsertById<T extends { id: string }>(items: T[], itemToUpsert: T): T[] {
    const existingIndex = items.findIndex(existing => existing.id === itemToUpsert.id)
    if (existingIndex === -1) return [...items, itemToUpsert]
    const updated = [...items]
    updated[existingIndex] = itemToUpsert
    return updated
  }

  return {
    getAllTournaments: () => [...tournaments],
    getTournamentById: id => tournaments.find(tournament => tournament.id === id),
    saveTournament: (tournament) => {
      tournaments = upsertById(tournaments, tournament)
    },
    deleteTournament: (id) => {
      tournaments = tournaments.filter(tournament => tournament.id !== id)
      teams = teams.filter(team => team.tournamentId !== id)
      matches = matches.filter(match => match.tournamentId !== id)
    },

    getTeamsByTournament: tournamentId => teams.filter(team => team.tournamentId === tournamentId),
    saveTeam: (team) => {
      teams = upsertById(teams, team)
    },
    deleteTeam: (id) => {
      teams = teams.filter(team => team.id !== id)
      matches = matches.filter(match => match.teamAId !== id && match.teamBId !== id)
    },

    getMatchesByTournament: tournamentId => matches.filter(match => match.tournamentId === tournamentId),
    saveMatch: (match) => {
      matches = upsertById(matches, match)
    },
    saveMatches: (matchesToSave) => {
      for (const matchToSave of matchesToSave) {
        matches = upsertById(matches, matchToSave)
      }
    },
  }
}

beforeEach(() => {
  mockRepositoryRef.current = createMockRepository()
  setActivePinia(createPinia())
})

describe('useTournamentStore — tournaments', () => {
  it('createTournament: returns a draft tournament with a UUID and timestamps, and pushes it to the list', () => {
    const store = useTournamentStore()

    const created = store.createTournament({
      name: 'Tournoi du dimanche',
      date: NOW,
      format: 'round_robin',
    })

    expect(created.status).toBe('draft')
    expect(created.id).toMatch(UUID_V4_REGEX)
    expect(created.createdAt).not.toBe('')
    expect(created.updatedAt).not.toBe('')
    expect(created.ownerId).toBeNull()
    expect(store.tournaments).toHaveLength(1)
    expect(store.tournaments[0]).toEqual(created)
  })

  it('loadTournaments: loads all tournaments persisted in the repository', () => {
    const firstTournament = makeTournament({ name: 'Premier' })
    const secondTournament = makeTournament({ name: 'Second' })
    mockRepositoryRef.current!.saveTournament(firstTournament)
    mockRepositoryRef.current!.saveTournament(secondTournament)

    const store = useTournamentStore()
    store.loadTournaments()

    expect(store.tournaments).toHaveLength(2)
    expect(store.tournaments.map(tournament => tournament.name).sort()).toEqual([
      'Premier',
      'Second',
    ])
  })

  it('deleteTournament: removes the tournament and resets currentTournament if it was loaded', () => {
    const store = useTournamentStore()
    const created = store.createTournament({
      name: 'À supprimer',
      date: NOW,
      format: 'round_robin',
    })
    store.loadTournament(created.id)
    expect(store.currentTournament).not.toBeNull()

    store.deleteTournament(created.id)

    expect(store.tournaments).toHaveLength(0)
    expect(store.currentTournament).toBeNull()
    expect(store.teams).toHaveLength(0)
    expect(store.matches).toHaveLength(0)
  })
})

describe('useTournamentStore — teams', () => {
  it('addTeam: adds three teams reactively to the current tournament', () => {
    const store = useTournamentStore()
    const created = store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    store.loadTournament(created.id)

    store.addTeam({ name: 'Les Boulistes', players: ['Alice', 'Bob'] })
    store.addTeam({ name: 'Les Pointus', players: ['Carla', 'Diego'] })
    store.addTeam({ name: 'Les Tireurs', players: ['Eva', 'Farid'] })

    expect(store.teams).toHaveLength(3)
    for (const team of store.teams) {
      expect(team.id).toMatch(UUID_V4_REGEX)
      expect(team.tournamentId).toBe(created.id)
    }
  })

  it('deleteTeam: removes the team and decrements teams.length', () => {
    const store = useTournamentStore()
    const created = store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    store.loadTournament(created.id)
    store.addTeam({ name: 'Équipe A', players: ['Alice'] })
    const teamToDelete = store.addTeam({ name: 'Équipe B', players: ['Bob'] })
    store.addTeam({ name: 'Équipe C', players: ['Carla'] })

    store.deleteTeam(teamToDelete.id)

    expect(store.teams).toHaveLength(2)
    expect(store.teams.find(team => team.id === teamToDelete.id)).toBeUndefined()
  })
})

describe('useTournamentStore — matches', () => {
  function setupTournamentWithFourTeams() {
    const store = useTournamentStore()
    const created = store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    store.loadTournament(created.id)
    store.addTeam({ name: 'A', players: ['Alice'] })
    store.addTeam({ name: 'B', players: ['Bob'] })
    store.addTeam({ name: 'C', players: ['Carla'] })
    store.addTeam({ name: 'D', players: ['Diego'] })
    return { store, tournamentId: created.id }
  }

  it('generateMatches: 4 teams → 6 matches, and the tournament moves to in_progress', () => {
    const { store, tournamentId } = setupTournamentWithFourTeams()

    store.generateMatches()

    expect(store.matches).toHaveLength(6)
    expect(store.currentTournament?.status).toBe('in_progress')
    expect(mockRepositoryRef.current!.getTournamentById(tournamentId)?.status).toBe('in_progress')
  })

  it('submitScore: a valid score completes the match and recomputes the ranking', () => {
    const { store } = setupTournamentWithFourTeams()
    store.generateMatches()
    const matchToScore = store.matches[0]!

    const result = store.submitScore(matchToScore.id, 13, 7)

    expect(result.valid).toBe(true)
    const updatedMatch = store.matches.find(match => match.id === matchToScore.id)!
    expect(updatedMatch.status).toBe('completed')
    expect(updatedMatch.scoreA).toBe(13)
    expect(updatedMatch.scoreB).toBe(7)
    expect(updatedMatch.winnerId).toBe(matchToScore.teamAId)
    const winnerRanking = store.ranking.find(rank => rank.teamId === matchToScore.teamAId)
    expect(winnerRanking?.wins).toBe(1)
  })

  it('submitScore: an invalid score (13-13) is rejected and leaves the match unchanged', () => {
    const { store } = setupTournamentWithFourTeams()
    store.generateMatches()
    const matchToScore = store.matches[0]!

    const result = store.submitScore(matchToScore.id, 13, 13)

    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
    const unchangedMatch = store.matches.find(match => match.id === matchToScore.id)!
    expect(unchangedMatch.status).toBe('pending')
    expect(unchangedMatch.scoreA).toBeNull()
    expect(unchangedMatch.scoreB).toBeNull()
  })
})

describe('useTournamentStore — completeTournament', () => {
  it('returns true and marks the tournament completed when every match is completed', () => {
    const store = useTournamentStore()
    const created = store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    store.loadTournament(created.id)
    store.addTeam({ name: 'A', players: ['Alice'] })
    store.addTeam({ name: 'B', players: ['Bob'] })
    store.generateMatches()
    expect(store.matches).toHaveLength(1)
    store.submitScore(store.matches[0]!.id, 13, 5)

    const result = store.completeTournament()

    expect(result).toBe(true)
    expect(store.currentTournament?.status).toBe('completed')
  })

  it('returns false and leaves the status unchanged when at least one match is still pending', () => {
    const store = useTournamentStore()
    const created = store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    store.loadTournament(created.id)
    store.addTeam({ name: 'A', players: ['Alice'] })
    store.addTeam({ name: 'B', players: ['Bob'] })
    store.addTeam({ name: 'C', players: ['Carla'] })
    store.addTeam({ name: 'D', players: ['Diego'] })
    store.generateMatches()
    store.submitScore(store.matches[0]!.id, 13, 4)

    const result = store.completeTournament()

    expect(result).toBe(false)
    expect(store.currentTournament?.status).toBe('in_progress')
  })
})
