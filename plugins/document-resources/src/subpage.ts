// SPDX-License-Identifier: EPL-2.0

import type { Teamspace } from '@hcengineering/document'
import { AccountRole, type Account, type Class, type Doc, type Ref, hasAccountRole } from '@hcengineering/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from 'y-prosemirror'
import { compareRelativePositions, type Doc as YDoc, type RelativePosition, type XmlFragment } from 'yjs'

/** Id of the "Subpage" editor command */
export const SubpageCommandId = 'document-subpage'

/** Name of the editor node used for object mentions / document links */
const referenceNodeName = 'reference'

export interface ReferenceContent {
  type: string
  attrs?: Record<string, any>
  text?: string
  content?: ReferenceContent[]
}

/**
 * Editor content that links to a document: a reference (mention) node
 * followed by a space, the same shape the "@" mention popup inserts.
 * When the target position is between blocks (e.g. the side "+" menu),
 * the link is wrapped into a paragraph of its own.
 */
export function makeReferenceContent (
  id: Ref<Doc>,
  objectclass: Ref<Class<Doc>>,
  label: string,
  inline = true
): ReferenceContent[] {
  const content: ReferenceContent[] = [
    { type: referenceNodeName, attrs: { id, objectclass, label } },
    { type: 'text', text: ' ' }
  ]
  return inline ? content : [{ type: 'paragraph', content }]
}

interface NodeLike {
  type: { name: string }
  attrs: Record<string, any>
  nodeSize: number
  text?: string
}

interface DocLike {
  descendants: (f: (node: NodeLike, pos: number) => boolean | undefined) => void
}

interface ReferenceRange {
  from: number
  to: number
}

/**
 * Ranges of the reference nodes pointing to the given object, in descending
 * order so that they can be deleted one by one without remapping positions.
 */
export function findReferenceRanges (doc: DocLike, id: Ref<Doc>, separators: ReferenceRange[] = []): ReferenceRange[] {
  const ranges: ReferenceRange[] = [...separators]
  doc.descendants((node, pos) => {
    if (node.type.name === referenceNodeName && node.attrs.id === id) {
      ranges.push({ from: pos, to: pos + node.nodeSize })
    }
    return true
  })
  const merged: ReferenceRange[] = []
  for (const range of ranges.sort((a, b) => a.from - b.from)) {
    const previous = merged[merged.length - 1]
    if (previous !== undefined && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to)
    } else {
      merged.push({ ...range })
    }
  }
  return merged.reverse()
}

/** Track the separator's identity, including appended and collaborative transactions. */
export function createSubpageRollback (
  editor: Editor,
  id: Ref<Doc>
): {
  track: (tr: Transaction) => void
  capture: () => void
  ranges: () => ReferenceRange[]
  dispose: () => void
} {
  const key = new PluginKey<ReferenceRange[]>('subpage-separators')
  let collaborative: { doc: YDoc, type: XmlFragment, positions: RelativePosition[] } | undefined
  editor.registerPlugin(
    new Plugin<ReferenceRange[]>({
      key,
      state: {
        init: () => [],
        apply: (tr, ranges) => {
          const inserted: ReferenceRange[] | undefined = tr.getMeta(key)
          if (inserted !== undefined) return inserted
          return ranges.flatMap(({ from, to }) => {
            const start = tr.mapping.mapResult(from, 1)
            const end = tr.mapping.mapResult(to, -1)
            return start.deleted || end.deleted || end.pos - start.pos !== 1 ? [] : [{ from: start.pos, to: end.pos }]
          })
        }
      }
    })
  )
  return {
    track: (tr) => {
      const separators: ReferenceRange[] = []
      tr.doc.descendants((node, pos) => {
        const end = pos + node.nodeSize
        if (
          node.type.name === referenceNodeName &&
          node.attrs.id === id &&
          tr.doc.nodeAt(end)?.text?.startsWith(' ') === true
        ) {
          separators.push({ from: end, to: end + 1 })
        }
      })
      tr.setMeta(key, separators)
    },
    capture: () => {
      // Capture after dispatch, when the sync plugin has integrated the inserted
      // character into Yjs. PM mappings alone lose identity on remote projections.
      const sync = ySyncPluginKey.getState(editor.state)
      if (sync?.binding == null) return
      collaborative = {
        doc: sync.doc,
        type: sync.type,
        positions: (key.getState(editor.state) ?? []).map(({ from }) =>
          absolutePositionToRelativePosition(from, sync.type, sync.binding.mapping)
        )
      }
    },
    ranges: () => {
      let separators = key.getState(editor.state) ?? []
      if (collaborative !== undefined) {
        const sync = ySyncPluginKey.getState(editor.state)
        separators =
          sync?.binding == null || sync.doc !== collaborative.doc || sync.type !== collaborative.type
            ? []
            : collaborative.positions.flatMap((position) => {
                const from = relativePositionToAbsolutePosition(sync.doc, sync.type, position, sync.binding.mapping)
                if (from === null || editor.state.doc.nodeAt(from)?.text?.startsWith(' ') !== true) return []
                // A deleted anchor can resolve to a neighbour. Recreate it to verify
                // the exact original Yjs character, including replacement by a space.
                const current = absolutePositionToRelativePosition(from, sync.type, sync.binding.mapping)
                return compareRelativePositions(position, current) ? [{ from, to: from + 1 }] : []
              })
      }
      return findReferenceRanges(editor.state.doc, id, separators)
    },
    dispose: () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(key)
    }
  }
}

/**
 * Require workspace membership, an active teamspace membership and the
 * shared document creation permission. Missing space data fails closed.
 */
export function canCreateSubpage (
  account: Account,
  space?: Pick<Teamspace, 'members' | 'archived'>,
  allowed = false
): boolean {
  return (
    hasAccountRole(account, AccountRole.User) &&
    space !== undefined &&
    !space.archived &&
    space.members.includes(account.uuid) &&
    allowed
  )
}
