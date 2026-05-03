import { describe, expect, it } from 'vitest'
import { formatDate } from '../../app/utils/format'

describe('formatDate', () => {
  it('formats an ISO date in French by default (jour mois année)', () => {
    expect(formatDate('2026-05-03T12:00:00.000Z')).toBe('3 mai 2026')
  })

  it('accepts a custom locale and produces the matching format', () => {
    expect(formatDate('2026-05-03T12:00:00.000Z', 'en-US')).toBe('May 3, 2026')
  })

  it('formats a December date correctly in French', () => {
    expect(formatDate('2026-12-25T12:00:00.000Z')).toBe('25 décembre 2026')
  })

  it('returns the same output for the same input (purity)', () => {
    const isoDate = '2026-01-01T12:00:00.000Z'
    expect(formatDate(isoDate)).toBe(formatDate(isoDate))
  })
})
