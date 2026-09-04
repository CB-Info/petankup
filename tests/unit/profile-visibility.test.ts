import { describe, expect, it } from 'vitest'
import {
  isProfileVisibility,
  visibilityChangeToConfirm,
} from '../../app/utils/profile-visibility'

describe('isProfileVisibility', () => {
  it('reconnaît les deux valeurs du réglage', () => {
    expect(isProfileVisibility('public')).toBe(true)
    expect(isProfileVisibility('private')).toBe(true)
  })

  it('rejette tout le reste — le payload string | undefined du sélecteur en cartes inclus', () => {
    expect(isProfileVisibility(undefined)).toBe(false)
    expect(isProfileVisibility(null)).toBe(false)
    expect(isProfileVisibility('')).toBe(false)
    expect(isProfileVisibility('Public')).toBe(false)
    expect(isProfileVisibility('friends')).toBe(false)
    expect(isProfileVisibility(true)).toBe(false)
  })
})

describe('visibilityChangeToConfirm', () => {
  it('rend la cible quand la carte tapée est l’autre valeur (dans les deux sens)', () => {
    expect(visibilityChangeToConfirm('private', 'public')).toBe('private')
    expect(visibilityChangeToConfirm('public', 'private')).toBe('public')
  })

  it('ne confirme rien quand on retape la carte déjà active (le sélecteur émet quand même)', () => {
    expect(visibilityChangeToConfirm('public', 'public')).toBeNull()
    expect(visibilityChangeToConfirm('private', 'private')).toBeNull()
  })

  it('ne confirme rien sur un payload qui n’est pas un réglage', () => {
    expect(visibilityChangeToConfirm(undefined, 'public')).toBeNull()
    expect(visibilityChangeToConfirm('Public', 'public')).toBeNull()
    expect(visibilityChangeToConfirm('friends', 'private')).toBeNull()
  })

  it('ne confirme rien tant que le réglage courant n’est pas connu', () => {
    expect(visibilityChangeToConfirm('private', null)).toBeNull()
  })
})
