// SPDX-License-Identifier: EPL-2.0
import {
  absoluteUploadPathOf,
  hasHulyImages,
  inboundImagePaths,
  linkedImageUrls,
  outboundImages,
  rewriteInbound,
  rewriteOutbound,
  sameImages,
  uploadName,
  uploadPathOf,
  type UploadTarget
} from '../sync/image-links'

const target: UploadTarget = {
  host: 'https://gitlab.example.com',
  webUrl: 'https://gitlab.example.com/group/proj',
  projectId: 42
}
const S = '0123456789abcdef0123456789abcdef'
const PATH = `/uploads/${S}/shot.png`
const IMAGE_URL = 'http://front/files?file='

describe('uploadPathOf', () => {
  it('absoluteUploadPathOf accepts only absolute links to this project', () => {
    expect(absoluteUploadPathOf(`https://gitlab.example.com/group/proj${PATH}`, target)).toBe(PATH)
    expect(absoluteUploadPathOf(`https://gitlab.example.com/-/project/42${PATH}`, target)).toBe(PATH)
    expect(absoluteUploadPathOf(PATH, target)).toBeUndefined()
    expect(absoluteUploadPathOf(`/-/project/42${PATH}`, target)).toBeUndefined()
    expect(absoluteUploadPathOf(`https://gitlab.example.com/other/proj${PATH}`, target)).toBeUndefined()
  })

  it.each([
    [PATH, PATH],
    [`https://gitlab.example.com/group/proj${PATH}`, PATH],
    [`/-/project/42${PATH}`, PATH],
    [`https://gitlab.example.com/-/project/42${PATH}`, PATH],
    [`/-/project/43${PATH}`, undefined],
    ['https://gitlab.example.com/other/proj' + PATH, undefined],
    ['/uploads/short/shot.png', undefined],
    ['https://example.com/cat.png', undefined],
    // Dot segments would normalize to another GitLab endpoint
    [`/uploads/${S}/..`, undefined],
    [`/uploads/${S}/.`, undefined],
    [`/uploads/${S}/%2e%2e`, undefined],
    [`/uploads/${S}/%2E`, undefined]
  ])('%p is %p', (url, expected) => {
    expect(uploadPathOf(url, target)).toBe(expected)
  })
})

describe('inbound', () => {
  // GitLab.com answers 404 for <project path>/uploads/…; the project id form serves the upload
  it('links uploads by project id, and returns them to the relative form', () => {
    const gitlab = `[file](/uploads/${S}/report.pdf) ![a](${PATH})`
    const huly = rewriteInbound(gitlab, target, new Map(), IMAGE_URL)
    expect(huly).toBe(
      `[file](https://gitlab.example.com/-/project/42/uploads/${S}/report.pdf) [a](https://gitlab.example.com/-/project/42${PATH}#gitlab-image)`
    )
    expect(rewriteOutbound(huly, target, new Map(), IMAGE_URL)).toBe(gitlab)
  })

  it('returns links in the project path form', () => {
    const huly = `[file](${target.webUrl}/uploads/${S}/report.pdf) [a](${target.webUrl}${PATH}#gitlab-image)`
    expect(rewriteOutbound(huly, target, new Map(), IMAGE_URL)).toBe(`[file](/uploads/${S}/report.pdf) ![a](${PATH})`)
  })

  it('lists the images of this project once, but not links, other hosts or code', () => {
    const markdown = [
      `![a](${PATH}) and again ![b](${PATH})`,
      `[file](/uploads/${S}/report.pdf)`,
      '![cat](https://example.com/cat.png)',
      `\`![code](/uploads/${S}/in-span.png)\``,
      '```',
      `![fenced](/uploads/${S}/in-block.png)`,
      '```',
      `![spaced](</uploads/${S}/my shot.png>)`
    ].join('\n')
    expect(inboundImagePaths(markdown, target)).toEqual([PATH, `/uploads/${S}/my shot.png`])
  })

  it('points copied images at Huly with their size, and other uploads at GitLab', () => {
    const markdown = `![a](${PATH}){width=300 height=200} ![b](/uploads/${S}/other.png "title") [file](/uploads/${S}/report.pdf)`
    const files = new Map([[PATH, 'blob-1']])
    expect(rewriteInbound(markdown, target, files, IMAGE_URL)).toBe(
      `![a](${IMAGE_URL}blob-1&width=300&height=200) ![b](${target.host}/-/project/42/uploads/${S}/other.png "title") [file](${target.host}/-/project/42/uploads/${S}/report.pdf)`
    )
  })

  it('keeps code as written', () => {
    const markdown = `\`![a](${PATH})\``
    expect(rewriteInbound(markdown, target, new Map([[PATH, 'blob-1']]), IMAGE_URL)).toBe(markdown)
  })

  it('links a GitLab image with the image fragment, its size encoded in it', () => {
    const markdown = `![a](${PATH}){width=300 height=200} and ![b](/uploads/${S}/b.png)`
    expect(rewriteInbound(markdown, target, new Map(), IMAGE_URL)).toBe(
      `[a](${target.host}/-/project/42${PATH}#gitlab-image=width%3D300%20height%3D200) and [b](${target.host}/-/project/42/uploads/${S}/b.png#gitlab-image)`
    )
  })

  it('keeps the image form when a link cannot hold it: a title, no label, or inside another link', () => {
    const titled = `![a](${PATH} "t"){width=300}`
    expect(rewriteInbound(titled, target, new Map(), IMAGE_URL)).toBe(
      `![a](${target.host}/-/project/42${PATH} "t"){width=300}`
    )
    const unlabelled = `![](${PATH})`
    expect(rewriteInbound(unlabelled, target, new Map(), IMAGE_URL)).toBe(`![](${target.host}/-/project/42${PATH})`)
    const exclaimed = `Wow!![a](${PATH}){width=3}`
    expect(rewriteInbound(exclaimed, target, new Map(), IMAGE_URL)).toBe(
      `Wow!![a](${target.host}/-/project/42${PATH}){width=3}`
    )
    const wrapped = `[![a](${PATH})](https://example.com)`
    expect(rewriteInbound(wrapped, target, new Map(), IMAGE_URL)).toBe(
      `[![a](${target.host}/-/project/42${PATH})](https://example.com)`
    )
  })
})

