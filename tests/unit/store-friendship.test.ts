import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { TournamentRepository } from '../../app/repositories/TournamentRepository'
import type { FriendshipBundle, FriendshipRequestOutcome } from '../../app/types'
import { FriendshipError, InviteMemberError } from '../../app/types'

// Tests du store friendship (A3). Setup aligné sur
// tests/unit/store-free-match.test.ts : stubs hoisted pour
// useSupabaseUser / useSupabaseSession / useSupabaseClient, mock du module
// `repositories` pour injecter un repo in-memory.

const STUB_USER_ID = '99999999-9999-4999-8999-999999999999'
const OTHER_USER_ID = '88888888-8888-4888-8888-888888888888'
const FRIEND_ID = '11111111-1111-4111-8111-111111111111'
const RECEIVED_ID = '22222222-2222-4222-8222-222222222222'
const SENT_ID = '33333333-3333-4333-8333-333333333333'

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

import { useFriendshipStore } from '../../app/stores/friendship'
import { useIdentityStore } from '../../app/stores/identity'

type FriendshipMockRepository = TournamentRepository & {
  __getFriendshipsSpy: ReturnType<typeof vi.fn>
  __requestFriendshipSpy: ReturnType<typeof vi.fn>
  __acceptFriendshipSpy: ReturnType<typeof vi.fn>
  __refuseFriendshipSpy: ReturnType<typeof vi.fn>
  __cancelFriendshipRequestSpy: ReturnType<typeof vi.fn>
  __removeFriendshipSpy: ReturnType<typeof vi.fn>
}

function makeBundle(overrides: Partial<FriendshipBundle> = {}): FriendshipBundle {
  return {
    friends: [{ userId: FRIEND_ID, displayName: 'Alice' }],
    received: [{ userId: RECEIVED_ID, displayName: 'Paul' }],
    sent: [{ userId: SENT_ID, displayName: 'Jeanne' }],
    ...overrides,
  }
}

// Repo in-memory minimal : seules les méthodes « amitié » sont espionnées.
// Le reste reste no-op — ces tests n'en dépendent pas.
function createMockRepository(overrides: Partial<{
  getFriendships: () => Promise<FriendshipBundle>
  requestFriendship: (displayName: string) => Promise<FriendshipRequestOutcome>
  acceptFriendship: (userId: string) => Promise<void>
  refuseFriendship: (userId: string) => Promise<void>
  cancelFriendshipRequest: (userId: string) => Promise<void>
  removeFriendship: (userId: string) => Promise<void>
}> = {}): FriendshipMockRepository {
  const getFriendshipsSpy = vi.fn(overrides.getFriendships ?? (async () => makeBundle()))
  const requestFriendshipSpy = vi.fn(
    overrides.requestFriendship ?? (async () => 'pending' as const),
  )
  const acceptFriendshipSpy = vi.fn(overrides.acceptFriendship ?? (async () => {}))
  const refuseFriendshipSpy = vi.fn(overrides.refuseFriendship ?? (async () => {}))
  const cancelFriendshipRequestSpy = vi.fn(
    overrides.cancelFriendshipRequest ?? (async () => {}),
  )
  const removeFriendshipSpy = vi.fn(overrides.removeFriendship ?? (async () => {}))

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
    getFreeMatchById: async () => undefined,
    createFreeMatch: async () => 'unused-match-id',
    deleteFreeMatch: async () => {},
    findAccountByDisplayName: async () => undefined,
    getFriendships: getFriendshipsSpy,
    requestFriendship: requestFriendshipSpy,
    acceptFriendship: acceptFriendshipSpy,
    refuseFriendship: refuseFriendshipSpy,
    cancelFriendshipRequest: cancelFriendshipRequestSpy,
    removeFriendship: removeFriendshipSpy,
    __getFriendshipsSpy: getFriendshipsSpy,
    __requestFriendshipSpy: requestFriendshipSpy,
    __acceptFriendshipSpy: acceptFriendshipSpy,
    __refuseFriendshipSpy: refuseFriendshipSpy,
    __cancelFriendshipRequestSpy: cancelFriendshipRequestSpy,
    __removeFriendshipSpy: removeFriendshipSpy,
  }
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

