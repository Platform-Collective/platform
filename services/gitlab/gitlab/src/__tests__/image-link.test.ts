// SPDX-License-Identifier: EPL-2.0
import { GITLAB_IMAGE_FRAGMENT, GITLAB_IMAGE_HREF_PATTERN } from '../index'

describe('GitLab image links', () => {
  const pattern = new RegExp(GITLAB_IMAGE_HREF_PATTERN)
  const upload = 'https://gitlab.com/group/proj/uploads/0123456789abcdef0123456789abcdef/a.png'

  it('matches links marked as GitLab images, with or without a size', () => {
    expect(GITLAB_IMAGE_FRAGMENT).toBe('gitlab-image')
    expect(pattern.test(`${upload}#gitlab-image`)).toBe(true)
    expect(pattern.test(`${upload}#gitlab-image=width%3D300`)).toBe(true)
  })

  it('leaves every other link alone', () => {
    expect(pattern.test(upload)).toBe(false)
    expect(pattern.test(`${upload}#gitlab-images`)).toBe(false)
    expect(pattern.test('https://example.com/page#section')).toBe(false)
    expect(pattern.test('https://huly.example.com/workbench/ws/tracker/TSK-1')).toBe(false)
  })
})
