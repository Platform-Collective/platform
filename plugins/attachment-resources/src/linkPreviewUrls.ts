//
// Copyright © 2026 Hardcore Engineering Inc.
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

/**
 * Compares the urls that already have a link preview with the urls currently present in the message text.
 * Returns urls that appeared in the text (in text order, without duplicates) and tracked urls that are gone.
 */
export function diffLinkPreviewUrls (
  tracked: Iterable<string>,
  current: string[]
): { added: string[], removed: string[] } {
  const trackedSet = new Set(tracked)
  const currentSet = new Set(current)
  const added = Array.from(currentSet).filter((url) => !trackedSet.has(url))
  const removed = Array.from(trackedSet).filter((url) => !currentSet.has(url))
  return { added, removed }
}

export interface LinkPreviewAttachmentLike<T> {
  _id: T
  type: string
  metadata?: Record<string, any>
}

/**
 * Rebuilds the url -> link preview attachment mapping from existing (saved or draft) attachments.
 * Only previews that stored their source url in metadata.url can be matched.
 */
export function getLinkPreviewUrls<T> (attachments: Iterable<LinkPreviewAttachmentLike<T>>): Map<string, T> {
  const result = new Map<string, T>()
  for (const attachment of attachments) {
    const url = attachment.metadata?.url
    if (attachment.type !== 'application/link-preview' || typeof url !== 'string' || url === '') continue
    if (!result.has(url)) {
      result.set(url, attachment._id)
    }
  }
  return result
}
