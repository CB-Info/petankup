import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { createRepository } from '../repositories'
import type { TournamentRepository } from '../repositories'
import type { Database } from '../types/database.types'
import type { CreateFreeMatchInput, FreeMatch } from '../types'
import { useIdentityStore } from './identity'

// Domaine match libre (H2) : le match consulté, sa création, sa suppression.
// Dépend du store identity seul (gardes, identité du créateur) — jamais des
// stores tournoi ni profil : la recherche d'un compte par pseudo et le
// pseudo du créateur sont des actions du store profil, consommées par la
// page de création, pas par ce store.
export const useFreeMatchStore = defineStore('freeMatch', () => {
  const client = useSupabaseClient<Database>()
  const session = useSupabaseSession()
  const repository: TournamentRepository = createRepository(client)
  const identityStore = useIdentityStore()

  // Match libre consulté (page /free-matches/[matchId]). Un seul slot, pas
  // de cache : vidé au début de chaque loadFreeMatch et au logout. Reste
  // null quand le match n'existe pas ou n'est pas visible (RLS) — la page
  // distingue « introuvable » d'une panne via lastLoadFreeMatchError.
  const currentFreeMatch = ref<FreeMatch | null>(null)

  // Erreur du dernier loadFreeMatch, ou null. Effacée au début de chaque
  // chargement (un Réessayer repart de zéro). Typé unknown — la page décide.
  const lastLoadFreeMatchError = ref<unknown>(null)

  // Opération en cours (chargement, création, suppression). Même sémantique
  // que les autres stores : booléen simple.
  const isLoading = ref(false)

  async function withLoading<T>(operation: () => Promise<T>): Promise<T> {
    isLoading.value = true
    try {
      return await operation()
    }
    finally {
      isLoading.value = false
    }
  }

  // Token monotone : seule la dernière requête a le droit d'écrire (course
  // entre deux chargements, ou chargement dépassé par une suppression).
  let lastLoadFreeMatchRequestId = 0

  // Charge le match consulté. Ne throw JAMAIS : l'erreur va dans
  // lastLoadFreeMatchError. Sans identité, no-op (la page est gatée sur
  // identity.currentUserId et relance au besoin). Double garde avant toute
  // écriture : token (course) ET identité inchangée (logout / changement de
  // compte pendant le await).
  async function loadFreeMatch(matchId: string): Promise<void> {
    const initialUserId = identityStore.currentUserId
    if (initialUserId === null) return

    const requestId = ++lastLoadFreeMatchRequestId
    return withLoading(async () => {
      // Clear-at-start : pas de flash de l'ancien match pendant le RTT.
      currentFreeMatch.value = null
      lastLoadFreeMatchError.value = null
      try {
        const freeMatch = await repository.getFreeMatchById(matchId)
        if (requestId !== lastLoadFreeMatchRequestId) return
        if (identityStore.currentUserId !== initialUserId) return
        currentFreeMatch.value = freeMatch ?? null
      }
      catch (error) {
        if (requestId !== lastLoadFreeMatchRequestId) return
        if (identityStore.currentUserId !== initialUserId) return
        lastLoadFreeMatchError.value = error
      }
    })
  }

  // Crée le match via la RPC et retourne son id. THROW en cas d'erreur —
  // FreeMatchError typée (règle métier refusée côté base) ou Error standard
  // (réseau) — la page dispatch. Le créateur doit figurer dans
  // input.players (la base l'exige : not_participant) ; la garde d'identité
  // évite un appel sans session.
  async function createFreeMatch(input: CreateFreeMatchInput): Promise<string> {
    identityStore.requireAuthenticatedUserId()
    return withLoading(() => repository.createFreeMatch(input))
  }

  // Supprime un match (créateur seul côté RLS ; 0 ligne silencieuse sinon).
  // THROW en cas d'erreur. Au succès : invalide tout chargement en vol (une
  // réponse tardive ne doit pas ressusciter le match) et vide le match
  // consulté s'il s'agit du même.
  async function deleteFreeMatch(matchId: string): Promise<void> {
    identityStore.requireAuthenticatedUserId()
    await withLoading(() => repository.deleteFreeMatch(matchId))
    ++lastLoadFreeMatchRequestId
    if (currentFreeMatch.value?.id === matchId) {
      currentFreeMatch.value = null
    }
  }

  // Droit de supprimer le match consulté : créateur connu ET identique à
  // l'identité courante. createdBy null (compte du créateur supprimé) →
  // plus personne ne peut le supprimer.
  const isCreatorOfCurrentFreeMatch = computed<boolean>(() => {
    const freeMatch = currentFreeMatch.value
    if (freeMatch === null || freeMatch.createdBy === null) return false
    return freeMatch.createdBy === identityStore.currentUserId
  })

  // Reset au logout (session null) : rien ne survit à une session. Le bump
  // du token invalide tout chargement en vol. immediate : couvre le boot
  // sans session.
  watch(
    () => session.value,
    (currentSession) => {
      if (currentSession === null) {
        ++lastLoadFreeMatchRequestId
        currentFreeMatch.value = null
        lastLoadFreeMatchError.value = null
        isLoading.value = false
      }
    },
    { immediate: true },
  )

  return {
    currentFreeMatch,
    lastLoadFreeMatchError,
    isLoading,
    isCreatorOfCurrentFreeMatch,
    loadFreeMatch,
    createFreeMatch,
    deleteFreeMatch,
  }
})
