import type { Profile, TeamPlayer } from '../types'

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
