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
import { MarkupNode, jsonToMarkup, markupToJSON, htmlToJSON } from '@hcengineering/text'
import { MarkdownParser, storeNodes, storeMarks, MarkdownState } from '@hcengineering/text-markdown'
import { GithubKit } from './extensions'
import { hasHulyLink, hasHulyLinkText } from '../sync/guest'

function encodeCommentValue (value: string): string {
  return encodeURIComponent(value).replace(/[-!~*'()]/g, (character) => {
    return `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  })
}

function restorePersonReferenceMarkdown (message: string, refUrl: string): string {
  return message.replace(
    /<!--huly-person-reference:id=([A-Za-z0-9%._~]+)&label=([A-Za-z0-9%._~]*)-->([\s\S]*?)<!--\/huly-person-reference-->/g,
    (match, encodedId: string, encodedLabel: string, renderedLabel: string) => {
      try {
        const id = decodeURIComponent(encodedId)
        const label = decodeURIComponent(encodedLabel)
        const separator = refUrl.includes('?') ? '&' : '?'
        const url = `${refUrl}${separator}_class=${encodeCommentValue(contact.class.Person)}&_id=${encodeCommentValue(id)}&label=${encodeCommentValue(label)}`
        return `[${renderedLabel}](${url})`
      } catch {
        return match
      }
    }
  )
}

const githubStoreNodes = {
  ...storeNodes,
  reference: (...args: Parameters<typeof storeNodes.reference>): void => {
    const [state, node] = args
    if (node.attrs?.objectclass === contact.class.Person) {
      const id = String(node.attrs?.id ?? '')
      const label = String(node.attrs?.label ?? '')
      state.write(`<!--huly-person-reference:id=${encodeCommentValue(id)}&label=${encodeCommentValue(label)}-->`)
      state.text(label, true)
      state.write('<!--/huly-person-reference-->')
      return
    }
    storeNodes.reference(...args)
  }
}

/**
 * @public
 */
export function parseMessageMarkdown (
  message: string | undefined,
  refUrl: string,
  imageUrl: string,
  guestUrl: string
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
  const json = parser.parse(restorePersonReferenceMarkdown(message ?? '', refUrl))
  return json
}

/**
 * @public
 */
export function serializeMessage (node: MarkupNode, refUrl: string, imageUrl: string): string {
  const state = new MarkdownState(githubStoreNodes, storeMarks, { tightLists: true, refUrl, imageUrl })
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
  preprocessor?: (nodes: MarkupNode) => Promise<void>
): Promise<string> {
  const json = markupToJSON(markup)
  await preprocessor?.(json)
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
