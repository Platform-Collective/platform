// SPDX-License-Identifier: EPL-2.0

import contact from '@hcengineering/contact'
import { MarkupMarkType, MarkupNodeType, jsonToMarkup } from '@hcengineering/text'
import type { MarkupNode } from '@hcengineering/text'
import { markupToMarkdown, parseMessageMarkdown, parseMessageMarkdownWithPersons } from '..'

const REF_URL = 'https://brand.example/browse/?workspace=workspace-uuid'
const PERSON_URL = 'https://brand.example/workbench/workspace-name/contact/'
const IMAGE_URL = 'https://brand.example/files/workspace-uuid/'
const GUEST_URL = 'https://brand.example/guest/workspace-name'
const PERSON_ID = '63204fc031b9728f9e6b2e1a'
const LABEL = 'Kristina Fefelova'

function personMarkup (): MarkupNode {
  return {
    type: MarkupNodeType.doc,
    content: [
      {
        type: MarkupNodeType.blockquote,
        content: [
          {
            type: MarkupNodeType.paragraph,
            content: [
              {
                type: MarkupNodeType.reference,
                attrs: { id: PERSON_ID, objectclass: contact.class.Person, label: LABEL }
              }
            ]
          }
        ]
      }
    ]
  }
}

describe('GitHub Person mention links', () => {
  it('uses the branded front and workspace URL name for nested Person mentions', async () => {
    const markdown = await markupToMarkdown(jsonToMarkup(personMarkup()), REF_URL, IMAGE_URL, undefined, PERSON_URL)

    expect(markdown).toBe(`> [${LABEL}](${PERSON_URL}${PERSON_ID})`)
    expect(markdown).not.toContain('browse')
    expect(markdown).not.toContain('workspace-uuid')
  })

  it('applies mention conversion after the existing preprocessor', async () => {
    const preprocessor = jest.fn(async (node: MarkupNode) => {
      node.content = personMarkup().content
    })
    const markup = jsonToMarkup({ type: MarkupNodeType.doc, content: [] })

    const markdown = await markupToMarkdown(markup, REF_URL, IMAGE_URL, preprocessor, PERSON_URL)

    expect(preprocessor).toHaveBeenCalledTimes(1)
    expect(markdown).toBe(`> [${LABEL}](${PERSON_URL}${PERSON_ID})`)
  })

  it('restores Person references and keeps their labels on round trips', async () => {
    const markdown = `[${LABEL}](${PERSON_URL}${PERSON_ID})`
    const parsed = parseMessageMarkdown(markdown, REF_URL, IMAGE_URL, GUEST_URL, PERSON_URL)

    expect(parsed.content?.[0].content?.[0]).toMatchObject({
      type: MarkupNodeType.reference,
      attrs: { id: PERSON_ID, objectclass: contact.class.Person, label: LABEL }
    })
    expect(await markupToMarkdown(jsonToMarkup(parsed), REF_URL, IMAGE_URL, undefined, PERSON_URL)).toBe(markdown)
  })

  it('retains legacy browse reference parsing', () => {
    const url = `${REF_URL}&_class=contact%3Aclass%3APerson&_id=${PERSON_ID}&label=Kristina%20Fefelova`
    const parsed = parseMessageMarkdown(`[${LABEL}](${url})`, REF_URL, IMAGE_URL, GUEST_URL, PERSON_URL)

    expect(parsed.content?.[0].content?.[0]).toMatchObject({
      type: MarkupNodeType.reference,
      attrs: { id: PERSON_ID, objectclass: contact.class.Person, label: LABEL }
    })
  })

  it.each([
    `https://other.example/workbench/workspace-name/contact/${PERSON_ID}`,
    `https://brand.example/workbench/other-workspace/contact/${PERSON_ID}`,
    `${PERSON_URL}`,
    `${PERSON_URL}${PERSON_ID}/extra`
  ])('keeps unrelated or incomplete links as ordinary links: %s', (url) => {
    const parsed = parseMessageMarkdown(`[${LABEL}](${url})`, REF_URL, IMAGE_URL, GUEST_URL, PERSON_URL)

    expect(parsed.content?.[0].content?.[0]).toMatchObject({
      type: MarkupNodeType.text,
      text: LABEL,
      marks: [{ type: MarkupMarkType.link, attrs: { href: url } }]
    })
  })

  it('keeps non-Person references on the existing serialization path', async () => {
    const markup = personMarkup()
    const reference = markup.content?.[0].content?.[0].content?.[0]
    if (reference?.attrs === undefined) throw new Error('Missing test reference')
    reference.attrs.objectclass = 'github:class:GithubPullRequest'

    const markdown = await markupToMarkdown(jsonToMarkup(markup), REF_URL, IMAGE_URL, undefined, PERSON_URL)

    expect(markdown).toBe(
      `> [${LABEL}](${REF_URL}&_class=github%3Aclass%3AGithubPullRequest&_id=${PERSON_ID}&label=Kristina%20Fefelova)`
    )
  })
})

