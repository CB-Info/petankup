import type { Profile, Teammate, TeamPlayer } from '../types'

// Joueur enregistré avec un pseudo figé : joueur d'équipe (tournoi) ou
// joueur de match libre partagent ce couple. Typage structurel pour servir
// les deux domaines sans les coupler.
type PlayerWithSnapshot = Pick<TeamPlayer, 'userId' | 'displayNameSnapshot'>

// Affichage d'un joueur enregistré : pseudo live via profileById si le joueur
// est lié à un compte ET le profil est hydraté, sinon le snapshot DB. Pure,
// idempotente. Le snapshot couvre les joueurs libres (userId null), les
// profils non encore hydratés, et les comptes supprimés (userId remis à NULL
// côté DB → on retombe sur le snapshot conservé).
export function getPlayerDisplayName(
  player: PlayerWithSnapshot,
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

// Liste FR naturelle (« Marc », « Marc et Julie », « Marc, Julie et Paul »),
// déléguée à Intl comme le fait déjà utils/format.ts pour les dates.
const frenchListFormatter = new Intl.ListFormat('fr-FR', {
  style: 'long',
  type: 'conjunction',
})

// Ligne « avec … » du journal de bord. null si aucun coéquipier
// (tête-à-tête) — l'appelant ne rend alors rien, ni libellé vide ni
// séparateur orphelin. Pure, idempotente.
export function formatTeammatesLine(teammateNames: string[]): string | null {
  if (teammateNames.length === 0) return null
  return `avec ${frenchListFormatter.format(teammateNames)}`
}

// Ligne « contre … » d'une entrée de match libre du journal. null si les
// adversaires sont inconnus — entrée non ouvrable, dont la base vide les
// listes — même règle du rien plutôt qu'un libellé vide. Pure, idempotente.
export function formatOpponentsLine(opponentNames: string[]): string | null {
  if (opponentNames.length === 0) return null
  return `contre ${frenchListFormatter.format(opponentNames)}`
}
