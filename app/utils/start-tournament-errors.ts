import type { StartTournamentErrorCode } from '../types'

// Traduction des refus de la RPC start_tournament : du message brut
// PostgREST vers un code typé, puis du code vers le message français affiché
// et vers la décision de recharger l'écran. Pur, exhaustif (les switch sans
// default font signaler par TypeScript tout code ajouté à
// StartTournamentErrorCode).

const KNOWN_START_TOURNAMENT_ERROR_CODES: readonly Exclude<StartTournamentErrorCode, 'unknown'>[] = [
  'not_authenticated',
  'not_owner',
  'tournament_not_draft',
  'not_enough_teams',
  'matches_already_generated',
  'invalid_matches',
]

// Le message PostgREST d'un `raise exception 'code'` est exactement le code.
// Égalité stricte (après trim), même règle que free-match-errors et
// friendship-errors : un code embarqué dans un message plus long (« error:
// not_owner … ») ne doit pas passer pour un refus typé, et un futur code qui
// en contiendrait un autre ne créerait aucune ambiguïté. Le message n'est
// pas garanti : hors PostgREST (passerelle en panne, corps 502), l'objet
// d'erreur peut ne pas en porter — tout ce qui n'est pas une chaîne est
// `unknown`, jamais une exception technique.
export function parseStartTournamentErrorCode(rawMessage: unknown): StartTournamentErrorCode {
  if (typeof rawMessage !== 'string') return 'unknown'
  const normalizedMessage = rawMessage.trim()
  const matchedCode = KNOWN_START_TOURNAMENT_ERROR_CODES.find(code => code === normalizedMessage)
  return matchedCode ?? 'unknown'
}

export function startTournamentErrorMessage(code: StartTournamentErrorCode): string {
  switch (code) {
    case 'not_authenticated':
      return 'Vous devez être connecté.'
    case 'not_owner':
      return "Seul l'organisateur peut lancer ce tournoi."
    case 'tournament_not_draft':
      return 'Ce tournoi a déjà été lancé.'
    case 'not_enough_teams':
      return 'Il faut au moins deux équipes pour lancer le tournoi.'
    case 'matches_already_generated':
      return 'Les matchs de ce tournoi existent déjà.'
    case 'invalid_matches':
      return "Les matchs n'ont pas pu être enregistrés. Rechargez la page et réessayez."
    case 'unknown':
      return 'Une erreur est survenue. Réessayez.'
  }
}

// Vrai pour les refus qui disent « l'écran ment » : le tournoi a été lancé
// ou terminé ailleurs, ses matchs existent déjà, il ne reste plus assez
// d'équipes. La page recharge alors le tournoi en place.
// Faux pour not_owner (un droit refusé ; il couvre aussi un tournoi disparu
// — anti-fuite côté base — mais recharger mènerait à une page introuvable :
// choix assumé), pour invalid_matches (plusieurs causes, dont un lot mal
// formé où recharger n'a aucun sens ; une équipe disparue alors qu'il en
// reste deux tombe ici), pour une session perdue et pour une panne.
// matches_already_generated : tant que le lot DB-2 n'a pas fermé l'état
// « brouillon avec matchs », recharger montre le même écran ; la sortie
// reste la suppression du tournoi.
export function startTournamentErrorMeansStaleScreen(code: StartTournamentErrorCode): boolean {
  switch (code) {
    case 'tournament_not_draft':
    case 'not_enough_teams':
    case 'matches_already_generated':
      return true
    case 'not_authenticated':
    case 'not_owner':
    case 'invalid_matches':
    case 'unknown':
      return false
  }
}
