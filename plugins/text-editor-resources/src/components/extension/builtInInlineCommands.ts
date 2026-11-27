// SPDX-License-Identifier: EPL-2.0

import textEditor from '@hcengineering/text-editor'
import { IconScribble } from '@hcengineering/ui'
import view from '@hcengineering/view'
import type { InlineCommandItem } from './inlineCommandItems'

export const builtInInlineCommands: Array<Pick<InlineCommandItem, 'id' | 'label' | 'icon'>> = [
  { id: 'image', label: textEditor.string.Image, icon: view.icon.Image },
  { id: 'table', label: textEditor.string.Table, icon: view.icon.Table2 },
  { id: 'code-block', label: textEditor.string.CodeBlock, icon: view.icon.CodeBlock },
  { id: 'separator-line', label: textEditor.string.SeparatorLine, icon: view.icon.SeparatorLine },
  { id: 'todo-list', label: textEditor.string.TodoItem, icon: view.icon.TodoList },
  { id: 'drawing-board', label: textEditor.string.DrawingBoard, icon: IconScribble as any },
  { id: 'mermaid', label: textEditor.string.MermaidDiargram, icon: view.icon.Model }
]
