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
