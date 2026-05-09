import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
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
// setup pour récupérer l'utilisateur courant (peuplement de ownerId à
// la création). Forme alignée sur le runtime de @nuxtjs/supabase :
// un JwtPayload (champ `sub`), PAS un User (champ `id`). Si le stub
// utilisait `.id`, un store buggé qui lit `.id` passerait à tort.
const stubUserRef = vi.hoisted(() => ({
  value: { sub: '99999999-9999-4999-8999-999999999999' } as { sub: string } | null,
}))

// Stub mutable pour useSupabaseSession. Sert de déclencheur principal
// au watcher du store (cf. CLAUDE.md : la session est hydratée
// déterministiquement, contrairement à useSupabaseUser).
const stubSessionRef = vi.hoisted(() => ({
  value: { access_token: 'stub-token' } as { access_token: string } | null,
}))

// Sub renvoyé par le mock par défaut de getClaims(). DOIT être
// indépendant de stubUserRef pour pouvoir tester "user.value null +
// claims valides" (scénario magic-link). Valeur en dur (et non
// référence à STUB_USER_ID) parce que vi.hoisted est hissé au-dessus
// des `const` du fichier.
const stubClaimsSub = vi.hoisted(() => ({
  value: '99999999-9999-4999-8999-999999999999' as string | null,
}))

// Implémentation custom optionnelle de getClaims pour les tests qui
// ont besoin d'une promesse contrôlée manuellement (anti-race) ou
// d'une erreur. Si null, le mock par défaut utilise stubClaimsSub.
type GetClaimsResult
  = | { data: { claims: { sub: string }, header: object, signature: Uint8Array }, error: null }
  | { data: null, error: { message: string } }
  | { data: null, error: null }
const stubGetClaimsImpl = vi.hoisted(() => ({
  fn: null as null | (() => Promise<GetClaimsResult>),
}))

const supabaseClientStub = vi.hoisted(() => ({
  auth: {
    getClaims: vi.fn(async (): Promise<GetClaimsResult> => {
      if (stubGetClaimsImpl.fn !== null) return stubGetClaimsImpl.fn()
      const sub = stubClaimsSub.value
      if (sub === null) return { data: null, error: null }
      return {
        data: {
          claims: { sub },
          header: {},
          signature: new Uint8Array(),
        },
        error: null,
      }
    }),
  },
}))

vi.stubGlobal('useSupabaseClient', () => supabaseClientStub)
vi.stubGlobal('useSupabaseUser', () => stubUserRef)
vi.stubGlobal('useSupabaseSession', () => stubSessionRef)

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
  stubSessionRef.value = { access_token: 'stub-token' }
  stubClaimsSub.value = STUB_USER_ID
  stubGetClaimsImpl.fn = null
  supabaseClientStub.auth.getClaims.mockClear()
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

  it('myTournaments and publicTournaments are empty when session is null (logout)', async () => {
    stubSessionRef.value = null
    stubUserRef.value = null
    stubClaimsSub.value = null
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
    // Mount sans user, sans session, sans claims : currentUserId reste
    // null donc isOwnerOfCurrentTournament aussi, même si un tournoi
    // a été chargé via loadTournament (qui n'a pas de dépendance
    // d'identité côté store).
    stubUserRef.value = null
    stubSessionRef.value = null
    stubClaimsSub.value = null
    const someTournament = makeTournament({ ownerId: STUB_USER_ID })
    await mockRepositoryRef.current!.saveTournament(someTournament)
    const store = useTournamentStore()
    await store.loadTournament(someTournament.id)

    expect(store.isOwnerOfCurrentTournament).toBe(false)
  })
})

