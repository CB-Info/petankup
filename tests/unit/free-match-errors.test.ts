import { describe, expect, it } from 'vitest'
import type { FreeMatchErrorCode } from '../../app/types'
import {
  freeMatchErrorField,
  freeMatchErrorMessage,
  parseFreeMatchErrorCode,
} from '../../app/utils/free-match-errors'

const ALL_CODES: FreeMatchErrorCode[] = [
  'not_authenticated',
  'invalid_players',
  'invalid_side',
  'invalid_display_name',
  'not_participant',
  'invalid_side_count',
  'unbalanced_sides',
  'duplicate_player',
  'invalid_score',
  'invalid_played_on',
  'player_user_not_found',
  'unknown',
]

describe('parseFreeMatchErrorCode', () => {
  it.each(ALL_CODES.filter(code => code !== 'unknown'))(
    'recognizes the exact RPC message "%s"',
    (code) => {
      expect(parseFreeMatchErrorCode(code)).toBe(code)
    },
  )

  it('does not confuse invalid_side_count with its prefix invalid_side', () => {
    expect(parseFreeMatchErrorCode('invalid_side_count')).toBe('invalid_side_count')
    expect(parseFreeMatchErrorCode('invalid_side')).toBe('invalid_side')
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseFreeMatchErrorCode('  invalid_score\n')).toBe('invalid_score')
  })

  it('falls back to unknown for an unrecognized message', () => {
    expect(parseFreeMatchErrorCode('connection reset by peer')).toBe('unknown')
    expect(parseFreeMatchErrorCode('')).toBe('unknown')
  })

  it('does not match a code embedded in a longer message (strict equality)', () => {
    expect(parseFreeMatchErrorCode('error: invalid_score raised by RPC')).toBe('unknown')
  })
})

describe('freeMatchErrorField', () => {
  it('routes the score and date errors to their form fields', () => {
    expect(freeMatchErrorField('invalid_score')).toBe('score')
    expect(freeMatchErrorField('invalid_played_on')).toBe('playedOn')
  })

  it('routes every other code to the form-level alert (null)', () => {
    const fieldLessCodes = ALL_CODES.filter(
      code => code !== 'invalid_score' && code !== 'invalid_played_on',
    )
    for (const code of fieldLessCodes) {
      expect(freeMatchErrorField(code)).toBeNull()
    }
  })
})

describe('freeMatchErrorMessage', () => {
  it.each(ALL_CODES)('gives "%s" a French message that is never the raw code', (code) => {
    const message = freeMatchErrorMessage(code)
    expect(message.length).toBeGreaterThan(0)
    expect(message).not.toBe(code)
    expect(message).not.toContain('_')
  })

  it('states the strict score rule', () => {
    expect(freeMatchErrorMessage('invalid_score')).toBe(
      'Le vainqueur doit avoir exactement 13 points, le perdant entre 0 et 12.',
    )
  })
})
