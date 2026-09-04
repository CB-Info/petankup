import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import type { TournamentRepository } from '../../app/repositories/TournamentRepository'
import type {
  AccountMatch,
  MyProfile,
  TournamentMatch,
  Profile,
  ProfileVisibility,
  Team,
  Tournament,
  TournamentMember,
} from '../../app/types'
import { InviteMemberError } from '../../app/types'

// Tests des actions du store profile (extrait du store tournament, Phase C.2).
//
// Setup aligné sur tests/unit/store.test.ts : stubs hoisted pour
// useSupabaseUser / useSupabaseSession / useSupabaseClient, mock du
// module `repositories` pour injecter un repo in-memory. La couverture
// profile vit ici (séparée car store.test.ts fait déjà 1200+ lignes).
//
// L'identité est résolue par le store identity (instancié par le store
// profile lui-même) : les tests qui montent avec user null la voient se
// résoudre via getClaims au montage. Le profil courant n'est plus chargé au
// montage par une orchestration : les tests l'appellent explicitement, comme
// les pages. Seuls les deux tests de non-régression montent le store tournoi.

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

import { useTournamentStore } from '../../app/stores/tournament'
import { useProfileStore } from '../../app/stores/profile'
import { useIdentityStore } from '../../app/stores/identity'

type ProfileMockRepository = TournamentRepository & {
  __profiles: Profile[]
  __getMyProfileSpy: ReturnType<typeof vi.fn>
  __getProfilesByIdsSpy: ReturnType<typeof vi.fn>
  __updateMyProfileSpy: ReturnType<typeof vi.fn>
  __updateMyProfileVisibilitySpy: ReturnType<typeof vi.fn>
  __findAccountByDisplayNameSpy: ReturnType<typeof vi.fn>
}

