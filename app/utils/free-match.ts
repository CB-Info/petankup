import type {
  FreeMatchFormat,
  FreeMatchPlayer,
  FreeMatchSide,
} from '../types'

// Logique pure du match libre : formats, slots du formulaire de création,
// camp en tête, ordre d'affichage des joueurs. La règle de score vit dans
// utils/score (source unique des deux domaines).
// Aucun side effect, aucune date interne.

// --- Formats ---

export const FREE_MATCH_FORMATS: readonly FreeMatchFormat[] = [
  'tete_a_tete',
  'doublette',
  'triplette',
]

const PLAYERS_PER_SIDE_BY_FORMAT: Record<FreeMatchFormat, number> = {
  tete_a_tete: 1,
  doublette: 2,
  triplette: 3,
}

export const FREE_MATCH_FORMAT_LABELS: Record<FreeMatchFormat, string> = {
  tete_a_tete: 'Tête-à-tête',
  doublette: 'Doublette',
  triplette: 'Triplette',
}

export function playersPerSide(format: FreeMatchFormat): number {
  return PLAYERS_PER_SIDE_BY_FORMAT[format]
}

export function playersOnSide(
  players: FreeMatchPlayer[],
  side: FreeMatchSide,
): FreeMatchPlayer[] {
  return players.filter(player => player.side === side)
}

// Format déduit de l'effectif d'UN camp (la base garantit des camps
// équilibrés). null si l'effectif ne correspond à aucun format — cas d'une
// entrée de journal non ouvrable (listes vidées), ou d'un effectif
// impossible depuis la base, gardé pour ne pas mentir au typage.
export function freeMatchFormatForSideCount(
  playersOnOneSide: number,
): FreeMatchFormat | null {
  const matchingFormat = FREE_MATCH_FORMATS.find(
    format => playersPerSide(format) === playersOnOneSide,
  )
  return matchingFormat ?? null
}

// Variante pour un match complet (page de détail) : même règle, appliquée
// à l'effectif du camp A.
export function freeMatchFormatOf(players: FreeMatchPlayer[]): FreeMatchFormat | null {
  return freeMatchFormatForSideCount(playersOnSide(players, 'A').length)
}

// --- Slots du formulaire de création ---

// Un slot = un joueur à renseigner : lié à un compte (userId non-null, pseudo
// canonique) ou libre (userId null, nom saisi). Même modèle que les slots
// d'équipe (TeamFormModal), sans liste d'invités où piocher.
export type FreeMatchSlot = { userId: string | null, displayName: string }

export function emptySlot(): FreeMatchSlot {
  return { userId: null, displayName: '' }
}

export function isSlotFilled(slot: FreeMatchSlot): boolean {
  return slot.userId !== null || slot.displayName.trim() !== ''
}

export type ResizeSideResult = {
  slots: FreeMatchSlot[]
  droppedFilledCount: number
}

// Changement de format : le camp garde ses joueurs renseignés dans l'ordre,
// tronqués à la nouvelle taille et complétés de slots vides. Les slots vides
// intercalés ne comptent pas — on ne perd un joueur que si le camp rétrécit
// sous son nombre de joueurs renseignés (droppedFilledCount > 0, que l'écran
// signale).
export function resizeSide(
  slots: FreeMatchSlot[],
  targetSize: number,
): ResizeSideResult {
  const filledSlots = slots.filter(isSlotFilled)
  const keptSlots = filledSlots.slice(0, targetSize)
  const droppedFilledCount = filledSlots.length - keptSlots.length
  const paddedSlots = [...keptSlots]
  while (paddedSlots.length < targetSize) {
    paddedSlots.push(emptySlot())
  }
  return { slots: paddedSlots, droppedFilledCount }
}

// Disposition des slots autour du créateur. Le créateur n'occupe pas de slot
// (ligne verrouillée à l'écran) : son camp a donc UN slot de moins que
// l'autre, pour un effectif total identique des deux côtés.
export type FreeMatchSidesLayout = {
  creatorSide: FreeMatchSide
  sideA: FreeMatchSlot[]
  sideB: FreeMatchSlot[]
}

// Déplace le créateur dans l'autre camp sans perdre personne : le premier
// slot du camp d'arrivée passe en tête du camp quitté, pour que chaque camp
// garde son effectif. Retourne la disposition inchangée si le créateur y
// est déjà.
export function moveCreatorToSide(
  layout: FreeMatchSidesLayout,
  targetSide: FreeMatchSide,
): FreeMatchSidesLayout {
  if (layout.creatorSide === targetSide) return layout

  const leavingSideSlots = layout.creatorSide === 'A' ? layout.sideA : layout.sideB
  const arrivingSideSlots = targetSide === 'A' ? layout.sideA : layout.sideB
  const [firstArrivingSlot, ...remainingArrivingSlots] = arrivingSideSlots
  const slotHandedOver = firstArrivingSlot ?? emptySlot()

  const newLeavingSideSlots = [slotHandedOver, ...leavingSideSlots]
  const newArrivingSideSlots = remainingArrivingSlots

  if (targetSide === 'A') {
    return { creatorSide: 'A', sideA: newArrivingSideSlots, sideB: newLeavingSideSlots }
  }
  return { creatorSide: 'B', sideA: newLeavingSideSlots, sideB: newArrivingSideSlots }
}

// --- Score ---

// Camp en tête pendant la saisie ; null à égalité.
export function leadingSideOf(scoreA: number, scoreB: number): FreeMatchSide | null {
  if (scoreA === scoreB) return null
  return scoreA > scoreB ? 'A' : 'B'
}

// Vainqueur d'un match enregistré (scores finaux, jamais égaux en base) —
// même règle que le camp en tête, nommée pour l'intention.
export function winnerSideOf(scoreA: number, scoreB: number): FreeMatchSide | null {
  return leadingSideOf(scoreA, scoreB)
}

// Point de vue d'un joueur sur un match : son camp et les scores des deux
// camps — la forme minimale commune au FreeMatch complet et à l'entrée de
// journal du bundle de profil (typage structurel).
export type FreeMatchPerspective = {
  side: FreeMatchSide
  scoreA: number
  scoreB: number
}

export type FreeMatchOutcome = {
  won: boolean
  pointsScored: number
  pointsConceded: number
}

// Issue et points du point de vue d'un joueur : son camp gagne ssi c'est
// le camp vainqueur (score le plus haut — jamais d'égalité en base).
export function freeMatchOutcomeOf(
  perspective: FreeMatchPerspective,
): FreeMatchOutcome {
  const playedOnSideA = perspective.side === 'A'
  return {
    won: winnerSideOf(perspective.scoreA, perspective.scoreB) === perspective.side,
    pointsScored: playedOnSideA ? perspective.scoreA : perspective.scoreB,
    pointsConceded: playedOnSideA ? perspective.scoreB : perspective.scoreA,
  }
}

// --- Affichage ---

// L'ordre des joueurs d'un camp n'est pas reconstituable depuis la base
// (même created_at) : tri déterministe par pseudo figé (locale française),
// id en départage pour rester stable entre deux chargements.
export function sortFreeMatchPlayers(players: FreeMatchPlayer[]): FreeMatchPlayer[] {
  return [...players].sort(
    (firstPlayer, secondPlayer) =>
      firstPlayer.displayNameSnapshot.localeCompare(secondPlayer.displayNameSnapshot, 'fr')
      || firstPlayer.id.localeCompare(secondPlayer.id),
  )
}