describe('useTournamentStore — auth context (session/sub watcher)', () => {
  it('loads tournaments via session watcher even when user.value is null at mount (magic-link scenario)', async () => {
    // Simule l'arrivée sur / juste après un magic-link : la session est
    // hydratée, useSupabaseUser ne l'est pas encore (cf. CLAUDE.md).
    // Le store doit retomber sur getClaims() pour résoudre le sub et
    // déclencher le fetch — sans intervention de la home.
    stubUserRef.value = null
    stubSessionRef.value = { access_token: 'magic-link-token' }
    stubClaimsSub.value = STUB_USER_ID

    await mockRepositoryRef.current!.saveTournament(
      makeTournament({ name: 'Mine private', ownerId: STUB_USER_ID }),
    )

    const store = useTournamentStore()
    await flushPromises()

    expect(supabaseClientStub.auth.getClaims).toHaveBeenCalledTimes(1)
    expect(store.tournaments).toHaveLength(1)
    expect(store.hasFetchedTournaments).toBe(true)
    expect(store.lastLoadTournamentsError).toBeNull()
    expect(store.myTournaments).toHaveLength(1)
    expect(store.myTournaments[0]!.name).toBe('Mine private')
  })

  it('prefers user.value.sub over getClaims when both are available (hot path)', async () => {
    // Cas nominal après navigation : useSupabaseUser est hydraté. On
    // ne doit pas appeler getClaims(), c'est un coût inutile sur le
    // chemin chaud.
    stubUserRef.value = { sub: STUB_USER_ID }
    stubSessionRef.value = { access_token: 'stub-token' }
    stubClaimsSub.value = STUB_USER_ID

    const store = useTournamentStore()
    await flushPromises()

    expect(supabaseClientStub.auth.getClaims).not.toHaveBeenCalled()
    expect(store.hasFetchedTournaments).toBe(true)
  })

  it('refetches tournaments after the sub changes (account switch via retry)', async () => {
    // Phase 1 : user A connecté, fetch initial via le watcher immediate.
    const USER_A = STUB_USER_ID
    const USER_B = '11111111-1111-4111-8111-111111111111'
    stubUserRef.value = { sub: USER_A }
    await mockRepositoryRef.current!.saveTournament(
      makeTournament({ name: 'Tournoi de A', ownerId: USER_A }),
    )
    const repoSpy = vi.spyOn(mockRepositoryRef.current!, 'getAllTournaments')

    const store = useTournamentStore()
    await flushPromises()
    expect(repoSpy).toHaveBeenCalledTimes(1)

    // Phase 2 : on bascule sur user B et on re-déclenche l'orchestration
    // identité+fetch. Comme les stubs ne sont pas des Vue refs, le
    // watcher composé ne refire pas tout seul ; on appelle l'action
    // publique manuellement (chemin emprunté par le bouton "Réessayer"
    // de la home, conceptuellement équivalent au refire watcher en prod).
    stubUserRef.value = { sub: USER_B }
    stubClaimsSub.value = USER_B
    await mockRepositoryRef.current!.saveTournament(
      makeTournament({ name: 'Tournoi de B', ownerId: USER_B }),
    )

    await store.loadTournamentsForCurrentSession()

    // Le re-fetch a bien eu lieu : la garde d'idempotence
    // (resolvedUserId === sub && hasFetched) n'a pas court-circuité,
    // car le sub a changé. Le store reflète le nouveau dataset repo
    // (en prod c'est RLS DB qui filtre par owner ; ici le mock sert
    // tout, la partition est testée par le bloc "visibility partition").
    expect(repoSpy).toHaveBeenCalledTimes(2)
    expect(store.tournaments.map(tournament => tournament.name).sort()).toEqual([
      'Tournoi de A',
      'Tournoi de B',
    ])
  })

  it('surfaces an error when getClaims fails', async () => {
    stubUserRef.value = null
    stubGetClaimsImpl.fn = async () => ({
      data: null,
      error: { message: 'Network error during getClaims' },
    })

    const store = useTournamentStore()
    await flushPromises()

    expect(store.lastLoadTournamentsError).not.toBeNull()
    expect((store.lastLoadTournamentsError as Error).message).toBe(
      'Network error during getClaims',
    )
    expect(store.hasFetchedTournaments).toBe(false)
    expect(store.tournaments).toHaveLength(0)
  })

  it('surfaces an error when claims sub is missing', async () => {
    // Cas où getClaims retourne data: null + error: null (le 3e cas
    // de l'union, "pas de session connue côté client"). Le watcher
    // doit tomber sur le branch "Identité utilisateur introuvable".
    stubUserRef.value = null
    stubClaimsSub.value = null

    const store = useTournamentStore()
    await flushPromises()

    expect(store.lastLoadTournamentsError).not.toBeNull()
    expect((store.lastLoadTournamentsError as Error).message).toBe(
      'Identité utilisateur introuvable dans la session.',
    )
    expect(store.hasFetchedTournaments).toBe(false)
    expect(store.tournaments).toHaveLength(0)
  })

  it('ignores a late getClaims response when a newer auth resolution started in the meantime (anti-race)', async () => {
    // Scénario : le watcher fire post-mount avec user.value null,
    // déclenche un getClaims() qui reste pendu ; un 2e appel survient
    // (ex : retry, ou re-fire suite à un changement de session). Le
    // 1er, en revenant, doit voir que le token a été bumpé et exit
    // sans rien écrire. Sinon : risque d'écrire resolvedUserId d'une
    // session obsolète et de fuiter des tournois entre comptes.
    stubUserRef.value = null
    const claimsResolvers: Array<(value: GetClaimsResult) => void> = []
    stubGetClaimsImpl.fn = () =>
      new Promise<GetClaimsResult>((resolve) => {
        claimsResolvers.push(resolve)
      })

    await mockRepositoryRef.current!.saveTournament(
      makeTournament({ name: 'Tournoi cible', ownerId: STUB_USER_ID }),
    )
    const repoSpy = vi.spyOn(mockRepositoryRef.current!, 'getAllTournaments')

    const store = useTournamentStore()
    // Laisse le watcher immediate démarrer le 1er appel.
    await Promise.resolve()
    expect(claimsResolvers).toHaveLength(1)

    // 2e appel concurrent. Bumpe le token interne du store.
    const secondCall = store.loadTournamentsForCurrentSession()
    await Promise.resolve()
    expect(claimsResolvers).toHaveLength(2)

    // Réponse "tardive" du 1er getClaims. Doit être ignorée.
    claimsResolvers[0]!({
      data: {
        claims: { sub: STUB_USER_ID },
        header: {},
        signature: new Uint8Array(),
      },
      error: null,
    })
    await flushPromises()
    expect(repoSpy).not.toHaveBeenCalled()

    // Réponse du 2e getClaims. C'est lui qui doit déclencher le fetch.
    claimsResolvers[1]!({
      data: {
        claims: { sub: STUB_USER_ID },
        header: {},
        signature: new Uint8Array(),
      },
      error: null,
    })
    await secondCall
    expect(repoSpy).toHaveBeenCalledTimes(1)
    expect(store.tournaments).toHaveLength(1)
  })
})
