// SPDX-License-Identifier: EPL-2.0

import { readFileSync } from 'fs'
import { join } from 'path'
import { runInNewContext } from 'vm'
import * as ts from 'typescript'

const source = readFileSync(join(__dirname, '..', 'CreateCandidate.svelte'), 'utf8')
const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)?.[1]
if (script === undefined) throw new Error('Candidate form script not found')
const ast = ts.createSourceFile('candidate.ts', script, ts.ScriptTarget.Latest, true)
const create = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'createCandidate')
if (create === undefined) throw new Error('Candidate creation function not found')
// Execute the complete production action, with the persistence boundary controlled by the test.
const code = ts.transpileModule(`${create.getText(ast)}\nmodule.exports = createCandidate`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText

function createForm (commit: jest.Mock): {
  save: () => Promise<void>
  notify: jest.Mock
  removeDraft: jest.Mock
  dispatch: jest.Mock
  reset: jest.Mock
} {
  const notify = jest.fn()
  const removeDraft = jest.fn()
  const dispatch = jest.fn()
  const reset = jest.fn()
  const ops = { createDoc: jest.fn(), createMixin: jest.fn(), addCollection: jest.fn(), commit }
  const module = { exports: {} }
  runInNewContext(code, {
    module,
    generateId: () => 'talent-id',
    combineName: () => 'Doe,Jane',
    formatName: () => 'Jane Doe',
    object: { firstName: 'Jane', lastName: 'Doe', channels: [], skills: [] },
    avatarEditor: { createAvatar: async () => ({ avatarType: 'color' }) },
    AvatarType: { COLOR: 'color' },
    hierarchy: { findAttribute: () => undefined },
    client: { apply: () => ops, findAll: async () => [] },
    contact: { class: { Person: 'person' }, space: { Contacts: 'contacts' } },
    recruit: { mixin: { Candidate: 'candidate' }, string: { TalentCreated: 'Talent created' } },
    tags: { class: { TagCategory: 'category', TagElement: 'tag' } },
    getCandidateIdentifier: (id: string) => id,
    Analytics: { handleEvent: jest.fn() },
    RecruitEvents: { TalentCreated: 'created' },
    toIdMap: () => new Map(),
    addNotification: notify,
    translate: async (text: string) => text,
    $themeStore: { language: 'en' },
    CandidateCreatedNotification: 'notification-component',
    draftController: { remove: removeDraft },
    dispatch,
    resetObject: reset
  })
  return { save: module.exports as () => Promise<void>, notify, removeDraft, dispatch, reset }
}

describe('CreateCandidate commit result', () => {
  it('keeps the draft and form open without a success notification when the batch is rejected', async () => {
    const { save, notify, removeDraft, dispatch, reset } = createForm(jest.fn().mockResolvedValue({ result: false }))
    await save()
    expect(notify).not.toHaveBeenCalled()
    expect(removeDraft).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
  })

  it('shows the created talent and closes the form only after a successful commit', async () => {
    const { save, notify, removeDraft, dispatch, reset } = createForm(jest.fn().mockResolvedValue({ result: true }))
    await save()
    expect(notify).toHaveBeenCalledWith('Talent created', 'Jane Doe', 'notification-component', { candidateId: 'talent-id' })
    expect(removeDraft).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith('close', 'talent-id')
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('does not show success or discard the draft on a transport error', async () => {
    const { save, notify, removeDraft, dispatch } = createForm(jest.fn().mockRejectedValue(new Error('Disconnected')))
    await expect(save()).rejects.toThrow('Disconnected')
    expect(notify).not.toHaveBeenCalled()
    expect(removeDraft).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })
})
