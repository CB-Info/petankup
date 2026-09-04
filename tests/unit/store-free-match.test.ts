import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import type { TournamentRepository } from '../../app/repositories/TournamentRepository'
import type { CreateFreeMatchInput, FreeMatch } from '../../app/types'
import { FreeMatchError, InviteMemberError } from '../../app/types'

// Tests du store free-match (H2.b). Setup aligné sur
// tests/unit/store-profile-bundle.test.ts : stubs hoisted pour
// useSupabaseUser / useSupabaseSession / useSupabaseClient, mock du module
// `repositories` pour injecter un repo in-memory. L'identité est résolue par
// le store identity (instancié par le store free-match lui-même).

const STUB_USER_ID = '99999999-9999-4999-8999-999999999999'
const OTHER_USER_ID = '88888888-8888-4888-8888-888888888888'
const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_MATCH_ID = '22222222-2222-4222-8222-222222222222'
const NOW = '2026-01-01T00:00:00.000Z'

const mockRepositoryRef = vi.hoisted(() => ({
  current: null as TournamentRepository | null,
}))

const stubUserRef = vi.hoisted(() => ({
  value: { sub: '99999999-9999-4999-8999-999999999999' } as { sub: string } | null,
}))

const stubSessionRef = vi.hoisted(() => ({
  value: { access_token: 'stub-token' } as { access_token: string } | null,
}))

const stubClaimsSub = vi.hoisted(() => ({
  value: '99999999-9999-4999-8999-999999999999' as string | null,
}))

type GetClaimsResult
  = | { data: { claims: { sub: string }, header: object, signature: Uint8Array }, error: null }
  | { data: null, error: { message: string } }
  | { data: null, error: null }

