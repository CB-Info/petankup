import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { createRepository } from '../repositories'
import type { TournamentRepository } from '../repositories'
import type { Database } from '../types/database.types'
import type { FriendshipBundle, FriendshipRequestOutcome, FriendshipStatus } from '../types'
import {
  deriveFriendshipStatus,
  withFriendInsertedAlphabetically,
  withFriendshipEntryRemoved,
} from '../utils/friendship'
import { useIdentityStore } from './identity'

// Domaine amitié (A3) : les trois listes (amis, demandes reçues, demandes
// envoyées) et les cinq actions. Dépend du store identity seul (gardes,
// invalidation au changement de compte) — jamais des stores tournoi ni
// profil : la recherche d'un compte par pseudo est une action du store
// profil, consommée par l'écran des amis, pas par ce store.
export const useFriendshipStore = defineStore('friendship', () => {
  const client = useSupabaseClient<Database>()
  const session = useSupabaseSession()
  const repository: TournamentRepository = createRepository(client)
  const identityStore = useIdentityStore()

  // Les trois listes. null = jamais chargé (un bundle VIDE est
  // { [], [], [] }, jamais null) : les écrans gardent leurs branches
  // Chargement / Erreur sur ce null — un bundle en place reste affiché
  // pendant les rafraîchissements (pas de clignotement).
  const friendshipBundle = ref<FriendshipBundle | null>(null)

  // Erreur du dernier (re)chargement, ou null. Effacée au début de chaque
  // chargement (un Réessayer repart de zéro). Typé unknown — la page décide.
  const lastLoadFriendshipsError = ref<unknown>(null)

  // Chargement du bundle en cours. Distinct des actions par bouton
  // (pendingAction) : ce flag ne pilote l'écran que tant que le bundle est
  // null.
  const isLoadingBundle = ref(false)

  // L'action en vol (accepter, refuser, annuler, retirer) et sa cible —
  // pour un :loading PAR BOUTON, jamais un voile global : taper « Refuser »
  // ne doit pas allumer le spinner d'« Accepter » sur la même ligne.
  type FriendshipActionKind = 'accept' | 'refuse' | 'cancel' | 'remove'
  const pendingAction = ref<{ userId: string, kind: FriendshipActionKind } | null>(null)

  // Le bouton (userId, kind) est-il en vol ? Sans kind : une action
  // quelconque vise-t-elle cette personne (désactivation du bouton frère).
  function isActionPending(userId: string, kind?: FriendshipActionKind): boolean {
    const action = pendingAction.value
    if (action === null || action.userId !== userId) return false
    return kind === undefined || action.kind === kind
  }

  // Token monotone : seule la dernière requête a le droit d'écrire (course
  // entre deux chargements, ou chargement dépassé par une mutation locale).
  let lastLoadFriendshipsRequestId = 0

  // Déduplication des chargements en vol, clé par user (un changement de
  // compte en plein vol ne doit pas servir la promesse de l'ancien compte).
  let pendingLoad: { userId: string, promise: Promise<void> } | null = null

  // Après une ÉCRITURE, un chargement parti avant elle ne vaut plus rien :
  // ses écritures sont interdites (token) ET sa promesse ne doit plus être
  // servie par la déduplication (sinon un refresh post-écriture serait un
  // no-op silencieux sur des données pré-écriture).
  function invalidateInFlightLoad(): void {
    ++lastLoadFriendshipsRequestId
    pendingLoad = null
  }

  // Charge les listes si elles ne le sont pas déjà (lazy) : no-op quand le
  // bundle est en place, promesse partagée quand un chargement est en vol.
  // Ne throw JAMAIS : l'erreur va dans lastLoadFriendshipsError.
  async function loadFriendships(): Promise<void> {
    const userId = identityStore.currentUserId
    if (userId === null) return
    if (pendingLoad !== null && pendingLoad.userId === userId) {
      return pendingLoad.promise
    }
    if (friendshipBundle.value !== null) return
    return refreshFriendships()
  }

  // Recharge les listes depuis la base. Le bundle en place RESTE affiché
  // pendant le RTT (c'est un cache d'écran — le vider ferait clignoter les
  // listes à chaque action) ; seule l'erreur précédente est effacée. Ne
  // throw JAMAIS. Double garde avant toute écriture : token (course) ET
  // identité inchangée (logout / changement de compte pendant le await).
  async function refreshFriendships(): Promise<void> {
    const initialUserId = identityStore.currentUserId
    if (initialUserId === null) return
    if (pendingLoad !== null && pendingLoad.userId === initialUserId) {
      return pendingLoad.promise
    }

    const requestId = ++lastLoadFriendshipsRequestId
    lastLoadFriendshipsError.value = null
    isLoadingBundle.value = true

    async function fetchFriendships(): Promise<void> {
      try {
        const bundle = await repository.getFriendships()
        if (requestId !== lastLoadFriendshipsRequestId) return
        if (identityStore.currentUserId !== initialUserId) return
        friendshipBundle.value = bundle
      }
      catch (error) {
        if (requestId !== lastLoadFriendshipsRequestId) return
        if (identityStore.currentUserId !== initialUserId) return
        lastLoadFriendshipsError.value = error
      }
    }

    const promise = fetchFriendships().finally(() => {
      // Un chargement remplacé (invalidation ou autre user) ne doit pas
      // éteindre le drapeau du chargement courant.
      const thisLoadIsStillTheCurrentOne
        = pendingLoad === null || pendingLoad.promise === promise
      if (thisLoadIsStillTheCurrentOne) {
        isLoadingBundle.value = false
      }
      // Ne libère le slot que s'il est encore le sien : une demande pour un
      // autre user (changement de compte en plein vol) l'a peut-être déjà
      // remplacé.
      if (pendingLoad?.promise === promise) {
        pendingLoad = null
      }
    })
    pendingLoad = { userId: initialUserId, promise }
    return promise
  }

  // Envoie une demande par pseudo exact. THROW (FriendshipError typée ou
  // Error réseau) — la page dispatch. Au succès, RECHARGE les listes plutôt
  // que de muter localement : l'issue dépend du côté serveur ('pending' →
  // envoyées, 'accepted' → amis, demandes croisées) et la RPC est le seul
  // juge de l'ordre. Retourne l'issue pour que l'écran soit honnête
  // (« Vous êtes maintenant amis. » vs « Demande envoyée. »).
  async function requestFriendship(displayName: string): Promise<FriendshipRequestOutcome> {
    identityStore.requireAuthenticatedUserId()
    const outcome = await repository.requestFriendship(displayName)
    // Le refresh ci-dessous doit être un VRAI rechargement post-écriture,
    // pas la promesse d'un fetch parti avant elle.
    invalidateInFlightLoad()
    await refreshFriendships()
    return outcome
  }

  // Fabrique commune des quatre actions ciblant une personne : garde
  // d'identité, :loading par ligne, THROW vers la page, puis mutation
  // LOCALE des listes (instantané, zéro rechargement) — le token est bumpé
  // pour qu'une réponse de chargement tardive n'écrase pas l'état muté.
  async function performFriendshipAction(
    targetUserId: string,
    kind: FriendshipActionKind,
    action: () => Promise<void>,
    applyLocalMutation: (bundle: FriendshipBundle) => FriendshipBundle,
  ): Promise<void> {
    identityStore.requireAuthenticatedUserId()
    pendingAction.value = { userId: targetUserId, kind }
    try {
      await action()
      // Mutation locale = la vérité de l'écran : un chargement parti avant
      // l'écriture ne doit ni l'écraser (token) ni être resservi par la
      // déduplication à un refresh suivant.
      invalidateInFlightLoad()
      if (friendshipBundle.value !== null) {
        friendshipBundle.value = applyLocalMutation(friendshipBundle.value)
      }
    }
    finally {
      // Ne libère le slot que s'il est encore le sien : une action lancée
      // sur une autre ligne l'a peut-être déjà remplacé.
      if (pendingAction.value?.userId === targetUserId) {
        pendingAction.value = null
      }
    }
  }

  // Accepte une demande reçue : elle quitte les reçues, la personne rejoint
  // les amis à sa place alphabétique.
  async function acceptFriendship(userId: string): Promise<void> {
    return performFriendshipAction(
      userId,
      'accept',
      () => repository.acceptFriendship(userId),
      (bundle) => {
        const acceptedEntry = bundle.received.find(entry => entry.userId === userId)
        return {
          friends: acceptedEntry === undefined
            ? bundle.friends
            : withFriendInsertedAlphabetically(bundle.friends, acceptedEntry),
          received: withFriendshipEntryRemoved(bundle.received, userId),
          sent: bundle.sent,
        }
      },
    )
  }

  // Refuse une demande reçue : la ligne disparaît (la personne peut
  // redemander — aucune trace côté base).
  async function refuseFriendship(userId: string): Promise<void> {
    return performFriendshipAction(
      userId,
      'refuse',
      () => repository.refuseFriendship(userId),
      bundle => ({
        friends: bundle.friends,
        received: withFriendshipEntryRemoved(bundle.received, userId),
        sent: bundle.sent,
      }),
    )
  }

  // Annule sa propre demande envoyée (A8).
  async function cancelFriendshipRequest(userId: string): Promise<void> {
    return performFriendshipAction(
      userId,
      'cancel',
      () => repository.cancelFriendshipRequest(userId),
      bundle => ({
        friends: bundle.friends,
        received: bundle.received,
        sent: withFriendshipEntryRemoved(bundle.sent, userId),
      }),
    )
  }

  // Retire un ami (silencieux, unilatéral ; no-op idempotent côté base).
  async function removeFriendship(userId: string): Promise<void> {
    return performFriendshipAction(
      userId,
      'remove',
      () => repository.removeFriendship(userId),
      bundle => ({
        friends: withFriendshipEntryRemoved(bundle.friends, userId),
        received: bundle.received,
        sent: bundle.sent,
      }),
    )
  }

  // Le compteur de l'entrée « Amis » de la page de compte.
  const receivedRequestCount = computed<number>(
    () => friendshipBundle.value?.received.length ?? 0,
  )

  // Statut de l'utilisateur courant vis-à-vis d'un profil. Fonction (pas un
  // computed paramétré) : la réactivité vient des refs lues à l'appel.
  function friendshipStatusOf(targetUserId: string): FriendshipStatus {
    return deriveFriendshipStatus(
      friendshipBundle.value,
      identityStore.currentUserId,
      targetUserId,
    )
  }

  // Reset au logout (session null) : rien ne survit à une session. Le bump
  // du token invalide tout chargement en vol. immediate : couvre le boot
  // sans session.
  watch(
    () => session.value,
    (currentSession) => {
      if (currentSession === null) {
        invalidateInFlightLoad()
        friendshipBundle.value = null
        lastLoadFriendshipsError.value = null
        isLoadingBundle.value = false
        pendingAction.value = null
      }
    },
    { immediate: true },
  )

  return {
    friendshipBundle,
    lastLoadFriendshipsError,
    isLoadingBundle,
    pendingAction,
    isActionPending,
    receivedRequestCount,
    loadFriendships,
    refreshFriendships,
    requestFriendship,
    acceptFriendship,
    refuseFriendship,
    cancelFriendshipRequest,
    removeFriendship,
    friendshipStatusOf,
  }
})
