// SPDX-License-Identifier: EPL-2.0

import { generateIssueBranchName } from '../issue-branch'

describe('generateIssueBranchName', () => {
  it.each([
    ['TSK-123', 'Fix login redirect', 'tsk-123-fix-login-redirect'],
    ['TSK-123', '  Fix / login___redirect!!!  ', 'tsk-123-fix-login-redirect'],
    ['TSK-123', 'Crème BRÛLÉE déjà vu', 'tsk-123-creme-brulee-deja-vu'],
    ['TSK-123', 'Cafe\u0301', 'tsk-123-cafe'],
    ['TSK-123', 'Straße Æsir Œuvre Øresund Łódź Đ Ð Þ', 'tsk-123-strasse-aesir-oeuvre-oresund-lodz-d-d-th'],
    ['TSK-123', 'Ｆｉｘ ① login', 'tsk-123-fix-1-login'],
    ['TSK-123', 'Fix 🚀 登录 redirect', 'tsk-123-fix-redirect'],
    ['TSK-123', '', 'tsk-123'],
    ['TSK-123', '🚀 登录 !!!', 'tsk-123'],
    ['PRÓJ-123', 'Fix', 'proj-123-fix']
  ])('formats %s / %s', (identifier, title, expected) => {
    expect(generateIssueBranchName(identifier, title)).toBe(expected)
  })

  it('keeps a name exactly at the limit', () => {
    expect(generateIssueBranchName('TSK-123', 'a'.repeat(52))).toBe(`tsk-123-${'a'.repeat(52)}`)
  })

  it('keeps a complete word ending at the limit before another dash', () => {
    expect(generateIssueBranchName('TSK-123', `${'a'.repeat(52)} more`)).toBe(`tsk-123-${'a'.repeat(52)}`)
  })

  it('drops a word crossing the limit at the previous dash', () => {
    expect(generateIssueBranchName('TSK-123', `fix ${'a'.repeat(49)} redirect`)).toBe('tsk-123-fix')
  })

  it('keeps the identifier when the first title word is too long', () => {
    expect(generateIssueBranchName('TSK-123', 'a'.repeat(80))).toBe('tsk-123')
  })

  it('enforces the limit even for a single overlong identifier token', () => {
    expect(generateIssueBranchName('A'.repeat(80), 'fix')).toBe('a'.repeat(60))
  })

  it.each(['fix '.repeat(40), 'a'.repeat(100), 'Crème / 🚀 '.repeat(40)])(
    'always emits a bounded ASCII branch for %s',
    (title) => {
      const branch = generateIssueBranchName('TSK-123', title)
      expect(branch.length).toBeLessThanOrEqual(60)
      expect(branch).toMatch(/^tsk-123(?:-[a-z0-9]+)*$/)
    }
  )
})
