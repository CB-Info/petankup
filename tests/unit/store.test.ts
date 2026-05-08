import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { TournamentRepository } from '../../app/repositories/TournamentRepository'
import type { Match, Team, Tournament } from '../../app/types'

const STUB_USER_ID = '99999999-9999-4999-8999-999999999999'

// Référence mutable hissée avant l'évaluation du `vi.mock`. Permet de
// régénérer un mock vierge dans chaque `beforeEach`, tout en laissant
// `createRepository()` (appelé par le store à l'init) renvoyer
// l'instance courante.
const mockRepositoryRef = vi.hoisted(() => ({
  current: null as TournamentRepository | null,
}))

// Stub mutable pour useSupabaseUser. Le store appelle ce composable au
// setup pour récupérer l'utilisateur courant (utilisé dans createTournament
// pour peupler ownerId). La forme du stub matche celle exposée à runtime
// par @nuxtjs/supabase : un JwtPayload (champ `sub`), PAS un User
// (champ `id`). Le store lit `user.value.sub`. Si le stub utilisait `id`,
// le test passerait à tort en cohérence avec un store buggé.
// On stub aussi useSupabaseClient mais sa valeur n'est jamais consommée
// puisque createRepository est mocké.
const stubUserRef = vi.hoisted(() => ({
  value: { sub: '99999999-9999-4999-8999-999999999999' } as { sub: string } | null,
}))
vi.stubGlobal('useSupabaseClient', () => ({}))
vi.stubGlobal('useSupabaseUser', () => stubUserRef)

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
    visibility: 'private',
    ownerId: STUB_USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

// Mock en mémoire qui respecte le contrat TournamentRepository, y compris
// les cascades de suppression (tournament → teams + matches ;
// team → matches où elle apparaît). Reproduit le comportement de
// SupabaseRepository (cascades DB) sans toucher au réseau.
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
    getAllTournaments: async () => [...tournaments],
    getTournamentById: async id => tournaments.find(tournament => tournament.id === id),
    saveTournament: async (tournament) => {
      tournaments = upsertById(tournaments, tournament)
    },
    deleteTournament: async (id) => {
      tournaments = tournaments.filter(tournament => tournament.id !== id)
      teams = teams.filter(team => team.tournamentId !== id)
      matches = matches.filter(match => match.tournamentId !== id)
    },

    getTeamsByTournament: async tournamentId => teams.filter(team => team.tournamentId === tournamentId),
    saveTeam: async (team) => {
      teams = upsertById(teams, team)
    },
    deleteTeam: async (id) => {
      teams = teams.filter(team => team.id !== id)
      matches = matches.filter(match => match.teamAId !== id && match.teamBId !== id)
    },

    getMatchesByTournament: async tournamentId => matches.filter(match => match.tournamentId === tournamentId),
    saveMatch: async (match) => {
      matches = upsertById(matches, match)
    },
    saveMatches: async (matchesToSave) => {
      for (const matchToSave of matchesToSave) {
        matches = upsertById(matches, matchToSave)
      }
    },
  }
}

beforeEach(() => {
  mockRepositoryRef.current = createMockRepository()
  stubUserRef.value = { sub: STUB_USER_ID }
  setActivePinia(createPinia())
})

