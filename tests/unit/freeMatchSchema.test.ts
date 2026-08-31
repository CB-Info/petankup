import { describe, expect, it } from 'vitest'
import { buildFreeMatchSchema } from '../../app/utils/freeMatchSchema'
import type { FreeMatchFormValues } from '../../app/utils/freeMatchSchema'

const CREATOR_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222'
const TODAY = '2026-08-30'

const schema = buildFreeMatchSchema({ creatorUserId: CREATOR_ID, today: TODAY })

function makeValidForm(overrides: Partial<FreeMatchFormValues> = {}): FreeMatchFormValues {
  return {
    sideA: [
      { userId: CREATOR_ID, displayName: 'Moi' },
      { userId: null, displayName: 'Alice' },
    ],
    sideB: [
      { userId: OTHER_ACCOUNT_ID, displayName: 'Bob' },
      { userId: null, displayName: 'Chloé' },
    ],
    scoreA: 13,
    scoreB: 7,
    playedOn: TODAY,
    visibility: 'private',
    ...overrides,
  }
}

// Messages d'erreur indexés par chemin (un message par champ au plus).
function errorsByPath(form: FreeMatchFormValues): Record<string, string> {
  const result = schema.safeParse(form)
  if (result.success) return {}
  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    errors[issue.path.join('.')] = issue.message
  }
  return errors
}

describe('buildFreeMatchSchema — nominal', () => {
  it('accepts a balanced doublette with the creator, free and linked players', () => {
    expect(schema.safeParse(makeValidForm()).success).toBe(true)
  })

  it('accepts a linked account whose display name is empty (the DB snapshots the pseudo)', () => {
    const form = makeValidForm({
      sideB: [
        { userId: OTHER_ACCOUNT_ID, displayName: '' },
        { userId: null, displayName: 'Chloé' },
      ],
    })
    expect(schema.safeParse(form).success).toBe(true)
  })

  it('accepts tête-à-tête and triplette', () => {
    const single = makeValidForm({
      sideA: [{ userId: CREATOR_ID, displayName: 'Moi' }],
      sideB: [{ userId: null, displayName: 'Bob' }],
    })
    const triple = makeValidForm({
      sideA: [
        { userId: CREATOR_ID, displayName: 'Moi' },
        { userId: null, displayName: 'Alice' },
        { userId: null, displayName: 'Anna' },
      ],
      sideB: [
        { userId: null, displayName: 'Bob' },
        { userId: null, displayName: 'Chloé' },
        { userId: null, displayName: 'Dan' },
      ],
    })
    expect(schema.safeParse(single).success).toBe(true)
    expect(schema.safeParse(triple).success).toBe(true)
  })
})

describe('buildFreeMatchSchema — sides', () => {
  it('flags an empty slot on the side it belongs to', () => {
    const form = makeValidForm({
      sideB: [
        { userId: null, displayName: 'Bob' },
        { userId: null, displayName: '   ' },
      ],
    })
    expect(errorsByPath(form)).toEqual({ sideB: 'Renseignez tous les joueurs du camp B.' })
  })

  it('rejects a name longer than 50 characters', () => {
    const form = makeValidForm({
      sideA: [
        { userId: CREATOR_ID, displayName: 'Moi' },
        { userId: null, displayName: 'x'.repeat(51) },
      ],
    })
    expect(errorsByPath(form)).toEqual({ sideA: 'Un nom dépasse 50 caractères.' })
  })

  it('rejects a side with more than 3 players', () => {
    const form = makeValidForm({
      sideA: [
        { userId: CREATOR_ID, displayName: 'Moi' },
        { userId: null, displayName: 'A' },
        { userId: null, displayName: 'B' },
        { userId: null, displayName: 'C' },
      ],
    })
    expect(errorsByPath(form).sideA).toBe('Chaque camp compte de 1 à 3 joueurs.')
  })

  it('rejects unbalanced sides (defensive: the UI always builds them balanced)', () => {
    const form = makeValidForm({
      sideB: [{ userId: null, displayName: 'Bob' }],
    })
    expect(errorsByPath(form)).toEqual({
      sideB: 'Les deux camps doivent avoir le même nombre de joueurs.',
    })
  })

  it('rejects the same account twice, on the side where it reappears', () => {
    const form = makeValidForm({
      sideB: [
        { userId: OTHER_ACCOUNT_ID, displayName: 'Bob' },
        { userId: OTHER_ACCOUNT_ID, displayName: 'Bob' },
      ],
    })
    expect(errorsByPath(form)).toEqual({
      sideB: 'Un même compte ne peut pas jouer deux fois dans le match.',
    })
  })

  it('rejects the same account across the two sides', () => {
    const form = makeValidForm({
      sideA: [
        { userId: CREATOR_ID, displayName: 'Moi' },
        { userId: OTHER_ACCOUNT_ID, displayName: 'Bob' },
      ],
    })
    expect(errorsByPath(form).sideB).toBe('Un même compte ne peut pas jouer deux fois dans le match.')
  })

  it('allows the same free name twice (homonyms are not accounts)', () => {
    const form = makeValidForm({
      sideA: [
        { userId: CREATOR_ID, displayName: 'Moi' },
        { userId: null, displayName: 'Bob' },
      ],
      sideB: [
        { userId: null, displayName: 'Bob' },
        { userId: null, displayName: 'Chloé' },
      ],
    })
    expect(schema.safeParse(form).success).toBe(true)
  })

  it('requires the creator to be playing (defense in depth)', () => {
    const form = makeValidForm({
      sideA: [
        { userId: null, displayName: 'Alice' },
        { userId: null, displayName: 'Anna' },
      ],
    })
    expect(errorsByPath(form)).toEqual({ sideA: 'Vous devez faire partie du match.' })
  })
})

describe('buildFreeMatchSchema — score', () => {
  it('puts the strict score rule under the score path', () => {
    expect(errorsByPath(makeValidForm({ scoreA: 12, scoreB: 5 }))).toEqual({
      score: 'Le vainqueur doit avoir exactement 13 points.',
    })
    expect(errorsByPath(makeValidForm({ scoreA: 13, scoreB: 13 }))).toEqual({
      score: 'Pas de match nul à la pétanque.',
    })
  })

  it('accepts a 13-0 and a 0-13', () => {
    expect(schema.safeParse(makeValidForm({ scoreA: 13, scoreB: 0 })).success).toBe(true)
    expect(schema.safeParse(makeValidForm({ scoreA: 0, scoreB: 13 })).success).toBe(true)
  })
})

describe('buildFreeMatchSchema — playedOn', () => {
  it('accepts today and a past date', () => {
    expect(schema.safeParse(makeValidForm({ playedOn: TODAY })).success).toBe(true)
    expect(schema.safeParse(makeValidForm({ playedOn: '2026-01-15' })).success).toBe(true)
  })

  it('rejects a future date', () => {
    expect(errorsByPath(makeValidForm({ playedOn: '2026-08-31' }))).toEqual({
      playedOn: 'La date du match ne peut pas être dans le futur.',
    })
  })

  it('rejects an empty or malformed date', () => {
    expect(errorsByPath(makeValidForm({ playedOn: '' }))).toEqual({ playedOn: 'Date invalide.' })
    expect(errorsByPath(makeValidForm({ playedOn: '30/08/2026' }))).toEqual({
      playedOn: 'Date invalide.',
    })
  })
})
