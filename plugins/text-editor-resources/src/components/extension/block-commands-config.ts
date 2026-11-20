// SPDX-License-Identifier: EPL-2.0

import textEditor from '@hcengineering/text-editor'
import { type InlineCommandsOptions } from './inlineCommands'
import { isBlockCommandAvailable, isBlockCommandId, runBlockCommand } from './block-commands'

// Extend the existing menu without replacing host contributions such as subpages.
export function withBlockCommands (
  config: Partial<InlineCommandsOptions>,
  excludedCommands: string[]
): Partial<InlineCommandsOptions> {
  const suggestion = config.suggestion
  if (suggestion === undefined) return config
  return {
    ...config,
    suggestion: {
      ...suggestion,
      items: async (props) => [
        ...((await suggestion.items?.(props)) ?? []).filter(({ id }) => !isBlockCommandId(id)),
        ...[
          { id: 'heading-1', label: textEditor.string.Heading1, icon: textEditor.icon.Header1 },
          { id: 'heading-2', label: textEditor.string.Heading2, icon: textEditor.icon.Header2 },
          { id: 'heading-3', label: textEditor.string.Heading3, icon: textEditor.icon.Header3 },
          { id: 'bullet-list', label: textEditor.string.BulletedList, icon: textEditor.icon.ListBullet },
          { id: 'ordered-list', label: textEditor.string.OrderedList, icon: textEditor.icon.ListNumber },
          { id: 'blockquote', label: textEditor.string.Blockquote, icon: textEditor.icon.Quote }
        ].filter(({ id }) => !excludedCommands.includes(id) && isBlockCommandAvailable(props.editor, id))
      ],
      command: (props) => {
        if (props.props?.id == null || !props.editor.isEditable) return
        if (isBlockCommandId(props.props.id)) {
          if (!excludedCommands.includes(props.props.id)) {
            runBlockCommand(props.editor, props.props.id, props.range.from, props.range)
          }
          return
        }
        suggestion.command?.(props)
      }
    }
  }
}
