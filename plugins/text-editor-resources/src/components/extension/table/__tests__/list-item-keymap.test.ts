// SPDX-License-Identifier: EPL-2.0

import { readFileSync } from 'fs'
import { join } from 'path'

import {
  canHandleListItemShortcut,
  type ListItemCommandChecker,
  type ListItemShortcutEditor
} from '../list-item-keymap'

const repoRoot = join(__dirname, '../../../../../../..')
const table = readFileSync(
  join(repoRoot, 'plugins/text-editor-resources/src/components/extension/table/table.ts'),
  'utf8'
)

function editor (active: string[] = [], sinkable: string[] = [], liftable: string[] = []): ListItemShortcutEditor {
  const commands: ListItemCommandChecker = {
    sinkListItem: (typeOrName) => sinkable.includes(typeOrName),
    liftListItem: (typeOrName) => liftable.includes(typeOrName)
  }

  return {
    isActive: (typeOrName) => active.includes(typeOrName),
    can: () => commands
  }
}

describe('table list-item keymap guard', () => {
  it.each(['listItem', 'taskItem', 'todoItem'])('yields Tab when %s can sink', (itemType) => {
    expect(canHandleListItemShortcut(editor([itemType], [itemType]), 'sink')).toBe(true)
  })

  it.each(['listItem', 'taskItem', 'todoItem'])('yields Shift-Tab when %s can lift', (itemType) => {
    expect(canHandleListItemShortcut(editor([itemType], [], [itemType]), 'lift')).toBe(true)
  })

  it('keeps table navigation when the list command is unavailable', () => {
    expect(canHandleListItemShortcut(editor(), 'sink')).toBe(false)
    expect(canHandleListItemShortcut(editor(), 'lift')).toBe(false)
  })

  it('does not yield for another active node type', () => {
    expect(canHandleListItemShortcut(editor(['listItem'], ['todoItem']), 'sink')).toBe(false)
    expect(canHandleListItemShortcut(editor(['listItem'], [], ['todoItem']), 'lift')).toBe(false)
  })

  it('checks the list command before navigating table cells', () => {
    expect(table).toMatch(
      /Tab: \(\) => \{\s*if \(canHandleListItemShortcut\(this\.editor, 'sink'\)\) \{\s*return false\s*\}\s*if \(this\.editor\.commands\.goToNextCell\(\)\)/
    )
    expect(table).toMatch(
      /'Shift-Tab': \(\) => \{\s*if \(canHandleListItemShortcut\(this\.editor, 'lift'\)\) \{\s*return false\s*\}\s*return this\.editor\.commands\.goToPreviousCell\(\)/
    )
  })
})
