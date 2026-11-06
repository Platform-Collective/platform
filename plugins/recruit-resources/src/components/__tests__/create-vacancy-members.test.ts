// SPDX-License-Identifier: EPL-2.0

import { readFileSync } from 'fs'
import { join } from 'path'
import { runInNewContext } from 'vm'
import * as ts from 'typescript'

interface VacancyForm {
  onChange: (members: string[]) => void
  createVacancy: () => Promise<void>
  setDefaultMembers: (type: { members: string[] }) => void
}

const source = readFileSync(join(__dirname, '..', 'CreateVacancy.svelte'), 'utf8')
const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)?.[1]
const editor = source.match(/<AccountArrayEditor\s[\s\S]*?\/>/)?.[0]
if (script === undefined || editor === undefined) {
  throw new Error('Vacancy form script or members editor not found')
}

// Parse the real editor callback as JSX so the test executes the markup handler,
// including on the old component where the callback discards its argument.
const editorAst = ts.createSourceFile(
  'members-editor.tsx',
  `const editor = ${editor}`,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
let onChange: string | undefined
function findOnChange (node: ts.Node): void {
  if (ts.isJsxAttribute(node) && node.name.getText(editorAst) === 'onChange') {
    const initializer = node.initializer
    if (initializer !== undefined && ts.isJsxExpression(initializer)) {
      onChange = initializer.expression?.getText(editorAst)
    }
  }
  ts.forEachChild(node, findOnChange)
}
findOnChange(editorAst)
if (onChange === undefined) {
  throw new Error('Members editor onChange callback not found')
}

// Execute the production instance script and markup callback in the same scope.
// Supply Svelte's auto-declared reactive variable and expose only the form actions.
const code = ts.transpileModule(
  `let typeType\n${script}\n
   name = 'Member regression'
   descriptionBox = { createAttachments: async () => {} }
   module.exports = { onChange: ${onChange}, createVacancy, setDefaultMembers }`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }
).outputText

function createForm (defaultMembers?: string[]): { form: VacancyForm, createDoc: jest.Mock } {
  const createDoc = jest.fn().mockResolvedValue('vacancy-id')
  const client = {
    getHierarchy: jest.fn().mockReturnValue({}),
    findOne: jest.fn().mockResolvedValue({ _id: 'sequence-id' }),
    update: jest.fn().mockResolvedValue({ object: { sequence: 1 } }),
    apply: jest.fn().mockReturnValue({ createDoc, commit: jest.fn().mockResolvedValue(undefined) }),
    createMixin: jest.fn().mockResolvedValue(undefined)
  }
  const modules: Record<string, unknown> = {
    '@hcengineering/core': {
      __esModule: true,
      default: { class: { Sequence: 'sequence', Role: 'role' }, space: { Space: 'space' } },
      getCurrentAccount: () => ({ uuid: 'creator', primarySocialId: 'creator-social-id' }),
      generateId: () => 'vacancy-id',
      fillDefaults: jest.fn(),
      SortingOrder: { Ascending: 1 }
    },
    '@hcengineering/presentation': {
      getClient: () => client,
      createQuery: () => ({ query: jest.fn(), unsubscribe: jest.fn() })
    },
    '@hcengineering/task': { __esModule: true, default: { class: { ProjectType: 'project-type' } } },
    '@hcengineering/tracker': { __esModule: true, default: { class: { IssueTemplate: 'issue-template' } } },
    '@hcengineering/tags': { __esModule: true, default: {} },
    '@hcengineering/recruit': { RecruitEvents: { VacancyCreated: 'vacancy-created' } },
    '@hcengineering/ui': { createFocusManager: jest.fn() },
    '@hcengineering/analytics': { Analytics: { handleEvent: jest.fn() } },
    '@hcengineering/text': { isEmptyMarkup: () => true },
    '../plugin': { __esModule: true, default: { class: { Vacancy: 'vacancy' } } },
    '../utils': { getSequenceId: () => 'VAC-1' },
    svelte: { createEventDispatcher: () => jest.fn() }
  }
  const module = { exports: {} }
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: (id: string) => {
      if (!(id in modules)) throw new Error(`Unexpected form dependency: ${id}`)
      return modules[id]
    },
    $selectedTypeStore: 'vacancy-type',
    $typeStore: new Map([['vacancy-type', { members: defaultMembers, targetClass: 'vacancy-mixin' }]])
  })
  return { form: module.exports as VacancyForm, createDoc }
}

describe('CreateVacancy members', () => {
  it.each<[string, string[]]>([
    ['added members', ['creator', 'peer']],
    ['removed creator', ['peer']],
    ['empty selection', []]
  ])('persists %s from the members editor callback', async (_label, members) => {
    const { form, createDoc } = createForm()

    form.onChange(members)
    await form.createVacancy()

    expect(createDoc).toHaveBeenCalledWith(
      'vacancy',
      'space',
      expect.objectContaining({ members, owners: ['creator'] }),
      'vacancy-id'
    )
  })

  it('persists the latest selection after multiple changes', async () => {
    const { form, createDoc } = createForm()

    form.onChange(['creator', 'peer'])
    form.onChange(['other-peer'])
    await form.createVacancy()

    expect(createDoc.mock.calls[0][2].members).toEqual(['other-peer'])
  })

  it.each<[string[]]>([[['peer']], [[]]])(
    'does not replace explicit selection %j with template defaults',
    async (members) => {
      const { form, createDoc } = createForm(['template-member'])

      form.onChange(members)
      form.setDefaultMembers({ members: ['other-template-member'] })
      await form.createVacancy()

      expect(createDoc.mock.calls[0][2].members).toEqual(members)
    }
  )

  it.each<[string[] | undefined, string[]]>([
    [undefined, ['creator']],
    [[], ['creator']],
    [['template-member'], ['template-member']]
  ])('keeps defaults %j when members are untouched', async (defaults, expected) => {
    const { form, createDoc } = createForm(defaults)

    await form.createVacancy()

    expect(createDoc.mock.calls[0][2].members).toEqual(expected)
  })
})