describe('loadFriendships / refreshFriendships', () => {
  it('exposes the three lists and toggles isLoadingBundle around the request', async () => {
    const deferred = makeDeferred<FriendshipBundle>()
    const repo = createMockRepository({ getFriendships: () => deferred.promise })
    mockRepositoryRef.current = repo
    const store = useFriendshipStore()

    const loading = store.loadFriendships()
    expect(store.isLoadingBundle).toBe(true)
    deferred.resolve(makeBundle())
    await loading

    expect(store.isLoadingBundle).toBe(false)
    expect(store.friendshipBundle).toEqual(makeBundle())
    expect(store.lastLoadFriendshipsError).toBeNull()
    expect(store.receivedRequestCount).toBe(1)
  })

  it('is lazy: a second load with a bundle in place is a no-op', async () => {
    const repo = createMockRepository()
    mockRepositoryRef.current = repo
    const store = useFriendshipStore()

    await store.loadFriendships()
    await store.loadFriendships()

    expect(repo.__getFriendshipsSpy).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent loads into one request and one shared promise', async () => {
    const deferred = makeDeferred<FriendshipBundle>()
    const repo = createMockRepository({ getFriendships: () => deferred.promise })
    mockRepositoryRef.current = repo
    const store = useFriendshipStore()

    const first = store.loadFriendships()
    const second = store.loadFriendships()
    deferred.resolve(makeBundle())
    await Promise.all([first, second])

    expect(repo.__getFriendshipsSpy).toHaveBeenCalledTimes(1)
  })

  it('captures the error instead of throwing, and clears it on the next refresh', async () => {
    const failure = new Error('network down')
    let shouldFail = true
    mockRepositoryRef.current = createMockRepository({
      getFriendships: async () => {
        if (shouldFail) throw failure
        return makeBundle()
      },
    })
    const store = useFriendshipStore()

    await store.refreshFriendships()
    expect(store.lastLoadFriendshipsError).toBe(failure)
    expect(store.friendshipBundle).toBeNull()

    shouldFail = false
    await store.refreshFriendships()
    expect(store.lastLoadFriendshipsError).toBeNull()
    expect(store.friendshipBundle).toEqual(makeBundle())
  })

  it('keeps the displayed bundle during a failing refresh (no blink, no wipe)', async () => {
    let shouldFail = false
    mockRepositoryRef.current = createMockRepository({
      getFriendships: async () => {
        if (shouldFail) throw new Error('network down')
        return makeBundle()
      },
    })
    const store = useFriendshipStore()

    await store.refreshFriendships()
    shouldFail = true
    await store.refreshFriendships()

    expect(store.friendshipBundle).toEqual(makeBundle())
    expect(store.lastLoadFriendshipsError).toBeInstanceOf(Error)
  })

  it('abandons the write when the identity changes during the round-trip', async () => {
    const deferred = makeDeferred<FriendshipBundle>()
    mockRepositoryRef.current = createMockRepository({ getFriendships: () => deferred.promise })
    const store = useFriendshipStore()

    const loading = store.refreshFriendships()
    await switchIdentityTo(OTHER_USER_ID)
    deferred.resolve(makeBundle())
    await loading

    expect(store.friendshipBundle).toBeNull()
  })

  it('is a no-op without a resolved identity', async () => {
    stubUserRef.value = null
    stubClaimsSub.value = null
    stubSessionRef.value = null
    const repo = createMockRepository()
    mockRepositoryRef.current = repo
    const store = useFriendshipStore()

    await store.loadFriendships()

    expect(repo.__getFriendshipsSpy).not.toHaveBeenCalled()
  })
})