// Repo in-memory côté profiles + spies pour assertions d'appels.
// Le reste des méthodes (tournaments, members, etc.) reste no-op /
// liste vide — les tests profile n'en dépendent pas, sauf le test de
// non-régression "loadCurrentProfile échoue, tournaments OK" qui
// fournit ses propres listes.
function createMockRepository(overrides: Partial<{
  initialProfiles: Profile[]
  // Réglage de confidentialité servi par getMyProfile (public par défaut,
  // comme la base).
  initialVisibility: ProfileVisibility
  getMyProfile: () => Promise<MyProfile | undefined>
  getProfilesByIds: (ids: string[]) => Promise<Profile[]>
  updateMyProfile: (userId: string, displayName: string) => Promise<Profile>
  updateMyProfileVisibility: (userId: string, visibility: ProfileVisibility) => Promise<void>
  findAccountByDisplayName: (displayName: string) => Promise<AccountMatch | undefined>
  getAllTournaments: () => Promise<Tournament[]>
  getMyMemberships: (userId: string) => Promise<TournamentMember[]>
}> = {}): ProfileMockRepository {
  const profiles: Profile[] = [...(overrides.initialProfiles ?? [])]

  // Comme la RPC : la ligne de l'identité du JETON (celle que voit la base),
  // pas d'un id demandé — avec son réglage.
  const defaultGetMyProfile = async (): Promise<MyProfile | undefined> => {
    const tokenUserId = stubUserRef.value?.sub ?? stubClaimsSub.value
    const mine = profiles.find(profile => profile.id === tokenUserId)
    if (mine === undefined) return undefined
    return { profile: mine, visibility: overrides.initialVisibility ?? 'public' }
  }

  const defaultGetProfilesByIds = async (ids: string[]): Promise<Profile[]> => {
    const idSet = new Set(ids)
    return profiles.filter(profile => idSet.has(profile.id))
  }

  const defaultUpdateMyProfile = async (
    userId: string,
    displayName: string,
  ): Promise<Profile> => {
    const existing = profiles.find(profile => profile.id === userId)
    if (existing === undefined) {
      throw new Error('Profil introuvable.')
    }
    const updated: Profile = {
      ...existing,
      displayName,
      updatedAt: new Date().toISOString(),
    }
    const index = profiles.findIndex(profile => profile.id === userId)
    profiles[index] = updated
    return updated
  }

  const getMyProfileSpy = vi.fn(overrides.getMyProfile ?? defaultGetMyProfile)
  const getProfilesByIdsSpy = vi.fn(overrides.getProfilesByIds ?? defaultGetProfilesByIds)
  const updateMyProfileSpy = vi.fn(overrides.updateMyProfile ?? defaultUpdateMyProfile)
  const updateMyProfileVisibilitySpy = vi.fn(
    overrides.updateMyProfileVisibility ?? (async () => {}),
  )

  // Recherche par pseudo exact : même normalisation que la base
  // (lower(trim)) sur les profils in-memory.
  const defaultFindAccountByDisplayName = async (
    displayName: string,
  ): Promise<AccountMatch | undefined> => {
    const normalized = displayName.trim().toLowerCase()
    const found = profiles.find(profile => profile.displayName.trim().toLowerCase() === normalized)
    return found === undefined ? undefined : { userId: found.id, displayName: found.displayName }
  }
  const findAccountByDisplayNameSpy = vi.fn(
    overrides.findAccountByDisplayName ?? defaultFindAccountByDisplayName,
  )

  const repo: ProfileMockRepository = {
    // Tournament / team / match / member — no-op pour ces tests.
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
    getMyProfile: getMyProfileSpy,
    getProfilesByIds: getProfilesByIdsSpy,
    updateMyProfile: updateMyProfileSpy,
    updateMyProfileVisibility: updateMyProfileVisibilitySpy,
    findAccountByDisplayName: findAccountByDisplayNameSpy,
    getFriendships: async () => ({ friends: [], received: [], sent: [] }),
    requestFriendship: async () => 'pending' as const,
    acceptFriendship: async () => {},
    refuseFriendship: async () => {},
    cancelFriendshipRequest: async () => {},
    removeFriendship: async () => {},
    __profiles: profiles,
    __getMyProfileSpy: getMyProfileSpy,
    __getProfilesByIdsSpy: getProfilesByIdsSpy,
    __updateMyProfileSpy: updateMyProfileSpy,
    __updateMyProfileVisibilitySpy: updateMyProfileVisibilitySpy,
    __findAccountByDisplayNameSpy: findAccountByDisplayNameSpy,
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

function makeMyProfile(
  profileOverrides: Partial<Profile> = {},
  visibility: ProfileVisibility = 'public',
): MyProfile {
  return { profile: makeProfile(profileOverrides), visibility }
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

describe('useProfileStore — loadCurrentProfile', () => {
  it('is a no-op when there is no authenticated user', async () => {
    stubUserRef.value = null
    stubSessionRef.value = null
    stubClaimsSub.value = null

    const repo = createMockRepository({ initialProfiles: [makeProfile()] })
    mockRepositoryRef.current = repo

    const store = useProfileStore()
    await flushPromises()

    await store.loadCurrentProfile()

    expect(repo.__getMyProfileSpy).not.toHaveBeenCalled()
    expect(store.currentProfile).toBeNull()
    expect(store.hasFetchedCurrentProfile).toBe(false)
  })

  it('populates currentProfile and profileById on success', async () => {
    const profile = makeProfile()
    mockRepositoryRef.current = createMockRepository({ initialProfiles: [profile] })

    const store = useProfileStore()
    await flushPromises()

    await store.loadCurrentProfile()

    expect(store.currentProfile).toEqual(profile)
    expect(store.profileById[STUB_USER_ID]).toEqual(profile)
    expect(store.hasFetchedCurrentProfile).toBe(true)
    expect(store.lastLoadCurrentProfileError).toBeNull()
  })

  it('hydrates the privacy setting from the same request (public by default, private when set)', async () => {
    mockRepositoryRef.current = createMockRepository({ initialProfiles: [makeProfile()] })
    const store = useProfileStore()
    await flushPromises()

    await store.loadCurrentProfile()
    expect(store.currentProfileVisibility).toBe('public')

    setActivePinia(createPinia())
    mockRepositoryRef.current = createMockRepository({
      initialProfiles: [makeProfile()],
      initialVisibility: 'private',
    })
    const privateStore = useProfileStore()
    await flushPromises()

    await privateStore.loadCurrentProfile()
    expect(privateStore.currentProfileVisibility).toBe('private')
  })

  it('keeps the setting OUT of currentProfile and of the profile cache (a Profile never carries it)', async () => {
    mockRepositoryRef.current = createMockRepository({
      initialProfiles: [makeProfile()],
      initialVisibility: 'private',
    })
    const store = useProfileStore()
    await flushPromises()

    await store.loadCurrentProfile()

    expect(Object.keys(store.currentProfile!).sort()).toEqual(
      ['createdAt', 'displayName', 'id', 'updatedAt'],
    )
    expect(Object.keys(store.profileById[STUB_USER_ID]!).sort()).toEqual(
      ['createdAt', 'displayName', 'id', 'updatedAt'],
    )
  })

  it('ignores a row that is not the requested identity (token switched mid-flight)', async () => {
    // La RPC répond pour le jeton courant : si un changement de compte
    // s'intercale, la ligne livrée peut être celle d'un autre — rien n'est
    // écrit, pas même une erreur.
    mockRepositoryRef.current = createMockRepository({
      getMyProfile: async () => makeMyProfile({ id: OTHER_USER_ID, displayName: 'Bob' }),
    })
    const store = useProfileStore()
    await flushPromises()

    await store.loadCurrentProfile()

    expect(store.currentProfile).toBeNull()
    expect(store.currentProfileVisibility).toBeNull()
    expect(store.profileById[OTHER_USER_ID]).toBeUndefined()
    expect(store.lastLoadCurrentProfileError).toBeNull()
  })

  it('records a typed "Profil introuvable." error when the repo returns undefined', async () => {
    mockRepositoryRef.current = createMockRepository({ initialProfiles: [] })

    const store = useProfileStore()
    await flushPromises()

    await store.loadCurrentProfile()

    expect(store.currentProfile).toBeNull()
    expect(store.hasFetchedCurrentProfile).toBe(true)
    expect(store.lastLoadCurrentProfileError).toBeInstanceOf(Error)
    expect((store.lastLoadCurrentProfileError as Error).message).toBe(
      'Profil introuvable.',
    )
  })

  it('captures the repo error in lastLoadCurrentProfileError without throwing', async () => {
    const repoError = new Error('boom')
    mockRepositoryRef.current = createMockRepository({
      getMyProfile: async () => {
        throw repoError
      },
    })

    const store = useProfileStore()
    await flushPromises()

    await expect(store.loadCurrentProfile()).resolves.toBeUndefined()

    expect(store.lastLoadCurrentProfileError).toBe(repoError)
    expect(store.hasFetchedCurrentProfile).toBe(true)
    expect(store.currentProfile).toBeNull()
  })

  it('discards a late SUCCESS write when identity (resolvedUserId) changed during the await', async () => {
    // On fait varier l'identité via switchIdentityTo (cf. helper) puis on
    // relance loadCurrentProfile pour le nouvel userId. Chaque appel au
    // mock getMyProfile capture ses resolvers ; le test résout
    // spécifiquement la 1ère pending pour exercer la garde.
    stubUserRef.value = null
    stubSessionRef.value = { access_token: 'tok' }
    stubClaimsSub.value = STUB_USER_ID

    type PendingCall = {
      resolve: (value: MyProfile | undefined) => void
      reject: (reason: Error) => void
    }
    const pendingCalls: PendingCall[] = []
    mockRepositoryRef.current = createMockRepository({
      getMyProfile: () =>
        new Promise<MyProfile | undefined>((resolve, reject) => {
          pendingCalls.push({ resolve, reject })
        }),
    })

    const store = useProfileStore()
    await flushPromises()
    void store.loadCurrentProfile()
    await Promise.resolve()
    expect(pendingCalls).toHaveLength(1)

    // Bump l'identité vers OTHER_USER_ID, puis 2e loadCurrentProfile pour
    // ce nouvel userId (pending #2 — pas dédupliqué : autre user).
    await switchIdentityTo(OTHER_USER_ID)
    void store.loadCurrentProfile()
    await Promise.resolve()
    expect(pendingCalls).toHaveLength(2)

    // Résoudre tardivement le 1er appel avec un profil legacy.
    pendingCalls[0]!.resolve(makeMyProfile({ id: STUB_USER_ID }))
    await flushPromises()

    // Vue depuis l'extérieur : currentProfile est null, profileById
    // ne contient pas STUB_USER_ID. Le profil OTHER_USER_ID viendrait
    // de la 2e résolution (toujours pending ici), donc rien à voir.
    expect(store.currentProfile).toBeNull()
    expect(store.profileById[STUB_USER_ID]).toBeUndefined()
    expect(store.lastLoadCurrentProfileError).toBeNull()
  })

  it('discards a late FAILURE when identity changed during the await', async () => {
    stubUserRef.value = null
    stubSessionRef.value = { access_token: 'tok' }
    stubClaimsSub.value = STUB_USER_ID

    type PendingCall = {
      resolve: (value: MyProfile | undefined) => void
      reject: (reason: Error) => void
    }
    const pendingCalls: PendingCall[] = []
    mockRepositoryRef.current = createMockRepository({
      getMyProfile: () =>
        new Promise<MyProfile | undefined>((resolve, reject) => {
          pendingCalls.push({ resolve, reject })
        }),
    })

    const store = useProfileStore()
    await flushPromises()
    void store.loadCurrentProfile()
    await Promise.resolve()
    expect(pendingCalls).toHaveLength(1)

    await switchIdentityTo(OTHER_USER_ID)
    void store.loadCurrentProfile()
    await Promise.resolve()
    expect(pendingCalls).toHaveLength(2)

    // Rejette tardivement le 1er — l'erreur ne doit pas atterrir
    // dans lastLoadCurrentProfileError car son userId ne correspond
    // plus à l'identité courante.
    pendingCalls[0]!.reject(new Error('late failure'))
    await flushPromises()

    expect(store.lastLoadCurrentProfileError).toBeNull()
  })
})

describe('useProfileStore — loadCurrentProfile idempotence', () => {
  it('shares an in-flight request and never refetches a profile already loaded for the same user', async () => {
    let resolveRepo!: (value: MyProfile | undefined) => void
    const repo = createMockRepository({
      getMyProfile: () =>
        new Promise<MyProfile | undefined>((resolve) => {
          resolveRepo = resolve
        }),
    })
    mockRepositoryRef.current = repo

    const store = useProfileStore()
    await flushPromises()

    // Deux demandes pendant le RTT (navigation rapide accueil → compte) :
    // une seule requête.
    const first = store.loadCurrentProfile()
    const second = store.loadCurrentProfile()
    await Promise.resolve()
    expect(repo.__getMyProfileSpy).toHaveBeenCalledTimes(1)

    resolveRepo(makeMyProfile())
    await Promise.all([first, second])
    expect(store.currentProfile?.id).toBe(STUB_USER_ID)

    // Profil en place pour ce user : plus aucune requête.
    await store.loadCurrentProfile()
    expect(repo.__getMyProfileSpy).toHaveBeenCalledTimes(1)
  })
})

describe('useProfileStore — loadProfilesByIds', () => {
  it('is a no-op when ids is empty', async () => {
    const repo = createMockRepository({ initialProfiles: [makeProfile()] })
    mockRepositoryRef.current = repo

    const store = useProfileStore()
    await flushPromises()

    await store.loadProfilesByIds([])
    expect(repo.__getProfilesByIdsSpy).not.toHaveBeenCalled()
  })

  it('does not call the repo when all ids are already in cache', async () => {
    const profile = makeProfile()
    const repo = createMockRepository({ initialProfiles: [profile] })
    mockRepositoryRef.current = repo

    const store = useProfileStore()
    await flushPromises()

    await store.loadCurrentProfile()
    repo.__getProfilesByIdsSpy.mockClear()

    await store.loadProfilesByIds([STUB_USER_ID])
    expect(repo.__getProfilesByIdsSpy).not.toHaveBeenCalled()
  })

  it('deduplicates ids before calling the repo', async () => {
    const repo = createMockRepository({
      initialProfiles: [
        makeProfile({ id: OTHER_USER_ID, displayName: 'Bob' }),
        makeProfile({ id: THIRD_USER_ID, displayName: 'Carol' }),
      ],
    })
    mockRepositoryRef.current = repo

    const store = useProfileStore()
    await flushPromises()

    await store.loadProfilesByIds([OTHER_USER_ID, OTHER_USER_ID, THIRD_USER_ID])

    expect(repo.__getProfilesByIdsSpy).toHaveBeenCalledTimes(1)
    const idsPassed = repo.__getProfilesByIdsSpy.mock.calls[0]![0] as string[]
    expect(idsPassed).toHaveLength(2)
    expect(idsPassed).toEqual(expect.arrayContaining([OTHER_USER_ID, THIRD_USER_ID]))
  })

  it('excludes ids already cached from the repo call', async () => {
    const cached = makeProfile({ id: OTHER_USER_ID, displayName: 'Bob' })
    const repo = createMockRepository({
      initialProfiles: [cached, makeProfile({ id: THIRD_USER_ID, displayName: 'Carol' })],
    })
    mockRepositoryRef.current = repo

    const store = useProfileStore()
    await flushPromises()

    // Pré-charger OTHER_USER_ID dans le cache via une 1ère fetch.
    await store.loadProfilesByIds([OTHER_USER_ID])
    repo.__getProfilesByIdsSpy.mockClear()

    await store.loadProfilesByIds([OTHER_USER_ID, THIRD_USER_ID])

    expect(repo.__getProfilesByIdsSpy).toHaveBeenCalledTimes(1)
    expect(repo.__getProfilesByIdsSpy.mock.calls[0]![0]).toEqual([THIRD_USER_ID])
  })

  it('enriches profileById with the returned profiles', async () => {
    const bob = makeProfile({ id: OTHER_USER_ID, displayName: 'Bob' })
    const carol = makeProfile({ id: THIRD_USER_ID, displayName: 'Carol' })
    mockRepositoryRef.current = createMockRepository({
      initialProfiles: [bob, carol],
    })

    const store = useProfileStore()
    await flushPromises()

    await store.loadProfilesByIds([OTHER_USER_ID, THIRD_USER_ID])

    expect(store.profileById[OTHER_USER_ID]).toEqual(bob)
    expect(store.profileById[THIRD_USER_ID]).toEqual(carol)
  })

  it('does not throw and does not mutate profileById when the repo rejects', async () => {
    mockRepositoryRef.current = createMockRepository({
      getProfilesByIds: async () => {
        throw new Error('batch failed')
      },
    })

    const store = useProfileStore()
    await flushPromises()

    await expect(store.loadProfilesByIds([OTHER_USER_ID])).resolves.toBeUndefined()
    expect(store.profileById[OTHER_USER_ID]).toBeUndefined()
  })

  it('discards late writes when identity changed during the await', async () => {
    // Même approche que pour loadCurrentProfile : bumper l'identité via
    // switchIdentityTo. Ici un seul appel à getProfilesByIds est attendu
    // (initié par le test), donc resolveRepo n'est pas écrasé.
    stubUserRef.value = null
    stubSessionRef.value = { access_token: 'tok' }
    stubClaimsSub.value = STUB_USER_ID

    let resolveRepo!: (value: Profile[]) => void
    mockRepositoryRef.current = createMockRepository({
      getProfilesByIds: () =>
        new Promise<Profile[]>((resolve) => {
          resolveRepo = resolve
        }),
    })

    const store = useProfileStore()
    await flushPromises()

    const inflight = store.loadProfilesByIds([OTHER_USER_ID])
    // Laisse la microtask démarrer pour atteindre l'await sur le repo.
    await Promise.resolve()

    await switchIdentityTo(THIRD_USER_ID)

    resolveRepo([makeProfile({ id: OTHER_USER_ID, displayName: 'Bob' })])
    await inflight

    expect(store.profileById[OTHER_USER_ID]).toBeUndefined()
  })
})

describe('useProfileStore — updateMyProfile', () => {
  it('updates currentProfile and profileById with the server row on success', async () => {
    const before = makeProfile()
    mockRepositoryRef.current = createMockRepository({ initialProfiles: [before] })

    const store = useProfileStore()
    await flushPromises()
    await store.loadCurrentProfile()

    const returned = await store.updateMyProfile('Alice (updated)')

    expect(returned.displayName).toBe('Alice (updated)')
    expect(returned.updatedAt).not.toBe(NOW)
    expect(store.currentProfile?.displayName).toBe('Alice (updated)')
    expect(store.profileById[STUB_USER_ID]?.displayName).toBe('Alice (updated)')
  })

  it('throws "Aucun utilisateur authentifié" when there is no auth', async () => {
    stubUserRef.value = null
    stubSessionRef.value = null
    stubClaimsSub.value = null

    mockRepositoryRef.current = createMockRepository()
    const store = useProfileStore()
    await flushPromises()

    await expect(store.updateMyProfile('X')).rejects.toThrow(
      'Aucun utilisateur authentifié',
    )
  })

  it('propagates a repo error to the caller', async () => {
    const repoError = new Error('rls denied')
    mockRepositoryRef.current = createMockRepository({
      updateMyProfile: async () => {
        throw repoError
      },
    })

    const store = useProfileStore()
    await flushPromises()

    await expect(store.updateMyProfile('X')).rejects.toBe(repoError)
  })
})

describe('useProfileStore — updateMyProfileVisibility', () => {
  it('writes the setting for the authenticated user and mirrors it locally', async () => {
    const repo = createMockRepository({ initialProfiles: [makeProfile()] })
    mockRepositoryRef.current = repo

    const store = useProfileStore()
    await flushPromises()
    await store.loadCurrentProfile()
    expect(store.currentProfileVisibility).toBe('public')

    await store.updateMyProfileVisibility('private')

    expect(repo.__updateMyProfileVisibilitySpy).toHaveBeenCalledWith(STUB_USER_ID, 'private')
    expect(store.currentProfileVisibility).toBe('private')
    // L'identité et le cache ne bougent pas : un Profile ne porte pas le réglage.
    expect(Object.keys(store.currentProfile!).sort()).toEqual(
      ['createdAt', 'displayName', 'id', 'updatedAt'],
    )
  })

  it('throws "Aucun utilisateur authentifié" when there is no auth and never calls the repo', async () => {
    stubUserRef.value = null
    stubSessionRef.value = null
    stubClaimsSub.value = null

    const repo = createMockRepository()
    mockRepositoryRef.current = repo
    const store = useProfileStore()
    await flushPromises()

    await expect(store.updateMyProfileVisibility('private')).rejects.toThrow(
      'Aucun utilisateur authentifié',
    )
    expect(repo.__updateMyProfileVisibilitySpy).not.toHaveBeenCalled()
  })

  it('propagates a repo error and leaves the local setting untouched', async () => {
    const repoError = new Error('profile visibility update matched 0 row')
    mockRepositoryRef.current = createMockRepository({
      initialProfiles: [makeProfile()],
      updateMyProfileVisibility: async () => {
        throw repoError
      },
    })

    const store = useProfileStore()
    await flushPromises()
    await store.loadCurrentProfile()

    await expect(store.updateMyProfileVisibility('private')).rejects.toBe(repoError)
    expect(store.currentProfileVisibility).toBe('public')
  })

  it('discards the local mirror when identity changed during the await', async () => {
    stubUserRef.value = null
    stubSessionRef.value = { access_token: 'tok' }
    stubClaimsSub.value = STUB_USER_ID

    let resolveWrite!: () => void
    mockRepositoryRef.current = createMockRepository({
      initialProfiles: [makeProfile()],
      updateMyProfileVisibility: () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve
        }),
    })

    const store = useProfileStore()
    await flushPromises()
    await store.loadCurrentProfile()

    const inflight = store.updateMyProfileVisibility('private')
    await Promise.resolve()
    await switchIdentityTo(OTHER_USER_ID)

    resolveWrite()
    await inflight

    expect(store.currentProfileVisibility).toBe('public')
  })
})

describe('useProfileStore — reset on logout', () => {
  // Note : la transition login → logout repose sur la réactivité de
  // session.value, qui passe par useSupabaseSession() — un POJO
  // non réactif dans nos stubs. Le watcher d'auth ne re-fire pas sur
  // mutation post-mount des stubs. Le test ci-dessous initialise donc
  // le store DIRECTEMENT avec session=null pour exercer la branche
  // de reset du watcher (immediate fire), puis vérifie que tous les
  // refs profile sont à leur valeur par défaut. La transition active
  // est couverte par les smoke tests manuels (cf. plan C.2 §
  // Verification).
  it('initializes profile state at defaults when session is null on mount', async () => {
    stubSessionRef.value = null
    stubUserRef.value = null
    stubClaimsSub.value = null

    mockRepositoryRef.current = createMockRepository({
      initialProfiles: [makeProfile()],
    })

    const store = useProfileStore()
    await flushPromises()

    expect(store.currentProfile).toBeNull()
    expect(store.currentProfileVisibility).toBeNull()
    expect(store.profileById).toEqual({})
    expect(store.hasFetchedCurrentProfile).toBe(false)
    expect(store.lastLoadCurrentProfileError).toBeNull()
  })
})

describe('useProfileStore — non-regression with tournaments loading', () => {
  function makeTournament(overrides: Partial<Tournament> = {}): Tournament {
    return {
      id: crypto.randomUUID(),
      name: 'Tournoi',
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

  it('keeps loading tournaments even when loadCurrentProfile rejects', async () => {
    const tournament = makeTournament()
    const profileError = new Error('profile boom')

    mockRepositoryRef.current = createMockRepository({
      getMyProfile: async () => {
        throw profileError
      },
      getAllTournaments: async () => [tournament],
      getMyMemberships: async () => [],
    })

    const tournamentStore = useTournamentStore()
    const store = useProfileStore()
    // Comme l'accueil : profil courant en fire-and-forget, tournois awaités.
    void store.loadCurrentProfile()
    await tournamentStore.loadTournamentsForCurrentSession()
    // Une boucle supplémentaire car le fire-and-forget profile peut
    // résoudre dans une microtask postérieure.
    await flushPromises()

    expect(tournamentStore.tournaments).toEqual([tournament])
    expect(tournamentStore.hasFetchedTournaments).toBe(true)
    expect(tournamentStore.lastLoadTournamentsError).toBeNull()
    expect(store.lastLoadCurrentProfileError).toBe(profileError)
  })

  it('allows retrying loadTournamentsForCurrentSession even after a profile error', async () => {
    const tournament = makeTournament()

    mockRepositoryRef.current = createMockRepository({
      getMyProfile: async () => {
        throw new Error('profile boom')
      },
      getAllTournaments: async () => [tournament],
      getMyMemberships: async () => [],
    })

    const tournamentStore = useTournamentStore()
    const store = useProfileStore()
    void store.loadCurrentProfile()
    await tournamentStore.loadTournamentsForCurrentSession()
    await flushPromises()

    expect(tournamentStore.tournaments).toEqual([tournament])

    // Un nouvel appel explicite (équivalent du bouton "Réessayer")
    // ne doit pas être bloqué par l'état d'erreur profile.
    await tournamentStore.loadTournamentsForCurrentSession()

    expect(tournamentStore.lastLoadTournamentsError).toBeNull()
  })
})

describe('findAccountByDisplayName (H2.b)', () => {
  it('returns the matching account with its canonical display name, passing the raw input through', async () => {
    const repo = createMockRepository({
      initialProfiles: [makeProfile({ id: OTHER_USER_ID, displayName: 'Bob' })],
    })
    mockRepositoryRef.current = repo
    const store = useProfileStore()

    const account = await store.findAccountByDisplayName('  bob ')

    expect(account).toEqual({ userId: OTHER_USER_ID, displayName: 'Bob' })
    expect(repo.__findAccountByDisplayNameSpy).toHaveBeenCalledWith('  bob ')
  })

  it('returns null when no account bears that display name (nominal, not an error)', async () => {
    const store = useProfileStore()

    expect(await store.findAccountByDisplayName('Personne')).toBeNull()
  })

  it('does not feed profileById (an AccountMatch is not a full Profile)', async () => {
    mockRepositoryRef.current = createMockRepository({
      initialProfiles: [makeProfile({ id: OTHER_USER_ID, displayName: 'Bob' })],
    })
    const store = useProfileStore()

    await store.findAccountByDisplayName('Bob')

    expect(store.profileById[OTHER_USER_ID]).toBeUndefined()
  })

  it('propagates repository errors to the caller', async () => {
    mockRepositoryRef.current = createMockRepository({
      findAccountByDisplayName: async () => {
        throw new Error('lookup boom')
      },
    })
    const store = useProfileStore()

    await expect(store.findAccountByDisplayName('Bob')).rejects.toThrow('lookup boom')
  })

  it('throws without an authenticated identity and never calls the repository', async () => {
    stubUserRef.value = null
    stubClaimsSub.value = null
    const repo = createMockRepository()
    mockRepositoryRef.current = repo
    const store = useProfileStore()
    await flushPromises()

    await expect(store.findAccountByDisplayName('Bob')).rejects.toThrow(
      'Aucun utilisateur authentifié',
    )
    expect(repo.__findAccountByDisplayNameSpy).not.toHaveBeenCalled()
  })
})

// Les imports type TournamentMatch et Team sont déclarés pour aligner le boilerplate
// sur store.test.ts (createMockRepository typage), même si les tests
// profile ne créent pas d'équipes/matchs. Le bundle Vitest ne les
// élimine pas automatiquement parce qu'ils peuvent être référencés
// indirectement via TournamentRepository.
export type { TournamentMatch, Team }