describe('GitHub contact links that do not resolve to a Person', () => {
  const OTHER_ID = '63204fc031b9728f9e6b2e1b'

  function linkNode (url: string): MarkupNode {
    return {
      type: MarkupNodeType.text,
      text: LABEL,
      marks: [{ type: MarkupMarkType.link, attrs: { href: url } }]
    }
  }

  async function parse (markdown: string, known: string[]): Promise<{ parsed: MarkupNode, lookup: jest.Mock }> {
    const lookup = jest.fn(async (ids: string[]) => ids.filter((id) => known.includes(id)))
    const parsed = await parseMessageMarkdownWithPersons(markdown, REF_URL, IMAGE_URL, GUEST_URL, PERSON_URL, lookup)
    return { parsed, lookup }
  }

  it('keeps a contact link with an unknown id as an ordinary link', async () => {
    const url = `${PERSON_URL}${OTHER_ID}`
    const { parsed, lookup } = await parse(`[${LABEL}](${url})`, [PERSON_ID])

    expect(parsed.content?.[0].content?.[0]).toMatchObject(linkNode(url))
    expect(lookup).toHaveBeenCalledWith([OTHER_ID])
  })

  it('turns a contact link with a known id into a Person mention', async () => {
    const { parsed } = await parse(`[${LABEL}](${PERSON_URL}${PERSON_ID})`, [PERSON_ID])

    expect(parsed.content?.[0].content?.[0]).toMatchObject({
      type: MarkupNodeType.reference,
      attrs: { id: PERSON_ID, objectclass: contact.class.Person, label: LABEL }
    })
  })

  it('looks up all ids of one message at once', async () => {
    const markdown = [
      `[${LABEL}](${PERSON_URL}${PERSON_ID})`,
      `[${LABEL}](${PERSON_URL}${OTHER_ID})`,
      `[${LABEL}](${PERSON_URL}${PERSON_ID})`
    ].join(' ')
    const { parsed, lookup } = await parse(markdown, [PERSON_ID])

    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledWith([PERSON_ID, OTHER_ID])
    const types = parsed.content?.[0].content?.filter((it) => it.text !== ' ').map((it) => it.type)
    expect(types).toEqual([MarkupNodeType.reference, MarkupNodeType.text, MarkupNodeType.reference])
    expect(parsed.content?.[0].content?.[2]).toMatchObject(linkNode(`${PERSON_URL}${OTHER_ID}`))
  })

  it('skips the lookup when a message has no contact links', async () => {
    const { parsed, lookup } = await parse('plain [link](https://example.com) text', [PERSON_ID])

    expect(lookup).not.toHaveBeenCalled()
    expect(parsed).toEqual(
      parseMessageMarkdown('plain [link](https://example.com) text', REF_URL, IMAGE_URL, GUEST_URL)
    )
  })

  it.each([`\`[${LABEL}](${PERSON_URL}${PERSON_ID})\``, `\`\`\`\n[${LABEL}](${PERSON_URL}${PERSON_ID})\n\`\`\``])(
    'leaves contact links inside code untouched: %s',
    async (markdown) => {
      const { parsed, lookup } = await parse(markdown, [PERSON_ID])

      expect(lookup).not.toHaveBeenCalled()
      expect(parsed).toEqual(parseMessageMarkdown(markdown, REF_URL, IMAGE_URL, GUEST_URL))
      expect(JSON.stringify(parsed)).not.toContain(MarkupNodeType.reference)
    }
  )
})
