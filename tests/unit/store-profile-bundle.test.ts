import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import type { TournamentRepository } from '../../app/repositories/TournamentRepository'
import type {
  Profile,
  Teammate,
  Tournament,
  TournamentMember,
  UserProfileBundle,
  UserStats,
  UserTournamentResult,
} from '../../app/types'
import { InviteMemberError } from '../../app/types'

// Tests de l'action loadUserProfile du store profile (extrait du store
// tournament, Phase J).
//
// Setup aligné sur tests/unit/store-profiles.test.ts : stubs hoisted pour
// useSupabaseUser / useSupabaseSession / useSupabaseClient, mock du module
// `repositories` pour injecter un repo in-memory. Le bundle profil vit dans
// son propre fichier (cohérent avec la séparation Phase C.2).
//
// L'identité est résolue par le store identity (instancié par le store
// profile lui-même). Le store tournoi n'intervient plus ; l'identité se fait
// bouger via switchIdentityTo (cf. helper).

const STUB_USER_ID = '99999999-9999-4999-8999-999999999999'
const OTHER_USER_ID = '88888888-8888-4888-8888-888888888888'
const THIRD_USER_ID = '77777777-7777-4777-8777-777777777777'
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

import { useProfileStore } from '../../app/stores/profile'
import { useIdentityStore } from '../../app/stores/identity'

type BundleMockRepository = TournamentRepository & {
  __getUserProfileSpy: ReturnType<typeof vi.fn>
  __getProfilesByIdsSpy: ReturnType<typeof vi.fn>
  __getProfileByIdSpy: ReturnType<typeof vi.fn>
}

