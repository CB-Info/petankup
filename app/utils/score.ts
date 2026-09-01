import type { ScoreValidationResult } from '../types'

// LA règle de score de la pétanque côté application — source UNIQUE,
// consommée par les deux domaines (tournoi ET match libre) : le vainqueur
// a EXACTEMENT 13 points, le perdant de 0 à 12 — ce que garantissent
// ensemble « pas d'égalité » et « le plus haut vaut 13 ». Miroir des CHECK
// des tables tournament_matches et free_matches : la base reste le filet,
// jamais la première ligne — aucun message technique DB ne doit être
// atteignable depuis une saisie. Toute autre expression de la règle côté
// app est interdite : schémas, stores et composants APPELLENT ces
// fonctions, ils ne les dupliquent pas (même principe que medalTone).

// Un match se joue en 13 points : score cible du vainqueur (une égalité
// stricte, pas un plafond arbitraire).
export const WINNING_SCORE = 13

export function validateMatchScore(
  scoreA: number,
  scoreB: number,
): ScoreValidationResult {
  const bothAreNonNegativeIntegers
    = Number.isInteger(scoreA)
      && Number.isInteger(scoreB)
      && scoreA >= 0
      && scoreB >= 0
  if (!bothAreNonNegativeIntegers) {
    return { valid: false, error: 'Les scores doivent être des entiers positifs ou nuls.' }
  }
  if (scoreA === scoreB) {
    return { valid: false, error: 'Pas de match nul à la pétanque.' }
  }
  if (Math.max(scoreA, scoreB) !== WINNING_SCORE) {
    return { valid: false, error: 'Le vainqueur doit avoir exactement 13 points.' }
  }
  return { valid: true }
}

// Borne de SAISIE des steppers +/− : un score en cours de frappe vit dans
// [0, WINNING_SCORE]. Mécanique d'input uniquement — ne JAMAIS l'appliquer
// aux props d'affichage d'un score enregistré (mode liste). La validation
// finale reste validateMatchScore, à la soumission.
export function clampScoreToInputBounds(score: number): number {
  return Math.min(WINNING_SCORE, Math.max(0, score))
}
