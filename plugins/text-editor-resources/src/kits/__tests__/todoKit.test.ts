// SPDX-License-Identifier: EPL-2.0

import { readFileSync } from 'fs'
import { join } from 'path'

const repoRoot = join(__dirname, '../../../../..')
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8')

const EDITOR_KIT = 'plugins/text-editor-resources/src/kits/editor-kit.ts'
const CREATE_ISSUE = 'plugins/tracker-resources/src/components/CreateIssue.svelte'

describe('todo lists in the new issue description', () => {
  it('keeps todo lists disabled by default in compact editors', () => {
    const editorKit = read(EDITOR_KIT)

    expect(editorKit).toMatch(/todoItem:\s*e\(TodoItemExtension, context\.mode === 'full'/)
    expect(editorKit).toMatch(/todoList:\s*e\(TodoListExtension, context\.mode === 'full'/)
  })

  it('enables todo nodes for the compact create issue editor', () => {
    const createIssue = read(CREATE_ISSUE)

    expect(createIssue).toMatch(
      /kitOptions=\{\{\s*reference:\s*true,\s*lists:\s*\{\s*todoItem:\s*true,\s*todoList:\s*true,?\s*}\s*}}/
    )
  })
})
