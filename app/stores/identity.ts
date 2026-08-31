import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { Database } from '../types/database.types'

// Identité d'authentification de la session. C'est une information de
// session, pas une donnée de profil : tous les domaines en ont besoin
// (tournois, profils, et demain les matchs libres). Dépendance à sens
// unique — les stores de domaine dépendent de celui-ci, jamais l'inverse.
//
// C'est ICI que l'identité se résout, pour toute l'application : le plugin
// app/plugins/identity.client.ts instancie ce store au boot (après le plugin
// @nuxtjs/supabase, qui a déjà hydraté la session), et le watcher en bas de
// fichier résout le sub — useSupabaseUser d'abord, getClaims en repli. Les
// pages tirent ensuite les données qu'elles affichent, gatées sur
// currentUserId ; aucune n'a plus à instancier un store pour amorcer l'auth.
export const useIdentityStore = defineStore('identity', () => {
  const client = useSupabaseClient<Database>()
  const user = useSupabaseUser()
  const session = useSupabaseSession()

  // Sub résolu via client.auth.getClaims() — repli utilisé quand
  // useSupabaseUser n'est pas (encore) hydraté. Il ne l'est jamais au
  // montage initial : le hook page:start du module ne fire pas pour la
  // transition initiale (cf. CLAUDE.md), donc sur tout chargement à froid
  // l'identité passe par ici. Hydraté par resolveForCurrentSession.
  const resolvedUserId = ref<string | null>(null)

  // Source unique de l'identité utilisateur côté store. useSupabaseUser
  // est typé Ref<JwtPayload | null> par @nuxtjs/supabase v2 ; l'ID est
  // dans `sub` (RFC 7519), jamais dans `.id`. On préfère le sub runtime
  // quand il est disponible (chemin chaud sans appel réseau), et on
  // retombe sur resolvedUserId quand non. Variante NULLABLE utilisable
  // dans les contextes tolérants (computed évalué pendant un logout en
  // cours, où on veut une liste vide plutôt qu'une exception). Lu par les
  // stores de domaine via le proxy du store (jamais destructuré : les gardes
  // anti-écriture tardive le relisent après chaque await).
  //
  // Les deux sources sont lues inconditionnellement : avec `a ?? b`, un
  // user.sub disponible court-circuiterait la lecture de resolvedUserId, et
  // le computed ne la tracerait jamais — il resterait figé si user.sub cesse
  // ensuite d'être réactif (stubs de test) ou disponible.
  const currentUserId = computed<string | null>(() => {
    const subFromRuntimeUser = user.value?.sub ?? null
    const subFromClaims = resolvedUserId.value
    return subFromRuntimeUser ?? subFromClaims
  })

  // Erreur de la dernière résolution d'identité (getClaims en échec, ou
  // session sans sub), ou null. Effacée à toute résolution réussie et au
  // logout. Typé `unknown` — les pages décident de l'affichage.
  const lastResolveError = ref<unknown>(null)

  // « Identité indisponible » = aucune identité connue ET une résolution en
  // échec. C'est le SEUL signal d'échec que les pages consomment : une
  // erreur de getClaims survenue alors que l'identité est déjà connue (le
  // module remet user.sub à null quand SON getClaims échoue) ne doit jamais
  // peindre un écran d'erreur sur des données valides.
  const identityUnavailable = computed<boolean>(
    () => currentUserId.value === null && lastResolveError.value !== null,
  )

  // Garde-fou : appelé par les actions qui ont besoin de peupler
  // ownerId à la création (createTournament). Lit la même chaîne de
  // fallback que currentUserId — useSupabaseUser?.sub d'abord, puis
  // resolvedUserId (hydraté par resolveForCurrentSession via
  // getClaims). Throw si les deux sont null.
  //
  // Attention : @nuxtjs/supabase v2 type useSupabaseUser comme
  // `Ref<JwtPayload | null>`, pas `Ref<User | null>`. Le ref est hydraté
  // via getClaims() qui retourne le payload JWT décodé. L'ID utilisateur
  // est donc dans `sub` (RFC 7519), pas dans `id` qui n'existe pas.
  // Lire `.id` retourne `undefined` silencieusement (index signature
  // [key: string]: any sur JwtPayload), ce qui faisait passer ownerId à
  // undefined et cassait l'INSERT côté RLS.
  function requireAuthenticatedUserId(): string {
    const sub = user.value?.sub ?? resolvedUserId.value
    if (sub === null) {
      throw new Error('Aucun utilisateur authentifié')
    }
    return sub
  }

  // Récupère le sub via getClaims(). Trois cas couverts :
  //  - succès : data.claims.sub renvoyé.
  //  - erreur Supabase : throw avec le message du provider.
  //  - pas de session connue côté client (data: null, error: null) :
  //    null renvoyé (le caller traduit en lastResolveError).
  async function resolveUserIdFromClaims(): Promise<string | null> {
    const { data, error } = await client.auth.getClaims()
    if (error !== null) throw new Error(error.message)
    return data?.claims.sub ?? null
  }

  // Token monotone qui invalide les résolutions d'identité tardives : si la
  // session change pendant un await getClaims(), la réponse de l'ancienne
  // session ne doit pas écrire resolvedUserId. Même pattern que les tokens
  // de requête des stores de domaine.
  let lastAuthContextRequestId = 0

  // Résout l'identité de la session courante. Appelée par le watcher
  // ci-dessous (boot, magic link, changement de compte) et par les boutons
  // « Réessayer » des pages quand l'identité est indisponible. Ne throw
  // JAMAIS : les erreurs vont dans lastResolveError, les pages observent
  // identityUnavailable. Chemin chaud (user.value.sub disponible) : aucun
  // appel réseau ; sinon getClaims(), invalidé par le token si la session
  // a changé entre-temps. Toute résolution réussie efface l'erreur
  // précédente (un getClaims raté au boot peut être rattrapé par
  // l'hydratation de user.sub par le module).
  async function resolveForCurrentSession(): Promise<void> {
    const requestId = ++lastAuthContextRequestId
    if (session.value === null) return

    let sub: string | null = user.value?.sub ?? null
    if (sub === null) {
      try {
        sub = await resolveUserIdFromClaims()
      }
      catch (error) {
        if (requestId !== lastAuthContextRequestId) return
        lastResolveError.value = error
        return
      }
    }
    if (requestId !== lastAuthContextRequestId) return
    if (sub === null) {
      lastResolveError.value = new Error(
        'Identité utilisateur introuvable dans la session.',
      )
      return
    }

    lastResolveError.value = null
    resolvedUserId.value = sub
  }

  // Watcher composé sur [session, user.sub]. Couvre :
  //  - le boot avec session hydratée (immediate fire, depuis le plugin) ;
  //  - le flow magic-link où useSupabaseUser tarde à s'hydrater
  //    post-/confirm (CLAUDE.md) — la session, elle, est fiable, et le
  //    repli getClaims() fournit le sub si user.value est encore null ;
  //  - le changement de compte (logout A → null → login B → résolution B).
  // Sur logout : reset synchrone + bump du token pour invalider toute
  // résolution encore en vol. Les stores de domaine ont leur propre reset.
  watch(
    [() => session.value, () => user.value?.sub],
    ([currentSession]) => {
      if (currentSession === null) {
        ++lastAuthContextRequestId
        resolvedUserId.value = null
        lastResolveError.value = null
        return
      }
      void resolveForCurrentSession()
    },
    { immediate: true },
  )

  return {
    resolvedUserId,
    currentUserId,
    lastResolveError,
    identityUnavailable,
    requireAuthenticatedUserId,
    resolveForCurrentSession,
  }
})