const supabaseClientStub = vi.hoisted(() => ({
  auth: {
    getClaims: vi.fn(async (): Promise<GetClaimsResult> => {
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

import { useFreeMatchStore } from '../../app/stores/free-match'
import { useIdentityStore } from '../../app/stores/identity'

type FreeMatchMockRepository = TournamentRepository & {
  __getFreeMatchByIdSpy: ReturnType<typeof vi.fn>
  __createFreeMatchSpy: ReturnType<typeof vi.fn>
  __deleteFreeMatchSpy: ReturnType<typeof vi.fn>
}

// Repo in-memory minimal : seules les méthodes « match libre » sont
// espionnées. Le reste reste no-op — ces tests n'en dépendent pas.
function createMockRepository(overrides: Partial<{
  getFreeMatchById: (id: string) => Promise<FreeMatch | undefined>
  createFreeMatch: (input: CreateFreeMatchInput) => Promise<string>
  deleteFreeMatch: (id: string) => Promise<void>
}> = {}): FreeMatchMockRepository {
  const getFreeMatchByIdSpy = vi.fn(overrides.getFreeMatchById ?? (async () => undefined))
  const createFreeMatchSpy = vi.fn(overrides.createFreeMatch ?? (async () => MATCH_ID))
  const deleteFreeMatchSpy = vi.fn(overrides.deleteFreeMatch ?? (async () => {}))

  return {
    getAllTournaments: async () => [],
    getTournamentById: async () => undefined,
    createTournament: async () => {},
    updateTournament: async () => {},
    deleteTournament: async () => {},
    getTeamsByTournament: async () => [],
    createTeam: async () => {
      throw new Error('Not implemented in this test mock')
    },
    updateTeam: async () => {
      throw new Error('Not implemented in this test mock')
    },
    deleteTeam: async () => {},
    getMatchesByTournament: async () => [],
    createMatches: async () => {},
    updateMatch: async () => {},
    getMembersByTournament: async () => [],
    getMyMemberships: async () => [],
    inviteMemberByDisplayName: async () => {
      throw new InviteMemberError('unknown')
    },
    removeMember: async () => {},
    getMyProfile: async () => undefined,
    getProfilesByIds: async () => [],
    updateMyProfile: async () => {
      throw new Error('Not implemented in this test mock')
    },
    updateMyProfileVisibility: async () => {},
    getUserProfile: async () => ({ kind: 'not_found' as const }),
    getFreeMatchById: getFreeMatchByIdSpy,
    createFreeMatch: createFreeMatchSpy,
    deleteFreeMatch: deleteFreeMatchSpy,
    findAccountByDisplayName: async () => undefined,
    getFriendships: async () => ({ friends: [], received: [], sent: [] }),
    requestFriendship: async () => 'pending' as const,
    acceptFriendship: async () => {},
    refuseFriendship: async () => {},
    cancelFriendshipRequest: async () => {},
    removeFriendship: async () => {},
    __getFreeMatchByIdSpy: getFreeMatchByIdSpy,
    __createFreeMatchSpy: createFreeMatchSpy,
    __deleteFreeMatchSpy: deleteFreeMatchSpy,
  }
}

function makeFreeMatch(overrides: Partial<FreeMatch> = {}): FreeMatch {
  return {
    id: MATCH_ID,
    createdBy: STUB_USER_ID,
    playedOn: '2026-08-30',
    scoreA: 13,
    scoreB: 7,
    visibility: 'private',
    players: [
      {
        id: 'p-moi',
        matchId: MATCH_ID,
        side: 'A',
        userId: STUB_USER_ID,
        displayNameSnapshot: 'Moi',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'p-zoe',
        matchId: MATCH_ID,
        side: 'B',
        userId: null,
        displayNameSnapshot: 'Zoé',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const createInput: CreateFreeMatchInput = {
  playedOn: null,
  visibility: 'private',
  scoreA: 13,
  scoreB: 7,
  players: [
    { side: 'A', userId: STUB_USER_ID, displayName: 'Moi' },
    { side: 'B', userId: null, displayName: 'Zoé' },
  ],
}

function makeDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

// Fait basculer l'identité résolue vers `sub` (cf. store-profiles.test.ts).
async function switchIdentityTo(sub: string): Promise<void> {
  stubUserRef.value = { sub }
  stubClaimsSub.value = sub
  await useIdentityStore().resolveForCurrentSession()
}

beforeEach(() => {
  mockRepositoryRef.current = createMockRepository()
  stubUserRef.value = { sub: STUB_USER_ID }
  stubSessionRef.value = { access_token: 'stub-token' }
  stubClaimsSub.value = STUB_USER_ID
  supabaseClientStub.auth.getClaims.mockClear()
  setActivePinia(createPinia())
})

describe('loadFreeMatch', () => {
  it('exposes the loaded match and toggles isLoading around the request', async () => {
    const freeMatch = makeFreeMatch()
    const deferred = makeDeferred<FreeMatch | undefined>()
    const repo = createMockRepository({ getFreeMatchById: () => deferred.promise })
    mockRepositoryRef.current = repo
    const store = useFreeMatchStore()

    const loading = store.loadFreeMatch(MATCH_ID)
    expect(store.isLoading).toBe(true)
    deferred.resolve(freeMatch)
    await loading

    expect(store.isLoading).toBe(false)
    expect(store.currentFreeMatch).toEqual(freeMatch)
    expect(store.lastLoadFreeMatchError).toBeNull()
    expect(repo.__getFreeMatchByIdSpy).toHaveBeenCalledWith(MATCH_ID)
  })

  it('leaves currentFreeMatch null without error when the match is not visible', async () => {
    const store = useFreeMatchStore()

    await store.loadFreeMatch(MATCH_ID)

    expect(store.currentFreeMatch).toBeNull()
    expect(store.lastLoadFreeMatchError).toBeNull()
  })

  it('captures the error instead of throwing, and clears it on the next load', async () => {
    const failure = new Error('network down')
    let shouldFail = true
    mockRepositoryRef.current = createMockRepository({
      getFreeMatchById: async () => {
        if (shouldFail) throw failure
        return makeFreeMatch()
      },
    })
    const store = useFreeMatchStore()

    await store.loadFreeMatch(MATCH_ID)
    expect(store.lastLoadFreeMatchError).toBe(failure)
    expect(store.currentFreeMatch).toBeNull()

    shouldFail = false
    await store.loadFreeMatch(MATCH_ID)
    expect(store.lastLoadFreeMatchError).toBeNull()
    expect(store.currentFreeMatch?.id).toBe(MATCH_ID)
  })

  it('clears the previous match at the start of a new load (no flash of stale data)', async () => {
    const deferred = makeDeferred<FreeMatch | undefined>()
    let callCount = 0
    mockRepositoryRef.current = createMockRepository({
      getFreeMatchById: async () => {
        callCount += 1
        if (callCount === 1) return makeFreeMatch()
        return deferred.promise
      },
    })
    const store = useFreeMatchStore()

    await store.loadFreeMatch(MATCH_ID)
    expect(store.currentFreeMatch).not.toBeNull()

    const secondLoad = store.loadFreeMatch(OTHER_MATCH_ID)
    expect(store.currentFreeMatch).toBeNull()
    deferred.resolve(makeFreeMatch({ id: OTHER_MATCH_ID }))
    await secondLoad
    expect(store.currentFreeMatch?.id).toBe(OTHER_MATCH_ID)
  })

  it('ignores the late response of a superseded load (race between two loads)', async () => {
    const firstDeferred = makeDeferred<FreeMatch | undefined>()
    const secondDeferred = makeDeferred<FreeMatch | undefined>()
    mockRepositoryRef.current = createMockRepository({
      getFreeMatchById: async (id) => {
        return id === MATCH_ID ? firstDeferred.promise : secondDeferred.promise
      },
    })
    const store = useFreeMatchStore()

    const firstLoad = store.loadFreeMatch(MATCH_ID)
    const secondLoad = store.loadFreeMatch(OTHER_MATCH_ID)
    secondDeferred.resolve(makeFreeMatch({ id: OTHER_MATCH_ID }))
    await secondLoad
    firstDeferred.resolve(makeFreeMatch({ id: MATCH_ID }))
    await firstLoad

    expect(store.currentFreeMatch?.id).toBe(OTHER_MATCH_ID)
  })

  it('drops the response when the identity changed during the request', async () => {
    const deferred = makeDeferred<FreeMatch | undefined>()
    mockRepositoryRef.current = createMockRepository({
      getFreeMatchById: () => deferred.promise,
    })
    const store = useFreeMatchStore()

    const loading = store.loadFreeMatch(MATCH_ID)
    await switchIdentityTo(OTHER_USER_ID)
    deferred.resolve(makeFreeMatch())
    await loading

    expect(store.currentFreeMatch).toBeNull()
  })

  it('is a no-op without a resolved identity', async () => {
    stubUserRef.value = null
    stubClaimsSub.value = null
    const repo = createMockRepository()
    mockRepositoryRef.current = repo
    const store = useFreeMatchStore()
    await flushPromises()

    await store.loadFreeMatch(MATCH_ID)

    expect(repo.__getFreeMatchByIdSpy).not.toHaveBeenCalled()
    expect(store.currentFreeMatch).toBeNull()
  })
})

describe('createFreeMatch', () => {
  it('passes the input to the repository and returns the created id', async () => {
    const repo = createMockRepository()
    mockRepositoryRef.current = repo
    const store = useFreeMatchStore()

    const createdId = await store.createFreeMatch(createInput)

    expect(createdId).toBe(MATCH_ID)
    expect(repo.__createFreeMatchSpy).toHaveBeenCalledWith(createInput)
    expect(store.isLoading).toBe(false)
  })

  it('lets a typed FreeMatchError through unchanged (the page dispatches on its code)', async () => {
    mockRepositoryRef.current = createMockRepository({
      createFreeMatch: async () => {
        throw new FreeMatchError('invalid_score')
      },
    })
    const store = useFreeMatchStore()

    let caught: unknown = null
    try {
      await store.createFreeMatch(createInput)
    }
    catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(FreeMatchError)
    expect((caught as FreeMatchError).code).toBe('invalid_score')
    expect(store.isLoading).toBe(false)
  })

  it('throws without an authenticated identity and never calls the repository', async () => {
    stubUserRef.value = null
    stubClaimsSub.value = null
    const repo = createMockRepository()
    mockRepositoryRef.current = repo
    const store = useFreeMatchStore()
    await flushPromises()

    await expect(store.createFreeMatch(createInput)).rejects.toThrow('Aucun utilisateur authentifié')
    expect(repo.__createFreeMatchSpy).not.toHaveBeenCalled()
  })
})

describe('deleteFreeMatch', () => {
  it('deletes through the repository and clears the current match when it is the same', async () => {
    const repo = createMockRepository({ getFreeMatchById: async () => makeFreeMatch() })
    mockRepositoryRef.current = repo
    const store = useFreeMatchStore()
    await store.loadFreeMatch(MATCH_ID)

    await store.deleteFreeMatch(MATCH_ID)

    expect(repo.__deleteFreeMatchSpy).toHaveBeenCalledWith(MATCH_ID)
    expect(store.currentFreeMatch).toBeNull()
  })

  it('keeps the current match when another one is deleted', async () => {
    mockRepositoryRef.current = createMockRepository({
      getFreeMatchById: async () => makeFreeMatch(),
    })
    const store = useFreeMatchStore()
    await store.loadFreeMatch(MATCH_ID)

    await store.deleteFreeMatch(OTHER_MATCH_ID)

    expect(store.currentFreeMatch?.id).toBe(MATCH_ID)
  })

  it('invalidates a load still in flight so its late response cannot resurrect the match', async () => {
    const deferred = makeDeferred<FreeMatch | undefined>()
    mockRepositoryRef.current = createMockRepository({
      getFreeMatchById: () => deferred.promise,
    })
    const store = useFreeMatchStore()

    const loading = store.loadFreeMatch(MATCH_ID)
    await store.deleteFreeMatch(MATCH_ID)
    deferred.resolve(makeFreeMatch())
    await loading

    expect(store.currentFreeMatch).toBeNull()
  })

  it('propagates repository errors', async () => {
    mockRepositoryRef.current = createMockRepository({
      deleteFreeMatch: async () => {
        throw new Error('delete boom')
      },
    })
    const store = useFreeMatchStore()

    await expect(store.deleteFreeMatch(MATCH_ID)).rejects.toThrow('delete boom')
    expect(store.isLoading).toBe(false)
  })
})

describe('isCreatorOfCurrentFreeMatch', () => {
  it('is true when the current identity created the loaded match', async () => {
    mockRepositoryRef.current = createMockRepository({
      getFreeMatchById: async () => makeFreeMatch({ createdBy: STUB_USER_ID }),
    })
    const store = useFreeMatchStore()
    await store.loadFreeMatch(MATCH_ID)

    expect(store.isCreatorOfCurrentFreeMatch).toBe(true)
  })

  it('is false for another creator, a vanished creator, or no loaded match', async () => {
    const store = useFreeMatchStore()
    expect(store.isCreatorOfCurrentFreeMatch).toBe(false)

    mockRepositoryRef.current = createMockRepository({
      getFreeMatchById: async () => makeFreeMatch({ createdBy: OTHER_USER_ID }),
    })
    await store.loadFreeMatch(MATCH_ID)
    expect(store.isCreatorOfCurrentFreeMatch).toBe(false)

    mockRepositoryRef.current = createMockRepository({
      getFreeMatchById: async () => makeFreeMatch({ createdBy: null }),
    })
    // Le store garde le repository capturé au setup : on recrée un store
    // neuf pour brancher le nouveau mock.
    setActivePinia(createPinia())
    const freshStore = useFreeMatchStore()
    await freshStore.loadFreeMatch(MATCH_ID)
    expect(freshStore.isCreatorOfCurrentFreeMatch).toBe(false)
  })
})

describe('session reset', () => {
  it('clears the current match and the error when the session drops', async () => {
    mockRepositoryRef.current = createMockRepository({
      getFreeMatchById: async () => makeFreeMatch(),
    })
    const store = useFreeMatchStore()
    await store.loadFreeMatch(MATCH_ID)
    expect(store.currentFreeMatch).not.toBeNull()

    // Les stubs sont des POJO non réactifs : on rejoue la transition de
    // session en relançant un store neuf après avoir coupé la session, comme
    // le ferait le watcher immediate au boot sans session.
    stubSessionRef.value = null
    setActivePinia(createPinia())
    const rebootedStore = useFreeMatchStore()
    await flushPromises()

    expect(rebootedStore.currentFreeMatch).toBeNull()
    expect(rebootedStore.lastLoadFreeMatchError).toBeNull()
    expect(rebootedStore.isLoading).toBe(false)
  })
})
