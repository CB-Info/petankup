import { describe, expect, it } from 'vitest'
import type { StartTournamentErrorCode } from '../../app/types'
import {
  parseStartTournamentErrorCode,
  startTournamentErrorMeansStaleScreen,
  startTournamentErrorMessage,
} from '../../app/utils/start-tournament-errors'

const ALL_CODES: StartTournamentErrorCode[] = [
  'not_authenticated',
  'not_owner',
  'tournament_not_draft',
  'not_enough_teams',
  'matches_already_generated',
  'invalid_matches',
  'unknown',
]

const KNOWN_CODES = ALL_CODES.filter(code => code !== 'unknown')

describe('parseStartTournamentErrorCode', () => {
  it.each(KNOWN_CODES)('recognizes the exact RPC message "%s"', (code) => {
    expect(parseStartTournamentErrorCode(code)).toBe(code)
  })

  it('does not confuse the not_ prefixed codes with each other', () => {
    expect(parseStartTournamentErrorCode('not_owner')).toBe('not_owner')
    expect(parseStartTournamentErrorCode('not_enough_teams')).toBe('not_enough_teams')
    expect(parseStartTournamentErrorCode('not_authenticated')).toBe('not_authenticated')
    expect(parseStartTournamentErrorCode('not_')).toBe('unknown')
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseStartTournamentErrorCode('  tournament_not_draft\n')).toBe('tournament_not_draft')
  })

  it('falls back to unknown for an unrecognized or empty message', () => {
    expect(parseStartTournamentErrorCode('connection reset by peer')).toBe('unknown')
    expect(parseStartTournamentErrorCode('new row violates row-level security policy')).toBe('unknown')
    expect(parseStartTournamentErrorCode('')).toBe('unknown')
  })

  it('does not match a code embedded in a longer message (strict equality)', () => {
    expect(parseStartTournamentErrorCode('error: not_owner raised by RPC')).toBe('unknown')
    expect(parseStartTournamentErrorCode('not_owner.')).toBe('unknown')
    expect(parseStartTournamentErrorCode('.not_owner')).toBe('unknown')
  })

  it('falls back to unknown when the message is not a string (gateway body without message)', () => {
    expect(parseStartTournamentErrorCode(undefined)).toBe('unknown')
    expect(parseStartTournamentErrorCode(null)).toBe('unknown')
    expect(parseStartTournamentErrorCode({ error: 'upstream timeout' })).toBe('unknown')
  })
})

describe('startTournamentErrorMessage', () => {
  it.each(ALL_CODES)('gives "%s" a French message that never contains the raw code', (code) => {
    const message = startTournamentErrorMessage(code)
    expect(message.length).toBeGreaterThan(0)
    expect(message).not.toContain(code)
    expect(message).not.toContain('_')
    expect(message).not.toMatch(/error|row|rpc|sql/i)
  })

  it('states the two-team rule', () => {
    expect(startTournamentErrorMessage('not_enough_teams')).toBe(
      'Il faut au moins deux équipes pour lancer le tournoi.',
    )
  })

  it('says the tournament was already started, whether it is in progress or completed', () => {
    expect(startTournamentErrorMessage('tournament_not_draft')).toBe('Ce tournoi a déjà été lancé.')
  })
})

describe('startTournamentErrorMeansStaleScreen', () => {
  // Table exhaustive : un code ajouté à l'union rend cette constante
  // incomplète, le contrôle de types des tests le signale.
  const EXPECTED_RELOAD_BY_CODE = {
    not_authenticated: false,
    not_owner: false,
    tournament_not_draft: true,
    not_enough_teams: true,
    matches_already_generated: true,
    invalid_matches: false,
    unknown: false,
  } satisfies Record<StartTournamentErrorCode, boolean>

  it.each(Object.entries(EXPECTED_RELOAD_BY_CODE) as Array<[StartTournamentErrorCode, boolean]>)(
    'decides for "%s" whether the screen is stale: %s',
    (code, expectedReload) => {
      expect(startTournamentErrorMeansStaleScreen(code)).toBe(expectedReload)
    },
  )

  it('reloads on exactly the three codes that mean the screen is lying', () => {
    // not_owner dit qu'on n'a pas le droit, pas que l'écran est périmé ;
    // invalid_matches couvre plusieurs causes dont un lot mal formé, où
    // recharger n'a aucun sens.
    const reloadingCodes = ALL_CODES.filter(startTournamentErrorMeansStaleScreen)
    expect(reloadingCodes).toEqual(['tournament_not_draft', 'not_enough_teams', 'matches_already_generated'])
  })
})
