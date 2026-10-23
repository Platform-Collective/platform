// SPDX-License-Identifier: EPL-2.0

import { getCalloutKind, type CalloutKind } from '@hcengineering/text-core'
import { Node, mergeAttributes } from '@tiptap/core'

export interface CalloutAttributes {
  kind?: CalloutKind
  emoji?: string | null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the current blocks in a callout. */
      setCallout: (attributes?: CalloutAttributes) => ReturnType
      /** Lift the current blocks out of a callout. */
      unsetCallout: () => ReturnType
    }
  }
}

/** Shared callout schema used by the editor and server HTML conversion. */
export const CalloutNode = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes () {
    return {
      kind: {
        default: 'info',
        parseHTML: (element) => getCalloutKind(element.getAttribute('data-kind')),
        renderHTML: (attributes) => ({ 'data-kind': getCalloutKind(attributes.kind) })
      },
      emoji: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-emoji'),
        renderHTML: (attributes) => (attributes.emoji == null ? {} : { 'data-emoji': attributes.emoji })
      }
    }
  },

  parseHTML () {
    return [{ tag: 'div[data-type="callout"]' }]
  },

  renderHTML ({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0]
  },

  addCommands () {
    return {
      setCallout:
        (attributes = {}) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attributes),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name)
    }
  },

  addKeyboardShortcuts () {
    const liftEmptyCallout = (): boolean => {
      const { $from, empty } = this.editor.state.selection
      return empty && $from.depth > 1 && $from.node(-1).type.name === this.name && this.editor.commands.liftEmptyBlock()
    }
    return {
      Enter: liftEmptyCallout,
      Backspace: liftEmptyCallout
    }
  }
})
