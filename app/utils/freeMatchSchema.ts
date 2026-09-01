import { z } from 'zod'
import type { FreeMatchSide } from '../types'
import { isSlotFilled } from './free-match'
import type { FreeMatchSlot } from './free-match'
import { validateMatchScore } from './score'

// Schéma Zod du formulaire de création d'un match libre. Factory pure :
// l'identité du créateur et la date du jour sont injectées (pas de
// Date.now() interne). Les chemins d'erreur — `sideA`, `sideB`, `score`,
// `playedOn` — sont les `name` des UFormField de la page : c'est ce qui place
// chaque message sous le bon champ. La base revérifie tout (RPC
// create_free_match) ; ce schéma évite l'aller-retour pour les cas courants.

export type FreeMatchSchemaOptions = {
  creatorUserId: string
  // Date du jour locale au format ISO (YYYY-MM-DD).
  today: string
}

const MIN_PLAYERS_PER_SIDE = 1
const MAX_PLAYERS_PER_SIDE = 3
// Même borne que la base (left(trim(display_name), 50)) : refuser plutôt
// que laisser tronquer silencieusement.
const MAX_DISPLAY_NAME_LENGTH = 50
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const slotSchema = z.object({
  userId: z.string().nullable(),
  displayName: z.string(),
})

const freeMatchFormShape = z.object({
  sideA: z.array(slotSchema),
  sideB: z.array(slotSchema),
  scoreA: z.number().int(),
  scoreB: z.number().int(),
  playedOn: z.string().regex(ISO_DATE_PATTERN, 'Date invalide.'),
  visibility: z.enum(['private', 'public']),
})

export type FreeMatchFormValues = z.infer<typeof freeMatchFormShape>

type FreeMatchIssuePath = 'sideA' | 'sideB' | 'score' | 'playedOn'
type AddIssue = (path: FreeMatchIssuePath, message: string) => void

function sidePath(side: FreeMatchSide): FreeMatchIssuePath {
  return side === 'A' ? 'sideA' : 'sideB'
}

// Un seul message par camp, du plus structurel au plus fin.
function checkSideSlots(side: FreeMatchSide, slots: FreeMatchSlot[], addIssue: AddIssue) {
  const path = sidePath(side)
  const sideSizeIsOutOfRange
    = slots.length < MIN_PLAYERS_PER_SIDE || slots.length > MAX_PLAYERS_PER_SIDE
  if (sideSizeIsOutOfRange) {
    addIssue(path, 'Chaque camp compte de 1 à 3 joueurs.')
    return
  }
  if (!slots.every(isSlotFilled)) {
    addIssue(path, `Renseignez tous les joueurs du camp ${side}.`)
    return
  }
  const aNameIsTooLong = slots.some(
    slot => slot.displayName.trim().length > MAX_DISPLAY_NAME_LENGTH,
  )
  if (aNameIsTooLong) {
    addIssue(path, `Un nom dépasse ${MAX_DISPLAY_NAME_LENGTH} caractères.`)
  }
}

function checkSidesAreBalanced(form: FreeMatchFormValues, addIssue: AddIssue) {
  if (form.sideA.length !== form.sideB.length) {
    addIssue('sideB', 'Les deux camps doivent avoir le même nombre de joueurs.')
  }
}

// Un compte ne joue qu'une fois dans le match, quel que soit le camp.
// L'erreur est posée sur le camp où le compte réapparaît.
function checkNoAccountPlaysTwice(form: FreeMatchFormValues, addIssue: AddIssue) {
  const seenUserIds = new Set<string>()
  const sides: Array<[FreeMatchSide, FreeMatchSlot[]]> = [['A', form.sideA], ['B', form.sideB]]
  for (const [side, slots] of sides) {
    for (const slot of slots) {
      if (slot.userId === null) continue
      if (seenUserIds.has(slot.userId)) {
        addIssue(sidePath(side), 'Un même compte ne peut pas jouer deux fois dans le match.')
        return
      }
      seenUserIds.add(slot.userId)
    }
  }
}

// Défense en profondeur : la ligne du créateur est verrouillée à l'écran,
// mais la base l'exige aussi (not_participant).
function checkCreatorIsPlaying(
  form: FreeMatchFormValues,
  creatorUserId: string,
  addIssue: AddIssue,
) {
  const creatorIsPlaying = [...form.sideA, ...form.sideB].some(
    slot => slot.userId === creatorUserId,
  )
  if (!creatorIsPlaying) {
    addIssue('sideA', 'Vous devez faire partie du match.')
  }
}

function checkScore(form: FreeMatchFormValues, addIssue: AddIssue) {
  const validation = validateMatchScore(form.scoreA, form.scoreB)
  if (!validation.valid && validation.error !== undefined) {
    addIssue('score', validation.error)
  }
}

// Les dates ISO se comparent comme du texte. Zod 4 poursuit les refinements
// après une issue non fatale : une date malformée (déjà signalée par la
// regex du shape) n'est pas comparée, sinon deux messages s'empileraient.
function checkPlayedOnIsNotInTheFuture(
  form: FreeMatchFormValues,
  today: string,
  addIssue: AddIssue,
) {
  const playedOnIsWellFormed = ISO_DATE_PATTERN.test(form.playedOn)
  if (playedOnIsWellFormed && form.playedOn > today) {
    addIssue('playedOn', 'La date du match ne peut pas être dans le futur.')
  }
}

// Type du schéma construit (paramètre de `Form<S>` côté Nuxt UI, qui attend
// le schéma et non les valeurs).
export type FreeMatchSchema = ReturnType<typeof buildFreeMatchSchema>

export function buildFreeMatchSchema(options: FreeMatchSchemaOptions) {
  return freeMatchFormShape.superRefine((form, context) => {
    const addIssue: AddIssue = (path, message) => {
      context.addIssue({ code: 'custom', path: [path], message })
    }
    checkSideSlots('A', form.sideA, addIssue)
    checkSideSlots('B', form.sideB, addIssue)
    checkSidesAreBalanced(form, addIssue)
    checkNoAccountPlaysTwice(form, addIssue)
    checkCreatorIsPlaying(form, options.creatorUserId, addIssue)
    checkScore(form, addIssue)
    checkPlayedOnIsNotInTheFuture(form, options.today, addIssue)
  })
}