// Repo in-memory minimal : seules getUserProfile / getProfilesByIds /
// getProfileById sont espionnées (les seules touchées par loadUserProfile et
// le flow de mount). Le reste reste no-op — ces tests n'en dépendent pas.
function createMockRepository(overrides: Partial<{
  getUserProfile: (userId: string) => Promise<UserProfileBundle>
  getProfilesByIds: (ids: string[]) => Promise<Profile[]>
  getProfileById: (id: string) => Promise<Profile | undefined>
  getAllTournaments: () => Promise<Tournament[]>
  getMyMemberships: (userId: string) => Promise<TournamentMember[]>
}> = {}): BundleMockRepository {
  const defaultGetUserProfile = async (): Promise<UserProfileBundle> => ({
    profile: null,
    stats: null,
    results: [],
  })
  const defaultGetProfilesByIds = async (): Promise<Profile[]> => []
  const defaultGetProfileById = async (): Promise<Profile | undefined> => undefined

  const getUserProfileSpy = vi.fn(overrides.getUserProfile ?? defaultGetUserProfile)
  const getProfilesByIdsSpy = vi.fn(overrides.getProfilesByIds ?? defaultGetProfilesByIds)
  const getProfileByIdSpy = vi.fn(overrides.getProfileById ?? defaultGetProfileById)

  const repo: BundleMockRepository = {
    getAllTournaments: overrides.getAllTournaments ?? (async () => []),
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
    getMyMemberships: overrides.getMyMemberships ?? (async () => []),
    inviteMemberByDisplayName: async () => {
      throw new InviteMemberError('unknown')
    },
    removeMember: async () => {},
    getProfileById: getProfileByIdSpy,
    getProfilesByIds: getProfilesByIdsSpy,
    updateMyProfile: async () => {
      throw new Error('Not implemented in this test mock')
    },
    getUserProfile: getUserProfileSpy,
    __getUserProfileSpy: getUserProfileSpy,
    __getProfilesByIdsSpy: getProfilesByIdsSpy,
    __getProfileByIdSpy: getProfileByIdSpy,
  }
  return repo
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: STUB_USER_ID,
    displayName: 'Alice',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeStats(): UserStats {
  return {
    matchesPlayed: 4,
    wins: 3,
    losses: 1,
    pointsScored: 50,
    pointsConceded: 30,
    tournamentsPlayed: 1,
    tournamentsWon: 1,
    podiums: 1,
    lastTournamentAt: NOW,
  }
}

function makeResult(teammates: Teammate[] = []): UserTournamentResult {
  return {
    tournamentId: crypto.randomUUID(),
    tournamentName: 'Tournoi',
    tournamentDate: '2026-05-10',
    tournamentCompletedAt: NOW,
    teamId: crypto.randomUUID(),
    teamName: 'Team',
    wins: 2,
    losses: 1,
    pointsScored: 30,
    pointsConceded: 20,
    finalRank: 1,
    isWinner: true,
    isPodium: true,
    teammates,
  }
}

function makeBundle(overrides: Partial<UserProfileBundle> = {}): UserProfileBundle {
  return {
    profile: makeProfile({ id: OTHER_USER_ID, displayName: 'Bob' }),
    stats: makeStats(),
    results: [makeResult()],
    ...overrides,
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

// Fait basculer l'identité résolue vers `sub`. Les stubs Supabase sont des
// POJO non réactifs : muter stubUserRef ne réveille ni watcher ni computed —
// seule resolvedUserId (ref Vue) est réactive, et seule
// resolveForCurrentSession l'écrit (chemin chaud : elle relit user.value.sub).
async function switchIdentityTo(sub: string): Promise<void> {
  stubUserRef.value = { sub }
  stubClaimsSub.value = sub
  await useIdentityStore().resolveForCurrentSession()
}

describe('useProfileStore — loadUserProfile', () => {
  it('is a no-op when there is no authenticated viewer', async () => {
    stubUserRef.value = null
    stubSessionRef.value = null
    stubClaimsSub.value = null

    const repo = createMockRepository()
    mockRepositoryRef.current = repo

    const store = useProfileStore()
    await flushPromises()

    await store.loadUserProfile(OTHER_USER_ID)

    expect(repo.__getUserProfileSpy).not.toHaveBeenCalled()
    expect(store.currentProfileBundle).toBeNull()
    expect(store.hasFetchedProfileBundle).toBe(false)
  })

  it('populates currentProfileBundle and flags on success', async () => {
    const bundle = makeBundle()
    const repo = createMockRepository({ getUserProfile: async () => bundle })
    mockRepositoryRef.current = repo

    const store = useProfileStore()
    await flushPromises()

    await store.loadUserProfile(OTHER_USER_ID)

    expect(repo.__getUserProfileSpy).toHaveBeenCalledWith(OTHER_USER_ID)
    expect(store.currentProfileBundle).toEqual(bundle)
    expect(store.hasFetchedProfileBundle).toBe(true)
    expect(store.lastLoadProfileBundleError).toBeNull()
  })

  it('captures the repo error without throwing and keeps hasFetched false', async () => {
    const repoError = new Error('not_authenticated')
    mockRepositoryRef.current = createMockRepository({
      getUserProfile: async () => {
        throw repoError
      },
    })

    const store = useProfileStore()
    await flushPromises()

    await expect(store.loadUserProfile(OTHER_USER_ID)).resolves.toBeUndefined()

    expect(store.currentProfileBundle).toBeNull()
    expect(store.hasFetchedProfileBundle).toBe(false)
    expect(store.lastLoadProfileBundleError).toBe(repoError)
  })

  it('clears currentProfileBundle at the start of a new load (no stale flash)', async () => {
    const bundleA = makeBundle({ profile: makeProfile({ id: OTHER_USER_ID, displayName: 'Bob' }) })
    let resolveB!: (bundle: UserProfileBundle) => void
    let callCount = 0
    mockRepositoryRef.current = createMockRepository({
      getUserProfile: () => {
        callCount += 1
        if (callCount === 1) return Promise.resolve(bundleA)
        return new Promise<UserProfileBundle>((resolve) => {
          resolveB = resolve
        })
      },
    })

    const store = useProfileStore()
    await flushPromises()

    await store.loadUserProfile(OTHER_USER_ID)
    expect(store.currentProfileBundle).toEqual(bundleA)

    // 2e load : doit vider le bundle AVANT la résolution de B.
    const inflight = store.loadUserProfile(THIRD_USER_ID)
    await Promise.resolve()
    expect(store.currentProfileBundle).toBeNull()

    resolveB(makeBundle({ profile: makeProfile({ id: THIRD_USER_ID, displayName: 'Carol' }) }))
    await inflight
  })

  it('discards a late response from a superseded load (request-id guard)', async () => {
    type Pending = { userId: string, resolve: (bundle: UserProfileBundle) => void }
    const pending: Pending[] = []
    mockRepositoryRef.current = createMockRepository({
      getUserProfile: (userId: string) =>
        new Promise<UserProfileBundle>((resolve) => {
          pending.push({ userId, resolve })
        }),
    })

    const store = useProfileStore()
    await flushPromises()

    const inflightA = store.loadUserProfile(OTHER_USER_ID)
    const inflightB = store.loadUserProfile(THIRD_USER_ID)
    expect(pending).toHaveLength(2)

    const bundleB = makeBundle({ profile: makeProfile({ id: THIRD_USER_ID, displayName: 'Carol' }) })
    const bundleA = makeBundle({ profile: makeProfile({ id: OTHER_USER_ID, displayName: 'Bob' }) })

    // Résout le plus récent (B) puis le périmé (A) : A ne doit rien écraser.
    pending[1]!.resolve(bundleB)
    await inflightB
    pending[0]!.resolve(bundleA)
    await inflightA

    expect(store.currentProfileBundle).toEqual(bundleB)
    expect(store.hasFetchedProfileBundle).toBe(true)
  })

  it('discards a late write when the viewer identity changed during the await', async () => {
    stubUserRef.value = null
    stubSessionRef.value = { access_token: 'tok' }
    stubClaimsSub.value = STUB_USER_ID

    let resolveRepo!: (bundle: UserProfileBundle) => void
    mockRepositoryRef.current = createMockRepository({
      getUserProfile: () =>
        new Promise<UserProfileBundle>((resolve) => {
          resolveRepo = resolve
        }),
    })

    const store = useProfileStore()
    await flushPromises()

    const inflight = store.loadUserProfile(OTHER_USER_ID)
    await Promise.resolve()

    // Bump l'identité du viewer (resolvedUserId, ref Vue réactive).
    await switchIdentityTo(THIRD_USER_ID)

    resolveRepo(makeBundle())
    await inflight

    expect(store.currentProfileBundle).toBeNull()
    expect(store.hasFetchedProfileBundle).toBe(false)
  })

  it('pre-hydrates teammate profiles (deduped, non-null, excluding the viewed user)', async () => {
    const bundle = makeBundle({
      profile: makeProfile({ id: OTHER_USER_ID, displayName: 'Bob' }),
      results: [
        makeResult([
          { userId: THIRD_USER_ID, displayName: 'Carol' },
          { userId: THIRD_USER_ID, displayName: 'Carol' }, // doublon
          { userId: null, displayName: 'Pierre' }, // joueur libre
          { userId: OTHER_USER_ID, displayName: 'Bob' }, // profil consulté
        ]),
      ],
    })
    const repo = createMockRepository({ getUserProfile: async () => bundle })
    mockRepositoryRef.current = repo

    const store = useProfileStore()
    await flushPromises()
    repo.__getProfilesByIdsSpy.mockClear()

    await store.loadUserProfile(OTHER_USER_ID)
    await flushPromises()

    expect(repo.__getProfilesByIdsSpy).toHaveBeenCalledTimes(1)
    expect(repo.__getProfilesByIdsSpy.mock.calls[0]![0]).toEqual([THIRD_USER_ID])
  })

  it('does not pre-hydrate when there are no linked teammates', async () => {
    const bundle = makeBundle({
      results: [makeResult([{ userId: null, displayName: 'Pierre' }])],
    })
    const repo = createMockRepository({ getUserProfile: async () => bundle })
    mockRepositoryRef.current = repo

    const store = useProfileStore()
    await flushPromises()
    repo.__getProfilesByIdsSpy.mockClear()

    await store.loadUserProfile(OTHER_USER_ID)
    await flushPromises()

    expect(repo.__getProfilesByIdsSpy).not.toHaveBeenCalled()
  })

  it('does not pre-hydrate when results is empty', async () => {
    const repo = createMockRepository({
      getUserProfile: async () => makeBundle({ results: [] }),
    })
    mockRepositoryRef.current = repo

    const store = useProfileStore()
    await flushPromises()
    repo.__getProfilesByIdsSpy.mockClear()

    await store.loadUserProfile(OTHER_USER_ID)
    await flushPromises()

    expect(repo.__getProfilesByIdsSpy).not.toHaveBeenCalled()
  })

  it('resolves even when teammate pre-hydration hangs (fire-and-forget)', async () => {
    const bundle = makeBundle({
      results: [makeResult([{ userId: THIRD_USER_ID, displayName: 'Carol' }])],
    })
    mockRepositoryRef.current = createMockRepository({
      getUserProfile: async () => bundle,
      // Ne résout jamais : ne doit pas bloquer loadUserProfile.
      getProfilesByIds: () => new Promise<Profile[]>(() => {}),
    })

    const store = useProfileStore()
    await flushPromises()

    await expect(store.loadUserProfile(OTHER_USER_ID)).resolves.toBeUndefined()
    expect(store.currentProfileBundle).toEqual(bundle)
    expect(store.hasFetchedProfileBundle).toBe(true)
  })
})

describe('useProfileStore — profile bundle reset on logout', () => {
  // Note : comme dans store-profiles.test.ts, la transition login → logout
  // repose sur la réactivité de session.value (POJO non réactif dans les
  // stubs), donc le watcher ne re-fire pas sur mutation post-mount. On
  // initialise le store DIRECTEMENT avec session=null pour exercer la
  // branche de reset (immediate fire) et vérifier les valeurs par défaut.
  it('initializes profile bundle state at defaults when session is null on mount', async () => {
    stubSessionRef.value = null
    stubUserRef.value = null
    stubClaimsSub.value = null

    mockRepositoryRef.current = createMockRepository({
      getUserProfile: async () => makeBundle(),
    })

    const store = useProfileStore()
    await flushPromises()

    expect(store.currentProfileBundle).toBeNull()
    expect(store.hasFetchedProfileBundle).toBe(false)
    expect(store.lastLoadProfileBundleError).toBeNull()
  })
})
