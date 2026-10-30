// SPDX-License-Identifier: EPL-2.0
import { compareMarkdown, mergeFields } from '../sync/merge'

interface Snap {
  title: string
  body: string
}

const base: Snap = { title: 'A', body: 'x' }

describe('mergeFields', () => {
  it('takes a GitLab-only change into Huly', () => {
    const result = mergeFields(base, base, { ...base, title: 'B' })
    expect(result.toPlatform).toEqual({ title: 'B' })
    expect(result.toGitlab).toEqual({})
    expect(result.merged).toEqual({ title: 'B', body: 'x' })
  })

  it('pushes a Huly-only change to GitLab', () => {
    const result = mergeFields(base, { ...base, title: 'C' }, base)
    expect(result.toGitlab).toEqual({ title: 'C' })
    expect(result.toPlatform).toEqual({})
    expect(result.merged).toEqual({ title: 'C', body: 'x' })
  })

  it('lets Huly win when both sides changed a field differently', () => {
    const result = mergeFields(base, { ...base, title: 'Huly' }, { ...base, title: 'GitLab' })
    expect(result.toGitlab).toEqual({ title: 'Huly' })
    expect(result.toPlatform).toEqual({})
    expect(result.conflicts).toEqual(['title'])
    expect(result.merged.title).toBe('Huly')
  })

  it('does nothing when both sides made the same change', () => {
    const result = mergeFields(base, { ...base, title: 'Same' }, { ...base, title: 'Same' })
    expect(result.toGitlab).toEqual({})
    expect(result.toPlatform).toEqual({})
    expect(result.merged.title).toBe('Same')
  })

  it('uses per-field equality', () => {
    const trimmed = (a: string, b: string): boolean => a.trim() === b.trim()
    const result = mergeFields(base, { ...base, body: 'x  ' }, base, { body: trimmed })
    expect(result.toGitlab).toEqual({})
  })

  it('treats a field missing from an older base as agreed when both sides hold the same value', () => {
    const result = mergeFields({ title: 'A' } as unknown as Snap, base, base)
    expect(result.toGitlab).toEqual({})
    expect(result.toPlatform).toEqual({})
  })
})

describe('compareMarkdown', () => {
  it('ignores line endings and trailing spaces', () => {
    expect(compareMarkdown('a  \r\nb', 'a\nb')).toBe(true)
    expect(compareMarkdown('a', 'b')).toBe(false)
  })
})
