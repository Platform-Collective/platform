// SPDX-License-Identifier: EPL-2.0

import { readFileSync } from 'fs'
import { join } from 'path'
import { runInNewContext } from 'vm'
import { compile, preprocess } from 'svelte/compiler'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

interface HeaderAction {
  id: string
  callback: () => void
  draft?: boolean
  keyBindingPromise?: Promise<string[]>
}

interface HeaderProps {
  mainActionId: string
  visibleActions: string[]
  actions: HeaderAction[]
}

interface HeaderRenderResult {
  header: HeaderProps
  showPopup: jest.Mock
  handleEvent: jest.Mock
  keyBinding: string[]
}

let componentCode: string

beforeAll(async () => {
  const filename = join(__dirname, '../NewIssueHeader.svelte')
  const source = await preprocess(readFileSync(filename, 'utf8'), {
    script: ({ content }) => ({
      code: transpileModule(content, {
        compilerOptions: { target: ScriptTarget.ESNext, module: ModuleKind.ESNext, verbatimModuleSyntax: true }
      }).outputText
    })
  })
  componentCode = transpileModule(compile(source.code, { filename, generate: 'ssr' }).js.code, {
    compilerOptions: { module: ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText
})

function renderHeader (projectExists = true, draftExists = false): HeaderRenderResult {
  let header: HeaderProps | undefined
  const showPopup = jest.fn()
  const handleEvent = jest.fn()
  const keyBinding = ['keyC']
  const strings = {
    CreateProject: 'CreateProject',
    NewIssue: 'NewIssue',
    ResumeDraft: 'ResumeDraft',
    Import: 'Import'
  }
  const dependencies: Record<string, unknown> = {
    // Capture the rendered HeaderButton props without loading the application's UI dependencies.
    'svelte/internal': {
      create_ssr_component: (render: unknown) => render,
      validate_component: () => ({
        $$render: (_result: unknown, props: HeaderProps) => {
          header = props
          return ''
        }
      })
    },
    svelte: { onDestroy: jest.fn() },
    '@hcengineering/analytics': { Analytics: { handleEvent } },
    '@hcengineering/core': { AccountRole: { User: 'User' } },
    '@hcengineering/presentation': {
      MultipleDraftController: class {
        hasNext (callback: (exists: boolean) => void) {
          callback(draftExists)
          return () => {}
        }
      },
      createQuery: () => ({
        query: (_class: unknown, _query: unknown, onProjects: (projects: object[]) => void) => {
          onProjects(projectExists ? [{}] : [])
        }
      }),
      getClient: () => ({ findOne: async () => ({ keyBinding }) })
    },
    '@hcengineering/tracker': { TrackerEvents: { NewIssueButtonClicked: 'NewIssueButtonClicked' } },
    '@hcengineering/ui': { HeaderButton: {}, showPopup },
    '@hcengineering/view': { class: { Action: 'Action' } },
    '../plugin': {
      string: strings,
      ids: { IssueDraft: 'IssueDraft' },
      action: { NewIssue: 'NewIssue' },
      class: { Project: 'Project' },
      component: { CreateProject: 'CreateProject' }
    },
    './CreateIssue.svelte': 'CreateIssue'
  }
  const exports = {
    default: (_result: object, _props: object, _bindings: object, _slots: object) => ''
  }
  runInNewContext(componentCode, {
    exports,
    require: (id: string) => {
      if (!(id in dependencies)) throw new Error(`Unexpected component dependency: ${id}`)
      return dependencies[id]
    }
  })
  exports.default({}, { currentSpace: 'project-1' }, {}, {})
  if (header === undefined) throw new Error('HeaderButton was not rendered')
  return { header, showPopup, handleEvent, keyBinding }
}

describe('NewIssueHeader actions', () => {
  it.each([false, true])('does not expose Import when draftExists=%s', (draftExists) => {
    const { header, showPopup } = renderHeader(true, draftExists)
    expect(header.visibleActions).not.toContain('Import')
    expect(header.actions.map(({ id }) => id)).not.toContain('Import')
    expect(showPopup).not.toHaveBeenCalled()
  })

  it.each([false, true])('preserves issue creation when draftExists=%s', async (draftExists) => {
    const { header, showPopup, handleEvent, keyBinding } = renderHeader(true, draftExists)
    const actionId = draftExists ? 'ResumeDraft' : 'NewIssue'
    expect(header.mainActionId).toBe(actionId)
    expect(header.visibleActions).toEqual(['CreateProject', actionId])
    const action = header.actions.find(({ id }) => id === actionId)
    expect(action).toBeDefined()
    if (action === undefined) throw new Error(`Missing action: ${actionId}`)
    await expect(action.keyBindingPromise).resolves.toEqual(keyBinding)
    if (draftExists) expect(action.draft).toBe(true)
    action.callback()
    expect(handleEvent).toHaveBeenCalledWith('NewIssueButtonClicked')
    expect(showPopup).toHaveBeenCalledWith(
      'CreateIssue',
      { space: 'project-1', shouldSaveDraft: true },
      'top',
      expect.any(Function)
    )
  })

  it('preserves project creation when there are no projects', () => {
    const { header, showPopup } = renderHeader(false)
    expect(header.visibleActions).toEqual(['CreateProject'])
    header.actions.find(({ id }) => id === 'CreateProject')?.callback()
    expect(showPopup).toHaveBeenCalledWith('CreateProject', {}, 'top', expect.any(Function))
  })
})
