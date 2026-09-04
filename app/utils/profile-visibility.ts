import type { ProfileVisibility } from '../types'

// Garde-type unique du réglage de confidentialité. Sert là où une valeur
// arrive non typée : le payload `string | undefined` du sélecteur en cartes
// (CarteSelection expose un modèle string), un paramètre de route, etc.
export function isProfileVisibility(value: unknown): value is ProfileVisibility {
  return value === 'private' || value === 'public'
}

// La bascule à confirmer quand une carte du réglage est tapée, ou null s'il
// n'y a rien à confirmer : payload qui n'est pas un réglage, ou carte DÉJÀ
// active — le sélecteur émet aussi dans ce cas, et sans ce filtre retaper
// « Public » ouvrirait « Rendre mon profil privé ? », le seul geste de
// l'écran qui ne doit jamais partir par accident. `currentVisibility` null
// (réglage pas encore connu) : rien à confirmer non plus.
export function visibilityChangeToConfirm(
  tappedValue: unknown,
  currentVisibility: ProfileVisibility | null,
): ProfileVisibility | null {
  if (!isProfileVisibility(tappedValue)) return null
  if (currentVisibility === null) return null
  if (tappedValue === currentVisibility) return null
  return tappedValue
}
