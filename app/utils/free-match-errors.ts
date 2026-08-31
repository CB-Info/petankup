import type { FreeMatchErrorCode } from '../types'

// Traduction des erreurs de la RPC create_free_match : du message brut
// PostgREST vers un code typé, puis du code vers le champ concerné et le
// message français affiché. Pur, exhaustif (le switch sans default fait
// signaler par TypeScript tout code ajouté à FreeMatchErrorCode).

const KNOWN_FREE_MATCH_ERROR_CODES: readonly Exclude<FreeMatchErrorCode, 'unknown'>[] = [
  'not_authenticated',
  'invalid_players',
  'invalid_side',
  'invalid_display_name',
  'not_participant',
  'invalid_side_count',
  'unbalanced_sides',
  'duplicate_player',
  'invalid_score',
  'invalid_played_on',
  'player_user_not_found',
]

// Le message PostgREST d'un `raise exception 'code'` est exactement le code.
// Égalité stricte (après trim), PAS de recherche de sous-chaîne :
// `invalid_side` est un préfixe de `invalid_side_count`, un `includes`
// confondrait les deux.
export function parseFreeMatchErrorCode(rawMessage: string): FreeMatchErrorCode {
  const normalizedMessage = rawMessage.trim()
  const matchedCode = KNOWN_FREE_MATCH_ERROR_CODES.find(code => code === normalizedMessage)
  return matchedCode ?? 'unknown'
}

// Champ du formulaire de création sous lequel afficher l'erreur (valeurs =
// `name` des UFormField de la page) ; null = erreur de formulaire, affichée
// dans l'alerte générale.
export type FreeMatchErrorField = 'score' | 'playedOn'

export function freeMatchErrorField(code: FreeMatchErrorCode): FreeMatchErrorField | null {
  switch (code) {
    case 'invalid_score':
      return 'score'
    case 'invalid_played_on':
      return 'playedOn'
    case 'not_authenticated':
    case 'invalid_players':
    case 'invalid_side':
    case 'invalid_display_name':
    case 'not_participant':
    case 'invalid_side_count':
    case 'unbalanced_sides':
    case 'duplicate_player':
    case 'player_user_not_found':
    case 'unknown':
      return null
  }
}

export function freeMatchErrorMessage(code: FreeMatchErrorCode): string {
  switch (code) {
    case 'not_authenticated':
      return 'Vous devez être connecté.'
    case 'invalid_players':
      return 'La liste des joueurs est invalide.'
    case 'invalid_side':
      return 'Chaque joueur doit être dans le camp A ou le camp B.'
    case 'invalid_display_name':
      return 'Chaque joueur doit avoir un nom.'
    case 'not_participant':
      return 'Vous devez faire partie du match.'
    case 'invalid_side_count':
      return 'Chaque camp compte de 1 à 3 joueurs.'
    case 'unbalanced_sides':
      return 'Les deux camps doivent avoir le même nombre de joueurs.'
    case 'duplicate_player':
      return 'Un même compte ne peut pas jouer deux fois dans le match.'
    case 'invalid_score':
      return 'Le vainqueur doit avoir exactement 13 points, le perdant entre 0 et 12.'
    case 'invalid_played_on':
      return 'La date du match ne peut pas être dans le futur.'
    case 'player_user_not_found':
      return "Un des comptes liés n'existe plus."
    case 'unknown':
      return 'Une erreur est survenue. Réessayez.'
  }
}
