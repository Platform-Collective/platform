//
// Copyright © 2020, 2021 Anticrm Platform Contributors.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import contact from '@hcengineering/contact'
import {
  MarkupMarkType,
  MarkupNodeType,
  jsonToMarkup,
  markupToJSON,
  htmlToJSON,
  traverseNode
} from '@hcengineering/text'
import type { MarkupMark, MarkupNode } from '@hcengineering/text'
import { MarkdownParser, storeNodes, storeMarks, MarkdownState } from '@hcengineering/text-markdown'
import { GithubKit } from './extensions'
import { hasHulyLink, hasHulyLinkText } from '../sync/guest'

/**
 * @public
 */
export function parseMessageMarkdown (
  message: string | undefined,
  refUrl: string,
  imageUrl: string,
  guestUrl: string,
  personUrl?: string
): MarkupNode {
  const extensions = [
    GithubKit.configure({
      sub: {
        hasHulyText: hasHulyLinkText,
        hasHulyLink: (href) => hasHulyLink(href, guestUrl)
      }
    })
  ]
  const htmlParser = (html: string): MarkupNode => {
    return htmlToJSON(html, extensions)
  }
  const parser = new MarkdownParser({ refUrl, imageUrl, htmlParser })
  parser.tokenizer.set({ linkify: true })
  parser.tokenizer.linkify.set({ fuzzyLink: false, fuzzyEmail: false })
  const json = parser.parse(message ?? '')
  if (personUrl !== undefined) {
    convertPersonLinks(json, personUrl, () => true)
  }
  return json
}

/**
 * @public
 */
export function serializeMessage (node: MarkupNode, refUrl: string, imageUrl: string): string {
  const state = new MarkdownState(storeNodes, storeMarks, { tightLists: true, refUrl, imageUrl })
  state.renderContent(node)
  return state.out
}

/**
 * @public
 */
export async function markupToMarkdown (
  markup: string,
  refUrl: string = 'ref://',
  imageUrl: string = 'http://localhost',
  preprocessor?: (nodes: MarkupNode) => Promise<void>,
  personUrl?: string
): Promise<string> {
  const json = markupToJSON(markup)
  await preprocessor?.(json)
  if (personUrl !== undefined) {
    traverseNode(json, (node) => {
      const attrs = node.attrs
      if (node.type !== MarkupNodeType.reference || attrs?.objectclass !== contact.class.Person) return
      if (typeof attrs.id !== 'string' || attrs.id.length === 0) return
      node.type = MarkupNodeType.text
      node.text = String(attrs.label ?? '')
      node.marks = [
        ...(node.marks ?? []),
        { type: MarkupMarkType.link, attrs: { href: personUrl + encodeURIComponent(attrs.id), title: attrs.title } }
      ]
      delete node.attrs
      delete node.content
      return false
    })
  }
  return serializeMessage(json, refUrl, imageUrl)
}

/**
 * Parses a message like {@link parseMessageMarkdown}, but turns a contact link into a
 * Person mention only when its id resolves to a Person. Ids of one message are looked up
 * in a single call, and not at all when the message has no contact links.
 *
 * @public
 */
export async function parseMessageMarkdownWithPersons (
  message: string | undefined,
  refUrl: string,
  imageUrl: string,
  guestUrl: string,
  personUrl: string,
  findPersons: (ids: string[]) => Promise<Iterable<string>>
): Promise<MarkupNode> {
  const json = parseMessageMarkdown(message, refUrl, imageUrl, guestUrl)
  const ids = new Set<string>()
  traverseNode(json, (node) => {
    const id = getPersonLinkId(node, personUrl)?.id
    if (id !== undefined) ids.add(id)
    return true
  })
  if (ids.size === 0) return json
  const persons = new Set(await findPersons(Array.from(ids)))
  convertPersonLinks(json, personUrl, (id) => persons.has(id))
  return json
}

function getPersonLinkId (node: MarkupNode, personUrl: string): { id: string, link: MarkupMark } | undefined {
  const link = node.marks?.find((mark) => mark.type === MarkupMarkType.link)
  const href = link?.attrs?.href
  if (
    link === undefined ||
    node.type !== MarkupNodeType.text ||
    typeof href !== 'string' ||
    !href.startsWith(personUrl)
  ) {
    return undefined
  }
  const id = href.slice(personUrl.length)
  if (id.length === 0 || /[/?#]/.test(id)) return undefined
  try {
    return { id: decodeURIComponent(id), link }
  } catch {
    return undefined
  }
}

function convertPersonLinks (json: MarkupNode, personUrl: string, isPerson: (id: string) => boolean): void {
  traverseNode(json, (node) => {
    const personLink = getPersonLinkId(node, personUrl)
    if (personLink === undefined || !isPerson(personLink.id)) return
    const label = node.text ?? ''
    node.type = MarkupNodeType.reference
    node.attrs = { id: personLink.id, objectclass: contact.class.Person, label }
    node.content = [{ type: MarkupNodeType.text, text: label, marks: [] }]
    node.marks = node.marks?.filter((mark) => mark !== personLink.link)
    delete node.text
    return false
  })
}

/**
 * @public
 */
export function markdownToMarkup (
  message: string,
  refUrl: string = 'ref://',
  imageUrl: string = 'http://localhost',
  guestUrl: string = 'http://localhost/guest'
): string {
  const json = parseMessageMarkdown(message, refUrl, imageUrl, guestUrl)
  return jsonToMarkup(json)
}
