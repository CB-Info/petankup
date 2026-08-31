import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'

// Tests du store identity : résolution de l'identité de session (déplacée du
// watcher du store tournament — bloc « auth context » — vers ce store,
// amorcé en prod par app/plugins/identity.client.ts).
//
// Setup aligné sur tests/unit/store.test.ts : stubs hoisted pour
// useSupabaseUser / useSupabaseSession / useSupabaseClient. Pas de
// repository : ce store ne charge aucune donnée.
//
// Piège : les stubs sont des POJO non réactifs. Muter stubUserRef après le
// montage ne réveille ni le watcher ni le computed currentUserId — seule
// resolvedUserId (ref Vue) est réactive, et seule resolveForCurrentSession
// l'écrit (chemin chaud : elle relit user.value.sub directement).

const STUB_USER_ID = '99999999-9999-4999-8999-999999999999'

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

import { useIdentityStore } from '../../app/stores/identity'

function claimsFor(sub: string): GetClaimsResult {
  return {
    data: { claims: { sub }, header: {}, signature: new Uint8Array() },
    error: null,
  }
}

beforeEach(() => {
  stubUserRef.value = { sub: STUB_USER_ID }
  stubSessionRef.value = { access_token: 'stub-token' }
  stubClaimsSub.value = STUB_USER_ID
  stubGetClaimsImpl.fn = null
  supabaseClientStub.auth.getClaims.mockClear()
  setActivePinia(createPinia())
})

describe('useIdentityStore — resolution', () => {
  it('resolves the identity through getClaims when user.value is null at mount (magic-link scenario)', async () => {
    // Arrivée sur / juste après un magic-link : la session est hydratée,
    // useSupabaseUser ne l'est pas encore (cf. CLAUDE.md). Le store doit
    // retomber sur getClaims() pour résoudre le sub — sans page impliquée.
    stubUserRef.value = null
    stubSessionRef.value = { access_token: 'magic-link-token' }
    stubClaimsSub.value = STUB_USER_ID

    const store = useIdentityStore()
    await flushPromises()

    expect(supabaseClientStub.auth.getClaims).toHaveBeenCalledTimes(1)
    expect(store.currentUserId).toBe(STUB_USER_ID)
    expect(store.resolvedUserId).toBe(STUB_USER_ID)
    expect(store.lastResolveError).toBeNull()
    expect(store.identityUnavailable).toBe(false)
  })

  it('prefers user.value.sub over getClaims when both are available (hot path)', async () => {
    // Cas nominal après navigation : useSupabaseUser est hydraté. On ne
    // doit pas appeler getClaims(), c'est un coût inutile sur le chemin chaud.
    const store = useIdentityStore()
    await flushPromises()

    expect(supabaseClientStub.auth.getClaims).not.toHaveBeenCalled()
    expect(store.currentUserId).toBe(STUB_USER_ID)
    expect(store.resolvedUserId).toBe(STUB_USER_ID)
  })

  it('re-resolves to the new sub after an account switch', async () => {
    const USER_B = '11111111-1111-4111-8111-111111111111'
    const store = useIdentityStore()
    await flushPromises()
    expect(store.currentUserId).toBe(STUB_USER_ID)

    // Les stubs ne sont pas réactifs : on rejoue l'action publique (chemin
    // emprunté par le watcher en prod, et par les boutons « Réessayer »).
    stubUserRef.value = { sub: USER_B }
    stubClaimsSub.value = USER_B
    await store.resolveForCurrentSession()

    expect(store.currentUserId).toBe(USER_B)
    expect(store.resolvedUserId).toBe(USER_B)
  })

  it('surfaces an error and reports the identity as unavailable when getClaims fails', async () => {
    stubUserRef.value = null
    stubGetClaimsImpl.fn = async () => ({
      data: null,
      error: { message: 'Network error during getClaims' },
    })

    // Le plugin instancie ce store au boot : la création ne doit jamais
    // lever, même si la résolution échoue.
    let store!: ReturnType<typeof useIdentityStore>
    expect(() => {
      store = useIdentityStore()
    }).not.toThrow()
    await flushPromises()

    expect(store.lastResolveError).not.toBeNull()
    expect((store.lastResolveError as Error).message).toBe(
      'Network error during getClaims',
    )
    expect(store.currentUserId).toBeNull()
    expect(store.identityUnavailable).toBe(true)
  })

  it('surfaces an error when the claims carry no sub', async () => {
    // getClaims retourne data: null + error: null (« pas de session connue
    // côté client ») : branche « Identité utilisateur introuvable ».
    stubUserRef.value = null
    stubClaimsSub.value = null

    const store = useIdentityStore()
    await flushPromises()

    expect((store.lastResolveError as Error).message).toBe(
      'Identité utilisateur introuvable dans la session.',
    )
    expect(store.currentUserId).toBeNull()
    expect(store.identityUnavailable).toBe(true)
  })

  it('ignores a late getClaims response when a newer resolution started in the meantime (anti-race)', async () => {
    // Le watcher fire au montage avec user.value null et déclenche un
    // getClaims() qui reste pendu ; un 2e appel survient (retry, ou re-fire
    // sur changement de session). Le 1er, en revenant, doit voir que le
    // token a été bumpé et sortir sans rien écrire — sinon resolvedUserId
    // d'une session obsolète fuirait entre comptes.
    stubUserRef.value = null
    const claimsResolvers: Array<(value: GetClaimsResult) => void> = []
    stubGetClaimsImpl.fn = () =>
      new Promise<GetClaimsResult>((resolve) => {
        claimsResolvers.push(resolve)
      })

    const store = useIdentityStore()
    await Promise.resolve()
    expect(claimsResolvers).toHaveLength(1)

    const secondCall = store.resolveForCurrentSession()
    await Promise.resolve()
    expect(claimsResolvers).toHaveLength(2)

    // Réponse « tardive » du 1er getClaims : ignorée.
    claimsResolvers[0]!(claimsFor(STUB_USER_ID))
    await flushPromises()
    expect(store.resolvedUserId).toBeNull()

    // Réponse du 2e : c'est elle qui écrit l'identité.
    claimsResolvers[1]!(claimsFor(STUB_USER_ID))
    await secondCall
    expect(store.resolvedUserId).toBe(STUB_USER_ID)
    expect(store.currentUserId).toBe(STUB_USER_ID)
  })

  it('clears a previous resolution error once a later resolution succeeds', async () => {
    // getClaims échoue au boot ; plus tard le module hydrate user.sub (ou
    // « Réessayer » relance) : l'erreur ne doit pas survivre au succès.
    stubUserRef.value = null
    stubGetClaimsImpl.fn = async () => ({
      data: null,
      error: { message: 'boot failure' },
    })

    const store = useIdentityStore()
    await flushPromises()
    expect(store.identityUnavailable).toBe(true)

    stubGetClaimsImpl.fn = null
    stubUserRef.value = { sub: STUB_USER_ID }
    await store.resolveForCurrentSession()

    expect(store.lastResolveError).toBeNull()
    expect(store.identityUnavailable).toBe(false)
    expect(store.currentUserId).toBe(STUB_USER_ID)
  })
})
