import { describe, expect, it } from 'vitest'
import {
  FRIENDSHIP_ESTABLISHED_TOAST,
  QUIET_CONFIRMATION_TOAST,
  REQUEST_SENT_TOAST,
} from '../../app/composables/useFriendshipFeedback'

// Les contrats des messages de succès d'amitié. L'invariant du ticket :
// ce qui disparaît confirme (« C'est fait. », neutre), ce qui apparaît
// nomme (succès vert) — aucune action muette.

describe('QUIET_CONFIRMATION_TOAST', () => {
  it('states the exact title, and nothing else — no description', () => {
    expect(QUIET_CONFIRMATION_TOAST.title).toBe("C'est fait.")
    expect('description' in QUIET_CONFIRMATION_TOAST).toBe(false)
  })

  it('keeps the neutral tone: neither the warning look nor the success green', () => {
    expect(QUIET_CONFIRMATION_TOAST.color).toBe('neutral')
    expect(QUIET_CONFIRMATION_TOAST.icon).toBe('i-lucide-check')
  })
})

describe('creation toasts', () => {
  it('name exactly what now exists', () => {
    expect(FRIENDSHIP_ESTABLISHED_TOAST.title).toBe('Vous êtes maintenant amis.')
    expect(REQUEST_SENT_TOAST.title).toBe('Demande envoyée.')
  })

  it('celebrate in success green, unlike the neutral confirmation', () => {
    expect(FRIENDSHIP_ESTABLISHED_TOAST.color).toBe('success')
    expect(REQUEST_SENT_TOAST.color).toBe('success')
    expect(FRIENDSHIP_ESTABLISHED_TOAST.icon).toBe('i-lucide-check')
    expect(REQUEST_SENT_TOAST.icon).toBe('i-lucide-check')
  })

  it('never borrow the deletion confirmation — they name, they do not merely confirm', () => {
    expect(FRIENDSHIP_ESTABLISHED_TOAST.title).not.toBe(QUIET_CONFIRMATION_TOAST.title)
    expect(REQUEST_SENT_TOAST.title).not.toBe(QUIET_CONFIRMATION_TOAST.title)
  })
})
