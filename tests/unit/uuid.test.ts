import { describe, expect, it } from 'vitest'
import { isUuid } from '../../app/utils/uuid'

describe('isUuid', () => {
  it('accepte un uuid v4 minuscule (format généré par crypto.randomUUID)', () => {
    expect(isUuid('aaaaaaaa-aaaa-4aaa-8aaa-000000000001')).toBe(true)
  })

  it('accepte la casse mixte et les majuscules (comme le parseur uuid de Postgres)', () => {
    expect(isUuid('AAAAAAAA-AAAA-4AAA-8AAA-000000000001')).toBe(true)
    expect(isUuid('AaAaAaAa-aAaA-4aAa-8AaA-000000000001')).toBe(true)
  })

  it('rejette la chaîne vide', () => {
    expect(isUuid('')).toBe(false)
  })

  it('rejette un uuid tronqué', () => {
    expect(isUuid('aaaaaaaa-aaaa-4aaa-8aaa-00000000000')).toBe(false)
    expect(isUuid('aaaaaaaa-aaaa-4aaa')).toBe(false)
  })

  it('rejette un id fantaisiste', () => {
    expect(isUuid('blablabla')).toBe(false)
  })

  it('rejette un uuid prolongé par un suffixe', () => {
    expect(isUuid('aaaaaaaa-aaaa-4aaa-8aaa-000000000001x')).toBe(false)
    expect(isUuid('aaaaaaaa-aaaa-4aaa-8aaa-000000000001/edit')).toBe(false)
  })

  it('accepte le nil uuid (valide côté Postgres, introuvable en base)', () => {
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true)
  })
})
