// Nom par défaut d'une nouvelle équipe : "Équipe N" où N = max + 1 des
// numéros déjà utilisés par les équipes dont le nom matche exactement le
// pattern "Équipe X" (X entier). Pattern strict : case-sensitive, accent
// préservé, pas de caractère additionnel — "équipe 1", "Equipe 2" et
// "Équipe 1A" ne matchent pas. Si aucune équipe ne matche → "Équipe 1".
// Les noms personnalisés sont ignorés dans le calcul du max.
export function computeNextTeamNameDefault(existingTeamNames: string[]): string {
  const defaultNamePattern = /^Équipe (\d+)$/

  const usedNumbers = existingTeamNames
    .map((name) => {
      const capturedNumber = defaultNamePattern.exec(name)?.[1]
      return capturedNumber === undefined
        ? null
        : Number.parseInt(capturedNumber, 10)
    })
    .filter((value): value is number => value !== null)

  const nextNumber = usedNumbers.length === 0 ? 1 : Math.max(...usedNumbers) + 1
  return `Équipe ${nextNumber}`
}
