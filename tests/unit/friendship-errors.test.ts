import { describe, expect, it } from 'vitest'
import type { FriendshipErrorCode } from '../../app/types'
import {
  friendshipErrorField,
  friendshipErrorMeansGoalAlreadyMet,
  friendshipErrorMessage,
  friendshipErrorTriggersRefresh,
  parseFriendshipErrorCode,
} from '../../app/utils/friendship-errors'
import type { FriendshipAttemptedAction } from '../../app/utils/friendship-errors'

const ALL_CODES: FriendshipErrorCode[] = [
  'not_authenticated',
  'display_name_not_found',
  'self_request',
  'already_requested',
  'already_friends',
  'request_not_found',
  'not_addressee',
  'not_requester',
  'unknown',
]

const KNOWN_CODES = ALL_CODES.filter(code => code !== 'unknown')

describe('parseFriendshipErrorCode', () => {
  it.each(KNOWN_CODES)('recognizes the exact code %s', (code) => {
    expect(parseFriendshipErrorCode(code)).toBe(code)
  })

  it('does not confuse the not_ prefixed codes with each other', () => {
    expect(parseFriendshipErrorCode('not_authenticated')).toBe('not_authenticated')
    expect(parseFriendshipErrorCode('not_addressee')).toBe('not_addressee')
    expect(parseFriendshipErrorCode('not_requester')).toBe('not_requester')
  })

  it('does not reduce request_not_found to a substring match', () => {
    expect(parseFriendshipErrorCode('request_not_found')).toBe('request_not_found')
    expect(parseFriendshipErrorCode('not_found')).toBe('unknown')
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseFriendshipErrorCode('  already_friends  ')).toBe('already_friends')
  })

  it('falls back to unknown for an unrecognized or empty message', () => {
    expect(parseFriendshipErrorCode('TypeError: fetch failed')).toBe('unknown')
    expect(parseFriendshipErrorCode('')).toBe('unknown')
  })

  it('does not match a code embedded in a longer message (strict equality)', () => {
    expect(parseFriendshipErrorCode('error: self_request happened')).toBe('unknown')
  })
})

describe('friendshipErrorField', () => {
  it('routes the display-name related codes to the search field', () => {
    expect(friendshipErrorField('display_name_not_found')).toBe('displayName')
    expect(friendshipErrorField('self_request')).toBe('displayName')
    expect(friendshipErrorField('already_requested')).toBe('displayName')
    expect(friendshipErrorField('already_friends')).toBe('displayName')
  })

  it('routes every other code to a toast (null)', () => {
    const toastCodes: FriendshipErrorCode[] = [
      'not_authenticated',
      'request_not_found',
      'not_addressee',
      'not_requester',
      'unknown',
    ]
    for (const code of toastCodes) {
      expect(friendshipErrorField(code)).toBeNull()
    }
  })
})

describe('friendshipErrorMessage', () => {
  it.each(ALL_CODES)('gives %s a readable French message, never the raw code', (code) => {
    const message = friendshipErrorMessage(code)
    expect(message.length).toBeGreaterThan(0)
    expect(message).not.toBe(code)
    expect(message).not.toContain('_')
  })
})

describe('friendshipErrorTriggersRefresh', () => {
  it('refreshes on the stale-state codes only', () => {
    expect(friendshipErrorTriggersRefresh('already_requested')).toBe(true)
    expect(friendshipErrorTriggersRefresh('already_friends')).toBe(true)
    expect(friendshipErrorTriggersRefresh('request_not_found')).toBe(true)
    expect(friendshipErrorTriggersRefresh('not_addressee')).toBe(true)
    expect(friendshipErrorTriggersRefresh('not_requester')).toBe(true)
    expect(friendshipErrorTriggersRefresh('display_name_not_found')).toBe(false)
    expect(friendshipErrorTriggersRefresh('self_request')).toBe(false)
    expect(friendshipErrorTriggersRefresh('not_authenticated')).toBe(false)
    expect(friendshipErrorTriggersRefresh('unknown')).toBe(false)
  })
})

describe('friendshipErrorMeansGoalAlreadyMet', () => {
  const ALL_ACTIONS: FriendshipAttemptedAction[] = [
    'request',
    'accept',
    'refuse',
    'cancel',
    'remove',
  ]

  it('treats a vanished target as goal met for the deletion actions only', () => {
    expect(friendshipErrorMeansGoalAlreadyMet('cancel', 'request_not_found')).toBe(true)
    expect(friendshipErrorMeansGoalAlreadyMet('refuse', 'request_not_found')).toBe(true)
  })

  it('keeps accept (and request/remove) as signalled failures on a vanished target', () => {
    expect(friendshipErrorMeansGoalAlreadyMet('accept', 'request_not_found')).toBe(false)
    expect(friendshipErrorMeansGoalAlreadyMet('request', 'request_not_found')).toBe(false)
    expect(friendshipErrorMeansGoalAlreadyMet('remove', 'request_not_found')).toBe(false)
  })

  it('never softens any other code, already_friends included', () => {
    const otherCodes = ALL_CODES.filter(code => code !== 'request_not_found')
    for (const action of ALL_ACTIONS) {
      for (const code of otherCodes) {
        expect(friendshipErrorMeansGoalAlreadyMet(action, code)).toBe(false)
      }
    }
  })
})
