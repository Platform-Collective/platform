// SPDX-License-Identifier: EPL-2.0

import { type EditorState, NodeSelection, TextSelection, type Transaction } from '@tiptap/pm/state'

export function moveCursorBeforeSelectedLeadingImage (
  state: EditorState,
  dispatch?: (transaction: Transaction) => void
): boolean {
  const { selection } = state
  const isSelectedLeadingImage =
    selection instanceof NodeSelection &&
    selection.node.type.name === 'image' &&
    selection.$from.parentOffset === 0 &&
    selection.$from.index(0) === 0
  if (!isSelectedLeadingImage) {
    return false
  }

  if (dispatch !== undefined) {
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, selection.from)))
  }

  return true
}
