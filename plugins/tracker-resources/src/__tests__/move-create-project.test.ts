// SPDX-License-Identifier: EPL-2.0

import { readFileSync } from 'fs'
import { join } from 'path'
import { runInNewContext } from 'vm'
import { compile, preprocess } from 'svelte/compiler'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

let componentCode: string
beforeAll(async () => {
  const filename = join(__dirname, '../components/issues/Move.svelte')
  const processed = await preprocess(readFileSync(filename, 'utf8'), {
    script: ({ content }) => ({
      code: transpileModule(content, {
        compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext, verbatimModuleSyntax: true }
      }).outputText
    })
  })
  componentCode = transpileModule(compile(processed.code, { filename, generate: 'ssr' }).js.code, {
    compilerOptions: { module: ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText
})

/** Render the real dialog while capturing the existing SpaceSelector boundary. */
function renderMove (allowed: boolean | Error): {
  selector:
    | { create?: { component: string, label: string, props?: { fixedProjectType: string } }, space: string }
    | undefined
  handleError: jest.Mock
} {
  let selector:
    | { create?: { component: string, label: string, props?: { fixedProjectType: string } }, space: string }
    | undefined
  const project = { _id: 'origin', _class: 'Project', type: 'workflow' }
  const store = (value: unknown) => ({
    subscribe: (publish: (v: unknown) => void) => {
      publish(value)
      return (): void => {}
    }
  })
  const handleError = jest.fn()
  const dependencies: Record<string, unknown> = {
    'svelte/internal': {
      create_ssr_component: (render: unknown) => render,
      subscribe: (store: { subscribe: (fn: unknown) => unknown }, fn: unknown) => store.subscribe(fn),
      escape: String,
      validate_component: (component: string) => ({
        $$render: (result: unknown, props: typeof selector, bindings: unknown, slots: Record<string, () => string>) => {
          if (component === 'SpaceSelector') selector = props
          return component === 'Card' ? (slots.default?.() ?? '') : ''
        }
      })
    },
    svelte: { createEventDispatcher: () => jest.fn(), onMount: (callback: () => void) => { callback(); } },
    '@hcengineering/analytics': { Analytics: { handleError } },
    '@hcengineering/core': {},
    '@hcengineering/platform': { setPlatformStatus: jest.fn(), unknownError: jest.fn() },
    '@hcengineering/presentation': {
      Card: 'Card',
      SpaceSelector: 'SpaceSelector',
      getClient: () => ({ getHierarchy: () => ({ getClass: () => ({ label: 'Project' }) }) }),
      createQuery: () => ({
        query: (clazz: string, query: unknown, publish: (res: object[]) => void) => {
          publish(clazz === 'Project' ? [project] : [])
        }
      })
    },
    '@hcengineering/task-resources': { taskTypeStore: store(new Map()), typeStore: store(new Map()) },
    '@hcengineering/tracker': {},
    '@hcengineering/ui': { Button: 'Button', Label: 'Label' },
    '@hcengineering/view': { string: { Move: 'Move' } },
    '@hcengineering/view-resources': { statusStore: store({ byId: new Map() }) },
    '../../component': { componentStore: store(new Map()) },
    '../../plugin': {
      class: { Project: 'Project', Component: 'Component', Milestone: 'Milestone' },
      component: { CreateProject: 'CreateProject' },
      string: { CreateNewProject: 'CreateNewProject' },
      icon: { Home: 'Home' }
    },
    '../../projectPermissions': {
      canCreateProject: () => ({
        then: (publish: (v: boolean) => void) => {
          if (!(allowed instanceof Error)) publish(allowed)
          return {
            catch: (fail: (e: Error) => void) => {
              if (allowed instanceof Error) fail(allowed)
            }
          }
        }
      })
    },
    '../../moveMapping': {},
    '../../utils': { collectIssues: async () => [] }
  }
  const exports = { default: (_result: object, _props: object, _bindings: object, _slots: object) => '' }
  runInNewContext(componentCode, {
    exports,
    require: (id: string) => {
      if (id in dependencies) return dependencies[id]
      if (id.endsWith('.svelte')) return id
      throw new Error(`Unexpected dependency: ${id}`)
    }
  })
  exports.default({}, { selected: { _id: 'issue', space: 'origin' } }, {}, {})
  return { selector, handleError }
}

it('offers the existing project creation dialog from the move project selector to employees', () => {
  const { selector } = renderMove(true)
  expect(selector?.create).toEqual({
    component: 'CreateProject',
    label: 'CreateNewProject',
    props: { fixedProjectType: 'workflow' }
  })
  expect(selector?.space).toBe('origin')
})
it('keeps the current target and offers no project creation to users without creation rights', () => {
  const { selector } = renderMove(false)
  expect(selector).toBeDefined()
  expect(selector?.create).toBeUndefined()
  expect(selector?.space).toBe('origin')
})
it('fails closed if the permission lookup fails', () => {
  const failure = new Error('permission lookup failed')
  const { selector, handleError } = renderMove(failure)
  expect(selector?.create).toBeUndefined()
  expect(handleError).toHaveBeenCalledWith(failure)
})