describe('angle-bracket URLs', () => {
  const SPACED = `/uploads/${S}/my shot.png`
  const input = `![a](<${SPACED}>)`

  it('round-trips a copied path with spaces', () => {
    const huly = rewriteInbound(input, target, new Map([[SPACED, 'blob-1']]), IMAGE_URL)
    expect(rewriteOutbound(huly, target, new Map([['blob-1', SPACED]]), IMAGE_URL)).toBe(input)
  })

  it('keeps the brackets in the inbound fallback', () => {
    expect(rewriteInbound(input, target, new Map(), IMAGE_URL)).toBe(
      `[a](<${target.host}/-/project/42${SPACED}#gitlab-image>)`
    )
  })

  it('keeps the brackets from absolute to relative', () => {
    expect(rewriteOutbound(`[f](<${target.webUrl}${SPACED}>)`, target, new Map(), IMAGE_URL)).toBe(`[f](<${SPACED}>)`)
  })
})

describe('outbound', () => {
  it('reads the file id of a token URL', () => {
    expect(outboundImages(`![a](${IMAGE_URL}blob-1?file=blob-1&width=300&token=t)`, IMAGE_URL)).toEqual([
      { file: 'blob-1', alt: 'a' }
    ])
  })

  it('lists Huly images with their alt text', () => {
    expect(outboundImages(`![shot](${IMAGE_URL}blob-1&width=300) ![x](https://example.com/x.png)`, IMAGE_URL)).toEqual([
      { file: 'blob-1', alt: 'shot' }
    ])
  })

  it('points Huly images with a GitLab copy at the upload, and absolute upload links back to relative ones', () => {
    const markdown = `![shot](${IMAGE_URL}blob-1&width=300) ![new](${IMAGE_URL}blob-2) [f](${target.webUrl}/uploads/${S}/r.pdf)`
    expect(rewriteOutbound(markdown, target, new Map([['blob-1', PATH]]), IMAGE_URL)).toBe(
      `![shot](${PATH}){width=300} ![new](${IMAGE_URL}blob-2) [f](/uploads/${S}/r.pdf)`
    )
  })

  it('round-trips a copied image to the same GitLab markdown', () => {
    const gitlab = `Before ![a](${PATH}){width=300 height=200} after`
    const huly = rewriteInbound(gitlab, target, new Map([[PATH, 'blob-1']]), IMAGE_URL)
    expect(rewriteOutbound(huly, target, new Map([['blob-1', PATH]]), IMAGE_URL)).toBe(gitlab)
  })

  it('finds Huly image links still in GitLab text', () => {
    expect(hasHulyImages(`![a](${IMAGE_URL}blob-1)`, IMAGE_URL)).toBe(true)
    expect(hasHulyImages(`\`![a](${IMAGE_URL}blob-1)\``, IMAGE_URL)).toBe(false)
    expect(hasHulyImages(null, IMAGE_URL)).toBe(false)
  })

  it('turns a linked img tag of this project back into GitLab markdown', () => {
    const huly = `<img width="300" height="200" src="${target.webUrl}${PATH}" alt="a"> <img width="10" src="https://example.com/x.png" alt="x">`
    expect(rewriteOutbound(huly, target, new Map(), IMAGE_URL)).toBe(
      `![a](${PATH}){width=300 height=200} <img width="10" src="https://example.com/x.png" alt="x">`
    )
  })

  it('round-trips a linked image, whatever its braces', () => {
    for (const gitlab of [
      `Before ![a](${PATH}){width=300 height=200} after`,
      `![b](${PATH}){height=120}`,
      `![c](${PATH})`,
      `![d](${PATH}){height=20 width=30}`,
      `![e](${PATH}){width="30"}`,
      `![f](${PATH}){width=30 align=left}`,
      `![g](${PATH}){}`,
      `![spaced](</uploads/${S}/my shot.png>){width=40}`
    ]) {
      const huly = rewriteInbound(gitlab, target, new Map(), IMAGE_URL)
      expect(rewriteOutbound(huly, target, new Map(), IMAGE_URL)).toBe(gitlab)
    }
  })

  it('turns a sized img tag back into a GitLab image', () => {
    expect(
      rewriteOutbound(`<img width="300" src="${target.webUrl}${PATH}" alt="a">`, target, new Map(), IMAGE_URL)
    ).toBe(`![a](${PATH}){width=300}`)
  })

  it('leaves links with another fragment alone', () => {
    const huly = `[a](${target.webUrl}${PATH}#section)`
    expect(rewriteOutbound(huly, target, new Map(), IMAGE_URL)).toBe(`[a](${PATH}#section)`)
  })

  it('leaves sized links to other places alone', () => {
    const huly = '📎 [x](https://example.com/x.png#width%3D3)'
    expect(rewriteOutbound(huly, target, new Map(), IMAGE_URL)).toBe(huly)
  })

  it('leaves img tags in code alone', () => {
    const code = `\`<img width="300" src="${target.webUrl}${PATH}" alt="a">\``
    expect(rewriteOutbound(code, target, new Map(), IMAGE_URL)).toBe(code)
  })
})

