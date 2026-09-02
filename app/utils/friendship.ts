import type { AccountMatch, FriendshipBundle, FriendshipEntry, FriendshipStatus } from '../types'

// Logique pure de l'amitié (A3) : dérivation du statut d'une relation et
// mutations locales des listes du bundle. La règle vit ici, jamais dans un
// composant — les pages et le store appellent ces fonctions, ils ne les
// dupliquent pas.

// Statut de l'utilisateur courant vis-à-vis d'un profil, dérivé du bundle.
// Un bundle null (jamais chargé, ou en échec) rend 'none' : rien n'est
// affirmé — les écrans ne rendent le bloc de statut que bundle chargé.
export function deriveFriendshipStatus(
  bundle: FriendshipBundle | null,
  viewerUserId: string | null,
  targetUserId: string,
): FriendshipStatus {
  if (viewerUserId !== null && viewerUserId === targetUserId) return 'self'
  if (bundle === null) return 'none'
  if (bundle.friends.some(friend => friend.userId === targetUserId)) return 'friends'
  if (bundle.sent.some(request => request.userId === targetUserId)) return 'request_sent'
  if (bundle.received.some(request => request.userId === targetUserId)) return 'request_received'
  return 'none'
}

// État d'affichage du résultat de recherche de l'écran des amis : rien tant
// qu'on n'a pas cherché, « introuvable » (cas NOMINAL, jamais une erreur),
// sinon le statut vis-à-vis du compte trouvé — qui décide l'action proposée
// AVANT tout appui (Accepter pour une demande reçue, rien pour soi-même…).
export type FriendshipSearchOutcome = 'idle' | 'not_found' | FriendshipStatus

export function friendshipSearchOutcome(
  hasSearched: boolean,
  foundAccount: AccountMatch | null,
  statusForFoundAccount: FriendshipStatus,
): FriendshipSearchOutcome {
  if (!hasSearched) return 'idle'
  if (foundAccount === null) return 'not_found'
  return statusForFoundAccount
}

// Retire l'entrée d'une personne d'une liste (refus, annulation, retrait —
// ou le volet « départ » d'une acceptation).
export function withFriendshipEntryRemoved(
  entries: FriendshipEntry[],
  userId: string,
): FriendshipEntry[] {
  return entries.filter(entry => entry.userId !== userId)
}

// Insère un nouvel ami à sa place alphabétique (insensible à la casse) —
// approximation locale du tri de la RPC (lower(display_name) côté base) :
// localeCompare peut diverger de la collation Postgres sur des pseudos à
// ponctuation ou chiffres ; l'écart est corrigé au prochain chargement.
export function withFriendInsertedAlphabetically(
  friends: FriendshipEntry[],
  newFriend: FriendshipEntry,
): FriendshipEntry[] {
  const insertionIndex = friends.findIndex(
    friend =>
      friend.displayName.toLowerCase().localeCompare(newFriend.displayName.toLowerCase()) > 0,
  )
  if (insertionIndex === -1) return [...friends, newFriend]
  return [
    ...friends.slice(0, insertionIndex),
    newFriend,
    ...friends.slice(insertionIndex),
  ]
}
