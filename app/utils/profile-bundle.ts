import type { FullUserProfileBundle } from '../types'

// Les joueurs liés à un compte qui figurent dans le journal d'un bundle
// COMPLET — coéquipiers de tournoi, coéquipiers et adversaires de match
// libre — pour pré-hydrater leurs pseudos en un seul appel batché. Le
// profil consulté lui-même est exclu (déjà dans le bundle) ; les joueurs
// libres (userId null) n'ont pas de profil. Une entrée non ouvrable arrive
// avec des listes vides : rien à hydrater. Typé sur la forme complète :
// une forme restreinte ou inexistante n'a pas de journal.
export function linkedPlayerUserIdsIn(
  fullBundle: FullUserProfileBundle,
  excludedUserId: string,
): string[] {
  const journalPlayers = [
    ...fullBundle.results.flatMap(result => result.teammates),
    ...fullBundle.freeMatches.flatMap(freeMatch => [
      ...freeMatch.teammates,
      ...freeMatch.opponents,
    ]),
  ]
  return journalPlayers
    .map(player => player.userId)
    .filter(
      (playerUserId): playerUserId is string =>
        playerUserId !== null && playerUserId !== excludedUserId,
    )
}
