import { describe, expect, it } from 'vitest'
import type { WriteRefusedErrorCode } from '../../app/types'
import { writeRefusedFeedback } from '../../app/utils/write-refused'

// Le retour utilisateur d'une écriture refusée sur zéro ligne : un titre et
// un message en français, jamais le code brut ni un mot technique.

const ALL_CODES: WriteRefusedErrorCode[] = ['update_refused', 'nothing_deleted']

describe('writeRefusedFeedback', () => {
  it.each(ALL_CODES)('gives a French title and description for %s, never the raw code', (code) => {
    const feedback = writeRefusedFeedback(code)

    expect(feedback.title.length).toBeGreaterThan(0)
    expect(feedback.description.length).toBeGreaterThan(0)
    expect(feedback.title).not.toContain(code)
    expect(feedback.description).not.toContain(code)
    expect(feedback.title).not.toMatch(/_|error|row/i)
    expect(feedback.description).not.toMatch(/_|error|row/i)
  })

  it('names a refused modification as such, without claiming to know why', () => {
    const feedback = writeRefusedFeedback('update_refused')

    expect(feedback.title).toBe('Modification refusée')
    expect(feedback.description).toContain('entre-temps')
  })

  it('says honestly that nothing was deleted (refused or already gone: indistinguishable)', () => {
    const feedback = writeRefusedFeedback('nothing_deleted')

    expect(feedback.title).toBe('Rien n\'a été supprimé')
    expect(feedback.description).toContain('entre-temps')
  })
})
