// Décision de (re)chargement du bundle profil (page /profile/<id>).
//
// Au montage à froid (F5, lien direct), l'identité du viewer n'est pas
// encore résolue : appeler le store à ce moment-là sortirait silencieusement
// (garde loadUserProfile) et la page afficherait « Profil introuvable » pour
// un simple état d'attente. Ce prédicat gate le watcher de la page : on ne
// charge que lorsque le viewer est identifié, et seulement sur une
// transition réelle — jamais de double requête quand une source d'identité
// redondante arrive après coup avec la même valeur.
// Les membres acceptent undefined : c'est le type réel des valeurs `previous`
// de l'API watch multi-sources de Vue (premier déclenchement).
export type ProfileLoadInputs = readonly [
  profileId: string | undefined,
  viewerId: string | null | undefined,
]

export function shouldReloadProfile(
  current: ProfileLoadInputs,
  previous?: ProfileLoadInputs,
): boolean {
  const [profileId, viewerId] = current
  const viewerIsIdentified = viewerId !== null && viewerId !== undefined
  if (!viewerIsIdentified || profileId === undefined) return false

  // Premier déclenchement avec identité déjà résolue (navigation interne).
  if (previous === undefined) return true

  const [previousProfileId, previousViewerId] = previous
  return profileId !== previousProfileId || viewerId !== previousViewerId
}
