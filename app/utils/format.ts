// Formate une date ISO en chaîne lisible (ex : "3 mai 2026").
// Fonction pure : aucune dépendance à `Date.now()`, le résultat ne
// dépend que de l'entrée et de la locale fournie.
export function formatDate(isoDate: string, locale: string = 'fr-FR'): string {
  const dateToFormat = new Date(isoDate)
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(dateToFormat)
}

// Date locale d'un instant au format ISO (YYYY-MM-DD), dans la timezone du
// navigateur. `toLocaleDateString('en-CA')` renvoie exactement ce format —
// évite le piège de `toISOString()`, qui passe en UTC et peut renvoyer la
// date du lendemain en fin de soirée locale. Pure : l'instant est injecté.
export function toLocalIsoDate(date: Date): string {
  return date.toLocaleDateString('en-CA')
}
