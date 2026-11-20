// SPDX-License-Identifier: EPL-2.0

import { type Asset, type IntlString } from '@hcengineering/platform'
import { type Editor } from '@tiptap/core'

/**
 * An editor command contributed by the host of an editor, shown in the
 * slash ("/") command popup and the side "+" menu next to the built-in ones.
 *
 * @public
 */
export interface InlineCommandItem {
  id: string
  label: IntlString
  icon: Asset
  action: (editor: Editor, pos: number) => void | Promise<void>
}

/**
 * Merge built-in command items with the ones contributed by the host.
 * Excluded ids are dropped and a contributed item never shadows an item
 * that is already present (the first occurrence of an id wins).
 *
 * @public
 */
export function mergeInlineCommandItems<T extends { id: string }> (
  base: T[],
  extra: T[] = [],
  excluded: string[] = []
): T[] {
  const result: T[] = []
  const seen = new Set<string>()
  for (const item of [...base, ...extra]) {
    if (excluded.includes(item.id) || seen.has(item.id)) continue
    seen.add(item.id)
    result.push(item)
  }
  return result
}
