import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { createRepository } from '../repositories'
import type { TournamentRepository } from '../repositories'
import type { Database } from '../types/database.types'
import type { Profile, UserProfileBundle } from '../types'
import { useIdentityStore } from './identity'

// Domaine profil : profil du user authentifié, cache des profils visibles,
// bundle du profil consulté. Extrait du store tournament (déplacement pur).
//
// L'identité vient du store identity, lue via son proxy à chaque usage —
// les gardes anti-écriture tardive relisent currentUserId après chaque
// await. Le profil courant est chargé à la demande des pages qui l'affichent
// (accueil, compte), gatées sur identity.currentUserId : ce store n'appelle
// rien de lui-même au setup.
export const useProfileStore = defineStore('profile', () => {
  const client = useSupabaseClient<Database>()
  const session = useSupabaseSession()
  const repository: TournamentRepository = createRepository(client)
  const identityStore = useIdentityStore()

  // Cache des profils visibles. Record (pas Map) pour que Vue 3 tracke
  // correctement les mutations directes `profileById.value[id] = ...`.
  // Hydraté par loadCurrentProfile (self) et loadProfilesByIds (batch).
  // Reset au logout (cf. watcher d'auth en bas du store).
  const profileById = ref<Record<string, Profile>>({})

  // Profil du user authentifié. Null tant que loadCurrentProfile n'a
  // pas résolu (ou si trigger DB / backfill a raté pour ce user, cas
  // dégénéré qui matérialise lastLoadCurrentProfileError).
  const currentProfile = ref<Profile | null>(null)

  // True dès qu'un loadCurrentProfile a terminé (succès OU échec)
  // pour la session courante. Permet à la UI (C.3) de distinguer
  // "en cours de chargement" de "résolu sans profil". Reset au
  // logout. N'est JAMAIS un critère de "home prête" — la home
  // dépend uniquement de hasFetchedTournaments.
  const hasFetchedCurrentProfile = ref(false)

  // Erreur du dernier loadCurrentProfile, ou null. Disjoint de
  // lastLoadTournamentsError : un échec profile ne pollue jamais
  // l'erreur tournaments et vice-versa. Typé `unknown` — la UI (C.3)
  // décide de l'affichage.
  const lastLoadCurrentProfileError = ref<unknown>(null)

  // Bundle du profil actuellement consulté (page /profile/[userId], Phase K) :
  // { profile, stats, results }. Un seul slot — pas de cache par userId (cf.
  // cadrage Phase J). Cleared au début de chaque loadUserProfile et au logout.
  const currentProfileBundle = ref<UserProfileBundle | null>(null)

  // True dès qu'un loadUserProfile a réussi pour la session courante. Reste
  // false en cas d'erreur (distingue "pas chargé" de "chargé sans résultat"),
  // cohérent avec hasFetchedTournaments. Reset au logout.
  const hasFetchedProfileBundle = ref(false)

  // Erreur du dernier loadUserProfile, ou null. Typé `unknown` — l'UI
  // (Phase K) décide de l'affichage. Disjoint des autres erreurs du store.
  const lastLoadProfileBundleError = ref<unknown>(null)

  // Flag de persistance en cours, propre à ce store (même sémantique que
  // celui du store tournoi : booléen simple, acceptable pour le MVP).
  const isLoading = ref(false)

  // Bascule isLoading le temps de l'opération. Toute action qui touche
  // au repository est encapsulée par ce wrapper pour garder le toggle
  // centralisé (et symétrique en cas de throw).
  async function withLoading<T>(operation: () => Promise<T>): Promise<T> {
    isLoading.value = true
    try {
      return await operation()
    }
    finally {
      isLoading.value = false
    }
  }

  // --- Profils ---

  // Charge le profil du user authentifié. Fire-and-forget : capture
  // les erreurs en interne dans lastLoadCurrentProfileError, ne throw
  // JAMAIS. Demandé par les pages qui affichent le profil courant (accueil,
  // compte), gatées sur l'identité ; sans identité, no-op.
  //
  // Deux gardes contre les requêtes en double :
  //  - en vol : une seconde demande pour le même user pendant le RTT
  //    (navigation rapide accueil → compte, Réessayer) reçoit la promesse
  //    déjà en cours ;
  //  - déjà chargé : pas de refetch une fois le profil de CE user en place.
  //    Un échec (réseau, profil absent) reste retentable : le bouton
  //    « Réessayer » et un remontage relancent la requête.
  let pendingCurrentProfileLoad: { userId: string, promise: Promise<void> } | null = null

  async function loadCurrentProfile(): Promise<void> {
    const userId = identityStore.currentUserId
    if (userId === null) return
    if (pendingCurrentProfileLoad !== null && pendingCurrentProfileLoad.userId === userId) {
      return pendingCurrentProfileLoad.promise
    }
    if (currentProfile.value?.id === userId && hasFetchedCurrentProfile.value) return

    const promise = fetchCurrentProfile(userId).finally(() => {
      // Ne libère le slot que s'il est encore le sien : une demande pour un
      // autre user (changement de compte en plein vol) l'a peut-être
      // déjà remplacé.
      if (pendingCurrentProfileLoad?.promise === promise) {
        pendingCurrentProfileLoad = null
      }
    })
    pendingCurrentProfileLoad = { userId, promise }
    return promise
  }

  // Requête et écritures de loadCurrentProfile, pour un user donné.
  //
  // Garde anti-écriture tardive : userId capturé au départ. Si
  // l'identité change pendant le await (logout, switch de compte),
  // on abandonne TOUTES les écritures vers le state pour ne pas
  // polluer celui du nouveau user avec la réponse d'un ancien call.
  // Pattern aligné sur loadTournaments.
  async function fetchCurrentProfile(userId: string): Promise<void> {
    try {
      const profile = await repository.getProfileById(userId)
      if (identityStore.currentUserId !== userId) return

      if (profile === undefined) {
        // Cas dégénéré : le trigger ou le backfill ont raté pour ce
        // user. On signale via lastLoadCurrentProfileError mais on
        // ne bloque pas la session.
        lastLoadCurrentProfileError.value = new Error('Profil introuvable.')
        return
      }

      currentProfile.value = profile
      profileById.value[profile.id] = profile
      lastLoadCurrentProfileError.value = null
    }
    catch (error) {
      if (identityStore.currentUserId !== userId) return
      lastLoadCurrentProfileError.value = error
    }
    finally {
      // hasFetchedCurrentProfile = "on a essayé pour CE user".
      // Même garde anti-écriture tardive dans le finally.
      if (identityStore.currentUserId === userId) {
        hasFetchedCurrentProfile.value = true
      }
    }
  }

  // Hydrate profileById en batch avec les ids manquants du cache.
  // Dédupe les ids, exclut ceux déjà connus, et déléguie au repo.
  // Best-effort : capture les erreurs en interne sans state d'erreur
  // store dédié — l'UI tombera sur le fallback (member_email, etc.)
  // si profileById[id] est absent. Pas de toast.
  //
  // Garde anti-écriture tardive identique à loadCurrentProfile.
  async function loadProfilesByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return

    const initialUserId = identityStore.currentUserId
    if (initialUserId === null) return

    const uniqueIds = [...new Set(ids)]
    const missingIds = uniqueIds.filter(id => !(id in profileById.value))
    if (missingIds.length === 0) return

    try {
      const profiles = await repository.getProfilesByIds(missingIds)
      if (identityStore.currentUserId !== initialUserId) return

      for (const profile of profiles) {
        profileById.value[profile.id] = profile
      }
    }
    catch (error) {
      console.warn('[store] loadProfilesByIds failed:', error)
    }
  }

  // Update du display_name du user courant. Asymétrie volontaire vs
  // loadCurrentProfile : THROW en cas d'erreur — l'UI (C.3) catch et
  // affiche un toast. Au succès, met à jour currentProfile et
  // profileById avec le row serveur (updated_at rafraîchi par le
  // trigger DB).
  //
  // Garde anti-écriture tardive sur les écritures de cache : si
  // l'identité change pendant le await, le Profile est quand même
  // retourné (l'update DB a eu lieu) mais on n'écrit pas dans
  // currentProfile/profileById pour ne pas polluer le state du
  // nouveau user.
  async function updateMyProfile(displayName: string): Promise<Profile> {
    const userId = identityStore.requireAuthenticatedUserId()
    const updated = await repository.updateMyProfile(userId, displayName)

    if (identityStore.currentUserId === userId) {
      currentProfile.value = updated
      profileById.value[updated.id] = updated
    }

    return updated
  }

  // Compteur monotone pour invalider les réponses tardives de
  // loadUserProfile en cas de loads concurrents (navigation rapide entre
  // deux profils). Pattern identique à lastLoadTournamentRequestId.
  let lastLoadProfileBundleRequestId = 0

  // Charge le bundle profil (profil + stats agrégées + journal de tournois)
  // d'un user quelconque via la RPC get_user_profile. Capture les erreurs
  // en interne (lastLoadProfileBundleError), ne throw JAMAIS — pattern
  // aligné sur loadCurrentProfile.
  //
  // initialUserId = identité du VIEWER (pas du profil consulté), capturée
  // pour la garde anti-écriture tardive. userId = profil consulté (peut être
  // n'importe qui). Double garde avant toute écriture : token monotone
  // (race load A/B) ET identité du viewer (logout/switch pendant le await).
  async function loadUserProfile(userId: string): Promise<void> {
    const initialUserId = identityStore.currentUserId
    if (initialUserId === null) return

    const requestId = ++lastLoadProfileBundleRequestId
    return withLoading(async () => {
      // Clear-at-start : pas de flash de l'ancien profil pendant le RTT.
      currentProfileBundle.value = null

      try {
        const bundle = await repository.getUserProfile(userId)
        if (requestId !== lastLoadProfileBundleRequestId) return
        if (identityStore.currentUserId !== initialUserId) return

        currentProfileBundle.value = bundle
        hasFetchedProfileBundle.value = true
        lastLoadProfileBundleError.value = null

        // Pré-hydratation best-effort des pseudos des coéquipiers liés à un
        // compte, pour que l'UI (Phase K) puisse résoudre le pseudo live via
        // getPlayerDisplayName. Fire-and-forget : pas d'await, ne bloque pas
        // le retour de loadUserProfile. loadProfilesByIds dédupe et filtre le
        // cache ; on exclut le profil consulté lui-même (déjà dans le bundle).
        const teammateUserIds = bundle.results
          .flatMap(result => result.teammates)
          .map(teammate => teammate.userId)
          .filter(
            (teammateUserId): teammateUserId is string =>
              teammateUserId !== null && teammateUserId !== userId,
          )
        if (teammateUserIds.length > 0) {
          void loadProfilesByIds(teammateUserIds)
        }
      }
      catch (error) {
        if (requestId !== lastLoadProfileBundleRequestId) return
        if (identityStore.currentUserId !== initialUserId) return
        // hasFetchedProfileBundle reste false : distingue "pas chargé" de
        // "chargé sans résultat".
        lastLoadProfileBundleError.value = error
      }
    })
  }

  // Reset au logout (session null) : rien du domaine profil ne survit à
  // une session. Le bump du token invalide tout loadUserProfile en vol.
  // immediate : couvre le boot sans session.
  watch(
    () => session.value,
    (currentSession) => {
      if (currentSession === null) {
        profileById.value = {}
        currentProfile.value = null
        hasFetchedCurrentProfile.value = false
        lastLoadCurrentProfileError.value = null
        ++lastLoadProfileBundleRequestId
        currentProfileBundle.value = null
        hasFetchedProfileBundle.value = false
        lastLoadProfileBundleError.value = null
      }
    },
    { immediate: true },
  )

  return {
    profileById,
    currentProfile,
    hasFetchedCurrentProfile,
    lastLoadCurrentProfileError,
    currentProfileBundle,
    hasFetchedProfileBundle,
    lastLoadProfileBundleError,
    isLoading,
    loadCurrentProfile,
    loadProfilesByIds,
    updateMyProfile,
    loadUserProfile,
  }
})
