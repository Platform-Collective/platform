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
import type { MarkupNode } from '@hcengineering/text'
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
    traverseNode(json, (node) => {
      const link = node.marks?.find((mark) => mark.type === MarkupMarkType.link)
      const href = link?.attrs?.href
      if (node.type !== MarkupNodeType.text || typeof href !== 'string' || !href.startsWith(personUrl)) return
      const id = href.slice(personUrl.length)
      if (id.length === 0 || /[/?#]/.test(id)) return
      let personId: string
      try {
        personId = decodeURIComponent(id)
      } catch {
        return
      }
      const label = node.text ?? ''
      node.type = MarkupNodeType.reference
      node.attrs = { id: personId, objectclass: contact.class.Person, label }
      node.content = [{ type: MarkupNodeType.text, text: label, marks: [] }]
      node.marks = node.marks?.filter((mark) => mark !== link)
      delete node.text
      return false
    })
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
