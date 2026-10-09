// SPDX-License-Identifier: EPL-2.0
import type { WorkspaceUuid } from '@hcengineering/core'
import { isMarkdownsEquals } from '@hcengineering/text-markdown'
import { createMarkdownConverter, markdownUrls } from '../markdown'
import { rewriteInbound, rewriteOutbound } from '../sync/image-links'

const md = createMarkdownConverter({ refUrl: 'ref://', imageUrl: 'http://front/files?file=' })

describe('markdown converter', () => {
  it.each([
    'plain text',
    '**bold** and `code`',
    '- [ ] todo\n- [x] done',
    '# Title\n\nParagraph with a [link](https://example.com)',
    '<details><summary>More</summary>\n\nHidden text\n</details>',
    '| a | b |\n|---|---|\n| 1 | 2 |'
  ])('round-trips %p', (text) => {
    expect(isMarkdownsEquals(text, md.toMarkdown(md.toMarkup(text)))).toBe(true)
  })

  it('exposes its URLs, so image links can be rewritten around it', () => {
    expect(md.urls).toEqual({ refUrl: 'ref://', imageUrl: 'http://front/files?file=' })
  })

  it('maps empty and missing markdown to empty markup', () => {
    expect(md.toMarkup(null)).toBe('')
    expect(md.toMarkup(undefined)).toBe('')
    expect(md.toMarkup('')).toBe('')
  })

  it('is deterministic, so markup comparisons are stable', () => {
    expect(md.toMarkup('Body 1')).toBe(md.toMarkup('Body 1'))
  })

  it('builds workspace links for references and files', () => {
    expect(markdownUrls('http://front/', 'ws1' as WorkspaceUuid)).toEqual({
      refUrl: 'http://front/browse/?workspace=ws1',
      imageUrl: 'http://front/files?workspace=ws1&file='
    })
  })

  it('round-trips a sized external image as an img tag', () => {
    const html = '<img width="300" height="200" src="https://gitlab.example.com/group/proj/uploads/0123456789abcdef0123456789abcdef/a.png" alt="shot">'
    expect(md.toMarkdown(md.toMarkup(html))).toBe(html)
    const inline = 'before <img width="300" src="https://gitlab.example.com/group/proj/uploads/0123456789abcdef0123456789abcdef/my shot.png" alt="my\\_shot"> after'
    expect(md.toMarkdown(md.toMarkup(inline))).toBe(inline)
  })

  it('returns a linked image to GitLab byte for byte through the converter', () => {
    const target = { host: 'https://gitlab.example.com', webUrl: 'https://gitlab.example.com/group/proj', projectId: 42 }
    const imageUrl = 'http://front/files?file='
    const S = '0123456789abcdef0123456789abcdef'
    for (const gitlab of [
      `before ![my\\_shot](/uploads/${S}/a.png){width=300 height=200} after`,
      `![Screenshot 2026-10-08 at 1.13.17 AM.png](/uploads/${S}/Screenshot_2026-10-08_at_1.13.17_AM.png){width=900 height=138}`,
      `![spaced](</uploads/${S}/my shot.png>){width=40}`,
      `![plain](/uploads/${S}/b.png)`,
      `![odd](/uploads/${S}/c.png){width=30 align=left}`,
      `- item ![x](/uploads/${S}/d.png){width=10}`,
      `![g](/uploads/${S}/e.png){}`,
      `![h](/uploads/${S}/f.png){height=20 width=30}`,
      `Wow!![a](/uploads/${S}/a.png){width=3}`,
      `📎 ![a](/uploads/${S}/a.png){width=3}`,
      `📎 ![b](/uploads/${S}/b.png)`
    ]) {
      const huly = rewriteInbound(gitlab, target, new Map(), imageUrl)
      const roundTripped = md.toMarkdown(md.toMarkup(huly))
      expect(rewriteOutbound(roundTripped, target, new Map(), imageUrl)).toBe(gitlab)
    }
  })

  it('shows a linked image as a plain link marked by its fragment', () => {
    const href = 'https://gitlab.example.com/group/proj/uploads/0123456789abcdef0123456789abcdef/a.png#gitlab-image=width%3D300'
    const markup = JSON.parse(md.toMarkup(`[shot](${href})`))
    expect(markup.content[0].content).toEqual([{ type: 'text', text: 'shot', marks: [{ type: 'link', attrs: expect.objectContaining({ href }) }] }])
  })
})
