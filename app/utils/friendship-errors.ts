import type { FriendshipErrorCode } from '../types'

// Traduction des erreurs des RPC d'amitié : du message brut PostgREST vers
// un code typé, puis du code vers le champ concerné, le message français
// affiché et la conduite à tenir. Pur, exhaustif (les switchs sans default
// font signaler par TypeScript tout code ajouté à FriendshipErrorCode).
//
// Nuance d'usage : l'écran affiche l'état AVANT l'appui (le statut est
// dérivé du bundle), donc already_requested / already_friends /
// request_not_found ne surgissent qu'en course (deux onglets, action
// concurrente de l'autre personne). Leurs messages sont des filets,
// formulés sans accuser l'utilisateur, et déclenchent un rafraîchissement
// des listes (friendshipErrorTriggersRefresh).

const KNOWN_FRIENDSHIP_ERROR_CODES: readonly Exclude<FriendshipErrorCode, 'unknown'>[] = [
  'not_authenticated',
  'display_name_not_found',
  'self_request',
  'already_requested',
  'already_friends',
  'request_not_found',
  'not_addressee',
  'not_requester',
]

// Le message PostgREST d'un `raise exception 'code'` est exactement le code.
// Égalité stricte (après trim), PAS de recherche de sous-chaîne :
// `request_not_found` contient `not_found`, et `not_authenticated` /
// `not_addressee` / `not_requester` partagent le préfixe `not_` — un
// `includes` confondrait.
export function parseFriendshipErrorCode(rawMessage: string): FriendshipErrorCode {
  const normalizedMessage = rawMessage.trim()
  const matchedCode = KNOWN_FRIENDSHIP_ERROR_CODES.find(code => code === normalizedMessage)
  return matchedCode ?? 'unknown'
}

// Champ du formulaire de recherche sous lequel afficher l'erreur (valeur =
// `name` du UFormField de l'écran des amis) ; null = pas de champ concerné,
// l'erreur passe en toast (courses, pannes).
export type FriendshipErrorField = 'displayName'

export function friendshipErrorField(code: FriendshipErrorCode): FriendshipErrorField | null {
  switch (code) {
    case 'display_name_not_found':
    case 'self_request':
    case 'already_requested':
    case 'already_friends':
      return 'displayName'
    case 'not_authenticated':
    case 'request_not_found':
    case 'not_addressee':
    case 'not_requester':
    case 'unknown':
      return null
  }
}

export function friendshipErrorMessage(code: FriendshipErrorCode): string {
  switch (code) {
    case 'not_authenticated':
      return 'Vous devez être connecté.'
    case 'display_name_not_found':
      return 'Aucun compte ne porte ce pseudo.'
    case 'self_request':
      return 'Vous ne pouvez pas vous envoyer une demande.'
    case 'already_requested':
      return 'Une demande est déjà en cours avec ce joueur.'
    case 'already_friends':
      return 'Vous êtes déjà amis avec ce joueur.'
    case 'request_not_found':
      return "Cette demande n'existe plus. Elle a peut-être déjà été traitée."
    case 'not_addressee':
      return 'Seul le destinataire de la demande peut y répondre.'
    case 'not_requester':
      return "Seul l'auteur de la demande peut l'annuler."
    case 'unknown':
      return 'Une erreur est survenue. Réessayez.'
  }
}

// Codes qui trahissent un état local périmé (l'autre personne a agi entre
// temps) : après le message, l'écran rafraîchit ses listes pour se recaler.
export function friendshipErrorTriggersRefresh(code: FriendshipErrorCode): boolean {
  switch (code) {
    case 'already_requested':
    case 'already_friends':
    case 'request_not_found':
    case 'not_addressee':
    case 'not_requester':
      return true
    case 'not_authenticated':
    case 'display_name_not_found':
    case 'self_request':
    case 'unknown':
      return false
  }
}

// Le geste que l'utilisateur tentait quand l'erreur est survenue. Chaque
// écran le déclare (c'est un fait, pas un choix) : la décision de
// présentation reste dans le point unique (useFriendshipFeedback).
export type FriendshipAttemptedAction = 'request' | 'accept' | 'refuse' | 'cancel' | 'remove'

// Une action de SUPPRESSION qui ne trouve plus sa cible a atteint son
// objectif (la demande n'existe plus) : la présenter comme un échec serait
// trompeur — l'écran affiche une confirmation discrète. Ne vaut que pour
// annuler et refuser. Accepter une demande disparue reste un échec signalé
// (l'utilisateur voulait devenir ami et ne l'est pas), et already_friends
// reste signalé tel quel (20260902150000 : il nomme un ami à retirer).
export function friendshipErrorMeansGoalAlreadyMet(
  attemptedAction: FriendshipAttemptedAction,
  code: FriendshipErrorCode,
): boolean {
  if (code !== 'request_not_found') return false
  return attemptedAction === 'cancel' || attemptedAction === 'refuse'
}
