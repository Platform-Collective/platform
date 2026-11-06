// SPDX-License-Identifier: EPL-2.0

const LIST_ITEM_TYPES = ['listItem', 'taskItem', 'todoItem']

export type ListItemShortcut = 'sink' | 'lift'

export interface ListItemCommandChecker {
  sinkListItem: (typeOrName: string) => boolean
  liftListItem: (typeOrName: string) => boolean
}

export interface ListItemShortcutEditor {
  isActive: (name: string) => boolean
  can: () => ListItemCommandChecker
}

export function canHandleListItemShortcut (editor: ListItemShortcutEditor, shortcut: ListItemShortcut): boolean {
  const commands = editor.can()

  return LIST_ITEM_TYPES.some((typeOrName) => {
    if (!editor.isActive(typeOrName)) {
      return false
    }

    if (shortcut === 'sink') {
      return commands.sinkListItem(typeOrName)
    }

    return commands.liftListItem(typeOrName)
  })
}