describe('requestFriendship', () => {
  it('returns pending and refreshes the lists', async () => {
    const repo = createMockRepository()
    mockRepositoryRef.current = repo
    const store = useFriendshipStore()

    const outcome = await store.requestFriendship('Alice')

    expect(outcome).toBe('pending')
    expect(repo.__requestFriendshipSpy).toHaveBeenCalledWith('Alice')
    expect(repo.__getFriendshipsSpy).toHaveBeenCalledTimes(1)
    expect(store.friendshipBundle).toEqual(makeBundle())
  })

  it('returns accepted on a crossed request (the screen says so honestly)', async () => {
    mockRepositoryRef.current = createMockRepository({
      requestFriendship: async () => 'accepted',
    })
    const store = useFriendshipStore()

    expect(await store.requestFriendship('Alice')).toBe('accepted')
  })

  it('forces a real post-write fetch even when a pre-write load is in flight', async () => {
    const preWriteDeferred = makeDeferred<FriendshipBundle>()
    const postWriteBundle = makeBundle({
      sent: [
        { userId: SENT_ID, displayName: 'Jeanne' },
        { userId: OTHER_USER_ID, displayName: 'Nouveau' },
      ],
    })
    let callCount = 0
    const repo = createMockRepository({
      getFriendships: () => {
        callCount += 1
        // 1er appel = chargement parti AVANT l'écriture (en vol) ;
        // les suivants = état post-écriture.
        if (callCount === 1) return preWriteDeferred.promise
        return Promise.resolve(postWriteBundle)
      },
    })
    mockRepositoryRef.current = repo
    const store = useFriendshipStore()

    const preWriteLoad = store.loadFriendships()
    const outcome = await store.requestFriendship('Nouveau')
    // La réponse pré-écriture arrive en retard : elle ne doit rien écraser.
    preWriteDeferred.resolve(makeBundle({ sent: [] }))
    await preWriteLoad

    expect(outcome).toBe('pending')
    expect(callCount).toBe(2)
    expect(store.friendshipBundle?.sent.map(entry => entry.displayName))
      .toEqual(['Jeanne', 'Nouveau'])
  })

  it('propagates a typed FriendshipError untouched', async () => {
    const raised = new FriendshipError('already_friends')
    const repo = createMockRepository({
      requestFriendship: async () => {
        throw raised
      },
    })
    mockRepositoryRef.current = repo
    const store = useFriendshipStore()

    await expect(store.requestFriendship('Alice')).rejects.toBe(raised)
    expect(repo.__getFriendshipsSpy).not.toHaveBeenCalled()
  })
})

