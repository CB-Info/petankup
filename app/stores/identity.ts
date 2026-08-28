import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { Database } from '../types/database.types'

// Identité d'authentification de la session. C'est une information de
// session, pas une donnée de profil : tous les domaines en ont besoin
// (tournois, profils, et demain les matchs libres). Dépendance à sens
// unique — les stores de domaine dépendent de celui-ci, jamais l'inverse.
//
// Ce store ne fait AUCUN appel réseau de lui-même : resolvedUserId est
// hydraté par l'orchestration d'auth du store tournoi
// (loadTournamentsForCurrentSession), qui reste l'unique point d'entrée —
// c'est elle qui appelle resolveUserIdFromClaims puis setResolvedUserId.
export const useIdentityStore = defineStore('identity', () => {
  const client = useSupabaseClient<Database>()
  const user = useSupabaseUser()
  const session = useSupabaseSession()

  // Sub résolu via client.auth.getClaims() — fallback utilisé quand
  // useSupabaseUser n'est pas (encore) hydraté. Hydraté par
  // loadTournamentsForCurrentSession avant le premier fetch sur le flow
  // magic-link (cf. CLAUDE.md : page:start ne fire pas pour
  // /confirm → /). Helper INTERNE : non exposé dans le `return`.
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
  const currentUserId = computed<string | null>(
    () => user.value?.sub ?? resolvedUserId.value,
  )

  // Écriture explicite de l'identité résolue (getClaims), réservée à
  // l'orchestration d'auth du store tournoi.
  function setResolvedUserId(sub: string | null): void {
    resolvedUserId.value = sub
  }

  // Garde-fou : appelé par les actions qui ont besoin de peupler
  // ownerId à la création (createTournament). Lit la même chaîne de
  // fallback que currentUserId — useSupabaseUser?.sub d'abord, puis
  // resolvedUserId (hydraté par loadTournamentsForCurrentSession via
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
  //    null renvoyé (le caller traduit en lastLoadTournamentsError).
  async function resolveUserIdFromClaims(): Promise<string | null> {
    const { data, error } = await client.auth.getClaims()
    if (error !== null) throw new Error(error.message)
    return data?.claims.sub ?? null
  }

  // L'identité résolue ne survit pas à la session : reset synchrone au
  // logout (session null). immediate : couvre le boot sans session.
  watch(
    () => session.value,
    (currentSession) => {
      if (currentSession === null) {
        resolvedUserId.value = null
      }
    },
    { immediate: true },
  )

  return {
    resolvedUserId,
    currentUserId,
    setResolvedUserId,
    requireAuthenticatedUserId,
    resolveUserIdFromClaims,
  }
})
