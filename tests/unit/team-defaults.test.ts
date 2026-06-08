import { describe, expect, it } from 'vitest'
import { computeNextTeamNameDefault } from '../../app/utils/team-defaults'

describe('computeNextTeamNameDefault', () => {
  it('returns "Équipe 1" when no teams exist', () => {
    expect(computeNextTeamNameDefault([])).toBe('Équipe 1')
  })

  it('returns "Équipe 1" when only custom names exist', () => {
    expect(
      computeNextTeamNameDefault(['Les Pétanqueurs', 'Les Boulistes']),
    ).toBe('Équipe 1')
  })

  it('increments correctly for sequential default names', () => {
    expect(computeNextTeamNameDefault(['Équipe 1'])).toBe('Équipe 2')
    expect(computeNextTeamNameDefault(['Équipe 1', 'Équipe 2'])).toBe('Équipe 3')
  })

  it('uses max + 1 when there are gaps (deleted teams)', () => {
    expect(computeNextTeamNameDefault(['Équipe 1', 'Équipe 3'])).toBe('Équipe 4')
  })

  it('ignores custom names when computing max', () => {
    expect(computeNextTeamNameDefault(['Les Pétanqueurs', 'Équipe 1'])).toBe(
      'Équipe 2',
    )
    expect(computeNextTeamNameDefault(['Équipe 2', 'Custom', 'Équipe 5'])).toBe(
      'Équipe 6',
    )
  })

  it('is case-sensitive and accent-strict (does not match "équipe N" or "Equipe N")', () => {
    expect(computeNextTeamNameDefault(['équipe 1', 'Equipe 2'])).toBe('Équipe 1')
  })

  it('does not match names with extra characters', () => {
    expect(computeNextTeamNameDefault(['Équipe 1A', 'Équipe 2 bis'])).toBe(
      'Équipe 1',
    )
  })

  it('handles double-digit numbers correctly', () => {
    expect(computeNextTeamNameDefault(['Équipe 10'])).toBe('Équipe 11')
    expect(computeNextTeamNameDefault(['Équipe 9', 'Équipe 10'])).toBe(
      'Équipe 11',
    )
  })
})