describe('les actions ciblant une personne (mutations locales)', () => {
  it('accept: moves the person from received to friends at her alphabetical spot', async () => {
    const repo = createMockRepository({
      getFriendships: async () => makeBundle({
        friends: [
          { userId: 'f-a', displayName: 'Anna' },
          { userId: 'f-z', displayName: 'Zoé' },
        ],
        received: [{ userId: RECEIVED_ID, displayName: 'Paul' }],
      }),
    })
    mockRepositoryRef.current = repo
    const store = useFriendshipStore()
    await store.loadFriendships()

    await store.acceptFriendship(RECEIVED_ID)

    expect(repo.__acceptFriendshipSpy).toHaveBeenCalledWith(RECEIVED_ID)
    expect(store.friendshipBundle?.received).toEqual([])
    expect(store.friendshipBundle?.friends.map(friend => friend.displayName))
      .toEqual(['Anna', 'Paul', 'Zoé'])
    // Mutation locale, pas de rechargement.
    expect(repo.__getFriendshipsSpy).toHaveBeenCalledTimes(1)
    expect(store.receivedRequestCount).toBe(0)
  })

  it('refuse, cancel and remove: local removals without a reload', async () => {
    const repo = createMockRepository()
    mockRepositoryRef.current = repo
    const store = useFriendshipStore()
    await store.loadFriendships()

    await store.refuseFriendship(RECEIVED_ID)
    await store.cancelFriendshipRequest(SENT_ID)
    await store.removeFriendship(FRIEND_ID)

    expect(store.friendshipBundle).toEqual({ friends: [], received: [], sent: [] })
    expect(repo.__refuseFriendshipSpy).toHaveBeenCalledWith(RECEIVED_ID)
    expect(repo.__cancelFriendshipRequestSpy).toHaveBeenCalledWith(SENT_ID)
    expect(repo.__removeFriendshipSpy).toHaveBeenCalledWith(FRIEND_ID)
    expect(repo.__getFriendshipsSpy).toHaveBeenCalledTimes(1)
  })

  it('a late load response does not overwrite a locally mutated bundle', async () => {
    const deferred = makeDeferred<FriendshipBundle>()
    let callCount = 0
    const repo = createMockRepository({
      getFriendships: () => {
        callCount += 1
        if (callCount === 1) return Promise.resolve(makeBundle())
        return deferred.promise
      },
    })
    mockRepositoryRef.current = repo
    const store = useFriendshipStore()
    await store.loadFriendships()

    // Un refresh part (réponse en attente), puis une action mute localement.
    const lateRefresh = store.refreshFriendships()
    await store.removeFriendship(FRIEND_ID)
    deferred.resolve(makeBundle())
    await lateRefresh

    expect(store.friendshipBundle?.friends).toEqual([])
  })

  it('tracks the pending action per button and clears it after, even on failure', async () => {
    const deferred = makeDeferred<void>()
    mockRepositoryRef.current = createMockRepository({
      acceptFriendship: () => deferred.promise,
      refuseFriendship: async () => {
        throw new FriendshipError('request_not_found')
      },
    })
    const store = useFriendshipStore()
    await store.loadFriendships()

    const accepting = store.acceptFriendship(RECEIVED_ID)
    // Le geste ET la cible : le spinner d'Accepter, pas celui de Refuser.
    expect(store.isActionPending(RECEIVED_ID, 'accept')).toBe(true)
    expect(store.isActionPending(RECEIVED_ID, 'refuse')).toBe(false)
    expect(store.isActionPending(RECEIVED_ID)).toBe(true)
    expect(store.isActionPending(FRIEND_ID)).toBe(false)
    deferred.resolve()
    await accepting
    expect(store.pendingAction).toBeNull()

    await expect(store.refuseFriendship(RECEIVED_ID)).rejects.toBeInstanceOf(FriendshipError)
    expect(store.pendingAction).toBeNull()
  })

  it('a refresh AFTER a local mutation refetches instead of joining a dead pre-write load', async () => {
    const preWriteDeferred = makeDeferred<FriendshipBundle>()
    let callCount = 0
    const repo = createMockRepository({
      getFriendships: () => {
        callCount += 1
        if (callCount === 2) return preWriteDeferred.promise
        return Promise.resolve(makeBundle({ friends: [] }))
      },
    })
    mockRepositoryRef.current = repo
    const store = useFriendshipStore()
    await store.loadFriendships()

    // Un refresh part (en vol), une action mute localement (bump + slot
    // libéré) : le refresh SUIVANT doit refetcher, pas rejoindre le mort.
    const staleRefresh = store.refreshFriendships()
    await store.refuseFriendship(RECEIVED_ID)
    await store.refreshFriendships()
    preWriteDeferred.resolve(makeBundle())
    await staleRefresh

    expect(callCount).toBe(3)
    expect(store.friendshipBundle?.received).toEqual([{ userId: RECEIVED_ID, displayName: 'Paul' }])
  })

  it('guards on identity: no repository call without a session (boot à froid)', async () => {
    // Comme le test de reset : les stubs sont des POJO, on rejoue l'absence
    // d'identité par un store neuf démarré sans session.
    stubUserRef.value = null
    stubClaimsSub.value = null
    stubSessionRef.value = null
    setActivePinia(createPinia())
    const repo = createMockRepository()
    mockRepositoryRef.current = repo
    const store = useFriendshipStore()

    await expect(store.acceptFriendship(RECEIVED_ID)).rejects.toThrow()
    expect(repo.__acceptFriendshipSpy).not.toHaveBeenCalled()
  })
})

describe('friendshipStatusOf', () => {
  it('derives self, friends, request_sent, request_received and none', async () => {
    const store = useFriendshipStore()
    await store.loadFriendships()

    expect(store.friendshipStatusOf(STUB_USER_ID)).toBe('self')
    expect(store.friendshipStatusOf(FRIEND_ID)).toBe('friends')
    expect(store.friendshipStatusOf(SENT_ID)).toBe('request_sent')
    expect(store.friendshipStatusOf(RECEIVED_ID)).toBe('request_received')
    expect(store.friendshipStatusOf(OTHER_USER_ID)).toBe('none')
  })
})

describe('reset de session', () => {
  it('boots clean without a session (watcher immediate)', async () => {
    const store = useFriendshipStore()
    await store.loadFriendships()
    expect(store.friendshipBundle).not.toBeNull()

    // Les stubs sont des POJO non réactifs : on rejoue la transition de
    // session en relançant un store neuf après avoir coupé la session,
    // comme le ferait le watcher immediate au boot sans session (précédent
    // store-free-match.test.ts).
    stubSessionRef.value = null
    setActivePinia(createPinia())
    const rebootedStore = useFriendshipStore()

    expect(rebootedStore.friendshipBundle).toBeNull()
    expect(rebootedStore.lastLoadFriendshipsError).toBeNull()
    expect(rebootedStore.isLoadingBundle).toBe(false)
    expect(rebootedStore.receivedRequestCount).toBe(0)
  })
})