describe('uploadName', () => {
  it.each([
    ['shot.png', 'image/png', 'shot.png'],
    ['shot', 'image/png', 'shot.png'],
    ['', 'image/jpeg', 'image.jpg'],
    [undefined, 'image/x-unknown', 'image'],
    ['a/b', 'image/gif', 'a_b.gif'],
    ['my\\_shot', 'image/png', 'my_shot.png']
  ])('%p as %p is %p', (alt, type, expected) => {
    expect(uploadName(alt, type)).toBe(expected)
  })
})

describe('linkedImageUrls', () => {
  const absolute = `https://gitlab.example.com/-/project/42${PATH}`

  it('lists the images left on GitLab, marked links and plain images, without fragments and once each', () => {
    const markdown = [
      `[shot](${absolute}#gitlab-image=width%3D300)`,
      `![other](https://gitlab.example.com/group/proj/uploads/${S}/b.png "title")`,
      `[shot again](${absolute}#gitlab-image)`
    ].join('\n')
    expect(linkedImageUrls(markdown, target)).toEqual([
      absolute,
      `https://gitlab.example.com/group/proj/uploads/${S}/b.png`
    ])
  })

  it('skips copied images, plain file links, other projects and code', () => {
    const markdown = [
      `![copied](${IMAGE_URL}blob-1)`,
      `[report.pdf](https://gitlab.example.com/-/project/42/uploads/${S}/report.pdf)`,
      `![elsewhere](https://gitlab.example.com/-/project/7${PATH})`,
      '```',
      `![code](${absolute})`,
      '```'
    ].join('\n')
    expect(linkedImageUrls(markdown, target)).toEqual([])
  })

  it('compares image lists in order', () => {
    expect(sameImages(undefined, [])).toBe(true)
    expect(sameImages(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameImages(['a', 'b'], ['b', 'a'])).toBe(false)
  })
})
