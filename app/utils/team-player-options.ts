import type { Profile, Team, TournamentMember } from '../types'

export type PlayerOption = {
  // Identifiant unique de l'option dans le combobox (= userId).
  userId: string
  // Pseudo affiché (live, via profileById).
  displayName: string
  // Si true, l'option est désactivée dans le dropdown.
  disabled: boolean
  // Suffixe explicatif pour l'affichage (ex : "dans Équipe 2"). undefined si
  // non disabled.
  disabledReason?: string
}

type ComputeOptionsParams = {
  ownerId: string
  members: TournamentMember[]
  profileById: Record<string, Profile>
  teams: Team[]
  // null en création ; en édition, l'équipe en cours est exclue du calcul
  // d'engagement (ses propres joueurs restent sélectionnables).
  editingTeamId: string | null
}

// Construit la liste d'options pour le sélecteur de joueur. Owner d'abord, puis
// membres triés alphabétiquement par displayName. Un user déjà engagé dans une
// AUTRE équipe (≠ editingTeamId) est marqué disabled avec le nom de cette
// équipe. Les profils non hydratés (absents de profileById) sont silencieusement
// omis (cohérent avec getPlayerDisplayName).
export function computeAvailablePlayerOptions(
  params: ComputeOptionsParams,
): PlayerOption[] {
  const { ownerId, members, profileById, teams, editingTeamId } = params

  // userId → nom de l'équipe où il est déjà engagé (hors équipe en édition).
  const teamNameByEngagedUserId = new Map<string, string>()
  for (const team of teams) {
    if (team.id === editingTeamId) continue
    for (const player of team.players) {
      if (player.userId !== null) {
        teamNameByEngagedUserId.set(player.userId, team.name)
      }
    }
  }

  function buildOption(userId: string): PlayerOption | null {
    const profile = profileById[userId]
    if (profile === undefined) return null
    const engagedInTeamName = teamNameByEngagedUserId.get(userId)
    if (engagedInTeamName !== undefined) {
      return {
        userId,
        displayName: profile.displayName,
        disabled: true,
        disabledReason: `dans ${engagedInTeamName}`,
      }
    }
    return { userId, displayName: profile.displayName, disabled: false }
  }

  const options: PlayerOption[] = []

  const ownerOption = buildOption(ownerId)
  if (ownerOption !== null) options.push(ownerOption)

  const memberOptions = members
    .filter(member => member.userId !== ownerId) // owner pas en double
    .map(member => buildOption(member.userId))
    .filter((option): option is PlayerOption => option !== null)
    .sort((first, second) =>
      first.displayName.localeCompare(second.displayName, 'fr'),
    )

  options.push(...memberOptions)
  return options
}
