// SPDX-License-Identifier: EPL-2.0

import type { Editor } from '@tiptap/core'
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey
} from 'y-prosemirror'

/** Capture a position that survives collaborative edits while asynchronous work is pending. */
export function captureEditorPosition (editor: Editor, pos: number): () => number | null {
  const sync = ySyncPluginKey.getState(editor.state)
  if (sync?.binding == null) {
    return () => Math.min(pos, editor.state.doc.content.size)
  }

  const position = absolutePositionToRelativePosition(pos, sync.type, sync.binding.mapping)
  return () => {
    const current = ySyncPluginKey.getState(editor.state)
    if (current?.binding == null || current.doc !== sync.doc || current.type !== sync.type) return null
    return relativePositionToAbsolutePosition(current.doc, current.type, position, current.binding.mapping)
  }
}