describe('useTournamentStore — tournaments', () => {
  it('createTournament: returns a draft tournament with a UUID and timestamps, and pushes it to the list', async () => {
    const store = useTournamentStore()

    const created = await store.createTournament({
      name: 'Tournoi du dimanche',
      date: NOW,
      format: 'round_robin',
    })

    expect(created.status).toBe('draft')
    expect(created.id).toMatch(UUID_V4_REGEX)
    expect(created.createdAt).not.toBe('')
    expect(created.updatedAt).not.toBe('')
    expect(created.ownerId).toBe(STUB_USER_ID)
    expect(store.tournaments).toHaveLength(1)
    expect(store.tournaments[0]).toEqual(created)
  })

  it('createTournament: reads ownerId from useSupabaseUser().value.sub (JwtPayload), not .id', async () => {
    // Le runtime peuple useSupabaseUser avec un JwtPayload (champ `sub`),
    // pas un User (champ `id`). Si on régresse vers `.id`, ownerId
    // deviendrait undefined et le payload INSERT n'aurait pas owner_id,
    // ce qui casse RLS côté DB.
    const store = useTournamentStore()

    const created = await store.createTournament({
      name: 'Test',
      date: NOW,
      format: 'round_robin',
    })

    expect(created.ownerId).toBe(STUB_USER_ID)
    expect(created.ownerId).not.toBeUndefined()
  })

  it('createTournament: applies default visibility "private" when omitted', async () => {
    const store = useTournamentStore()

    const created = await store.createTournament({
      name: 'Default visibility',
      date: NOW,
      format: 'round_robin',
    })

    expect(created.visibility).toBe('private')
  })

  it('createTournament: respects an explicit visibility "public"', async () => {
    const store = useTournamentStore()

    const created = await store.createTournament({
      name: 'Public tournament',
      date: NOW,
      format: 'round_robin',
      visibility: 'public',
    })

    expect(created.visibility).toBe('public')
  })

  it('loadTournaments: loads all tournaments persisted in the repository', async () => {
    const firstTournament = makeTournament({ name: 'Premier' })
    const secondTournament = makeTournament({ name: 'Second' })
    await mockRepositoryRef.current!.saveTournament(firstTournament)
    await mockRepositoryRef.current!.saveTournament(secondTournament)

    const store = useTournamentStore()
    await store.loadTournaments()

    expect(store.tournaments).toHaveLength(2)
    expect(store.tournaments.map(tournament => tournament.name).sort()).toEqual([
      'Premier',
      'Second',
    ])
  })

  it('deleteTournament: removes the tournament and resets currentTournament if it was loaded', async () => {
    const store = useTournamentStore()
    const created = await store.createTournament({
      name: 'À supprimer',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournament(created.id)
    expect(store.currentTournament).not.toBeNull()

    await store.deleteTournament(created.id)

    expect(store.tournaments).toHaveLength(0)
    expect(store.currentTournament).toBeNull()
    expect(store.teams).toHaveLength(0)
    expect(store.matches).toHaveLength(0)
  })
})

describe('useTournamentStore — teams', () => {
  it('addTeam: adds three teams reactively to the current tournament', async () => {
    const store = useTournamentStore()
    const created = await store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournament(created.id)

    await store.addTeam({ name: 'Les Boulistes', players: ['Alice', 'Bob'] })
    await store.addTeam({ name: 'Les Pointus', players: ['Carla', 'Diego'] })
    await store.addTeam({ name: 'Les Tireurs', players: ['Eva', 'Farid'] })

    expect(store.teams).toHaveLength(3)
    for (const team of store.teams) {
      expect(team.id).toMatch(UUID_V4_REGEX)
      expect(team.tournamentId).toBe(created.id)
    }
  })

  it('deleteTeam: removes the team and decrements teams.length', async () => {
    const store = useTournamentStore()
    const created = await store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournament(created.id)
    await store.addTeam({ name: 'Équipe A', players: ['Alice'] })
    const teamToDelete = await store.addTeam({ name: 'Équipe B', players: ['Bob'] })
    await store.addTeam({ name: 'Équipe C', players: ['Carla'] })

    await store.deleteTeam(teamToDelete.id)

    expect(store.teams).toHaveLength(2)
    expect(store.teams.find(team => team.id === teamToDelete.id)).toBeUndefined()
  })
})

describe('useTournamentStore — matches', () => {
  async function setupTournamentWithFourTeams() {
    const store = useTournamentStore()
    const created = await store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournament(created.id)
    await store.addTeam({ name: 'A', players: ['Alice'] })
    await store.addTeam({ name: 'B', players: ['Bob'] })
    await store.addTeam({ name: 'C', players: ['Carla'] })
    await store.addTeam({ name: 'D', players: ['Diego'] })
    return { store, tournamentId: created.id }
  }

  it('generateMatches: 4 teams → 6 matches, and the tournament moves to in_progress', async () => {
    const { store, tournamentId } = await setupTournamentWithFourTeams()

    await store.generateMatches()

    expect(store.matches).toHaveLength(6)
    expect(store.currentTournament?.status).toBe('in_progress')
    expect((await mockRepositoryRef.current!.getTournamentById(tournamentId))?.status).toBe('in_progress')
  })

  it('submitScore: a valid score completes the match and recomputes the ranking', async () => {
    const { store } = await setupTournamentWithFourTeams()
    await store.generateMatches()
    const matchToScore = store.matches[0]!

    const result = await store.submitScore(matchToScore.id, 13, 7)

    expect(result.valid).toBe(true)
    const updatedMatch = store.matches.find(match => match.id === matchToScore.id)!
    expect(updatedMatch.status).toBe('completed')
    expect(updatedMatch.scoreA).toBe(13)
    expect(updatedMatch.scoreB).toBe(7)
    expect(updatedMatch.winnerId).toBe(matchToScore.teamAId)
    const winnerRanking = store.ranking.find(rank => rank.teamId === matchToScore.teamAId)
    expect(winnerRanking?.wins).toBe(1)
  })

  it('submitScore: an invalid score (13-13) is rejected and leaves the match unchanged', async () => {
    const { store } = await setupTournamentWithFourTeams()
    await store.generateMatches()
    const matchToScore = store.matches[0]!

    const result = await store.submitScore(matchToScore.id, 13, 13)

    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
    const unchangedMatch = store.matches.find(match => match.id === matchToScore.id)!
    expect(unchangedMatch.status).toBe('pending')
    expect(unchangedMatch.scoreA).toBeNull()
    expect(unchangedMatch.scoreB).toBeNull()
  })
})

describe('useTournamentStore — completeTournament', () => {
  it('returns true and marks the tournament completed when every match is completed', async () => {
    const store = useTournamentStore()
    const created = await store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournament(created.id)
    await store.addTeam({ name: 'A', players: ['Alice'] })
    await store.addTeam({ name: 'B', players: ['Bob'] })
    await store.generateMatches()
    expect(store.matches).toHaveLength(1)
    await store.submitScore(store.matches[0]!.id, 13, 5)

    const result = await store.completeTournament()

    expect(result).toBe(true)
    expect(store.currentTournament?.status).toBe('completed')
  })

  it('returns false and leaves the status unchanged when at least one match is still pending', async () => {
    const store = useTournamentStore()
    const created = await store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournament(created.id)
    await store.addTeam({ name: 'A', players: ['Alice'] })
    await store.addTeam({ name: 'B', players: ['Bob'] })
    await store.addTeam({ name: 'C', players: ['Carla'] })
    await store.addTeam({ name: 'D', players: ['Diego'] })
    await store.generateMatches()
    await store.submitScore(store.matches[0]!.id, 13, 4)

    const result = await store.completeTournament()

    expect(result).toBe(false)
    expect(store.currentTournament?.status).toBe('in_progress')
  })
})

describe('useTournamentStore — visibility partition', () => {
  const OTHER_USER_ID = '00000000-0000-4000-8000-000000000000'

  it('myTournaments returns only tournaments owned by the current user', async () => {
    const store = useTournamentStore()
    const ownTournament = await store.createTournament({
      name: 'Mine',
      date: NOW,
      format: 'round_robin',
    })

    // Tournoi appartenant à un autre user, inséré directement via le
    // repository mocké pour bypasser createTournament qui force ownerId
    // au user courant.
    await mockRepositoryRef.current!.saveTournament(
      makeTournament({
        name: 'Theirs',
        ownerId: OTHER_USER_ID,
        visibility: 'public',
      }),
    )
    await store.loadTournaments()

    expect(store.myTournaments).toHaveLength(1)
    expect(store.myTournaments[0]!.id).toBe(ownTournament.id)
  })

  it('publicTournaments returns only public tournaments NOT owned by the current user', async () => {
    const store = useTournamentStore()

    await store.createTournament({
      name: 'Mine private',
      date: NOW,
      format: 'round_robin',
    })
    await store.createTournament({
      name: 'Mine public',
      date: NOW,
      format: 'round_robin',
      visibility: 'public',
    })

    await mockRepositoryRef.current!.saveTournament(
      makeTournament({
        name: 'Their public',
        ownerId: OTHER_USER_ID,
        visibility: 'public',
      }),
    )
    // Tournoi private d'un autre user : RLS l'aurait masqué côté DB.
    // Filtre JS doublé en sécurité.
    await mockRepositoryRef.current!.saveTournament(
      makeTournament({
        name: 'Their private',
        ownerId: OTHER_USER_ID,
        visibility: 'private',
      }),
    )
    await store.loadTournaments()

    expect(store.publicTournaments).toHaveLength(1)
    expect(store.publicTournaments[0]!.name).toBe('Their public')
  })

  it('myTournaments and publicTournaments are empty when user is null', async () => {
    stubUserRef.value = null
    const store = useTournamentStore()
    await mockRepositoryRef.current!.saveTournament(
      makeTournament({ visibility: 'public', ownerId: OTHER_USER_ID }),
    )
    await store.loadTournaments()

    expect(store.myTournaments).toHaveLength(0)
    expect(store.publicTournaments).toHaveLength(0)
  })
})

describe('useTournamentStore — setTournamentVisibility', () => {
  it('switches a tournament from private to public and persists it', async () => {
    const store = useTournamentStore()
    const created = await store.createTournament({
      name: 'À publier',
      date: NOW,
      format: 'round_robin',
    })
    expect(created.visibility).toBe('private')

    await store.setTournamentVisibility(created.id, 'public')

    const updated = store.tournaments.find(tournament => tournament.id === created.id)!
    expect(updated.visibility).toBe('public')

    const persisted = await mockRepositoryRef.current!.getTournamentById(created.id)
    expect(persisted?.visibility).toBe('public')
  })

  it('switches back from public to private', async () => {
    const store = useTournamentStore()
    const created = await store.createTournament({
      name: 'À reprivatiser',
      date: NOW,
      format: 'round_robin',
      visibility: 'public',
    })

    await store.setTournamentVisibility(created.id, 'private')

    const updated = store.tournaments.find(tournament => tournament.id === created.id)!
    expect(updated.visibility).toBe('private')
  })

  it('throws when the tournament is unknown', async () => {
    const store = useTournamentStore()
    await expect(
      store.setTournamentVisibility('does-not-exist', 'public'),
    ).rejects.toThrow('Tournoi introuvable')
  })
})

describe('useTournamentStore — isOwnerOfCurrentTournament', () => {
  const OTHER_USER_ID = '00000000-0000-4000-8000-000000000000'

  it('returns true when the current tournament is owned by the current user', async () => {
    const store = useTournamentStore()
    const created = await store.createTournament({
      name: 'Mine',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournament(created.id)

    expect(store.isOwnerOfCurrentTournament).toBe(true)
  })

  it('returns false when the current tournament is owned by someone else', async () => {
    const otherTournament = makeTournament({ ownerId: OTHER_USER_ID })
    await mockRepositoryRef.current!.saveTournament(otherTournament)
    const store = useTournamentStore()
    await store.loadTournament(otherTournament.id)

    expect(store.isOwnerOfCurrentTournament).toBe(false)
  })

  it('returns false when there is no current tournament loaded', () => {
    const store = useTournamentStore()

    expect(store.isOwnerOfCurrentTournament).toBe(false)
  })

  it('returns false when there is no authenticated user', async () => {
    const store = useTournamentStore()
    const created = await store.createTournament({
      name: 'Mine',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournament(created.id)
    stubUserRef.value = null

    expect(store.isOwnerOfCurrentTournament).toBe(false)
  })
})
