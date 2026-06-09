import type { Profile, Teammate, TeamPlayer } from '../types'

// Affichage d'un joueur d'équipe : pseudo live via profileById si le joueur
// est lié à un compte ET le profil est hydraté, sinon le snapshot DB. Pure,
// idempotente. Le snapshot couvre les joueurs libres (userId null), les
// profils non encore hydratés, et les comptes supprimés (userId remis à NULL
// côté DB → on retombe sur le snapshot conservé).
export function getPlayerDisplayName(
  player: TeamPlayer,
  profileById: Record<string, Profile>,
): string {
  if (player.userId !== null) {
    const profile = profileById[player.userId]
    if (profile !== undefined) return profile.displayName
  }
  return player.displayNameSnapshot
}

// Variante de getPlayerDisplayName pour le shape Teammate ({ userId,
// displayName }) renvoyé par le bundle profil (Phase J). Même logique : pseudo
// live via profileById si le coéquipier est lié à un compte ET le profil est
// hydraté, sinon le snapshot porté par le teammate. Pure, idempotente.
export function getTeammateDisplayName(
  teammate: Teammate,
  profileById: Record<string, Profile>,
): string {
  if (teammate.userId !== null) {
    const profile = profileById[teammate.userId]
    if (profile !== undefined) return profile.displayName
  }
  return teammate.displayName
}
