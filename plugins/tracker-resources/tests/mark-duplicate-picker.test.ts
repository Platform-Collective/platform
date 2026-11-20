// SPDX-License-Identifier: EPL-2.0

import { readFileSync } from 'fs'
import { join } from 'path'
import { runInNewContext } from 'vm'
import { compile, preprocess } from 'svelte/compiler'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

it('excludes every canceled status in the picker query, including spotlight results', async () => {
  const filename = join(__dirname, '../src/components/MarkIssueDuplicatePopup.svelte')
  const source = await preprocess(readFileSync(filename, 'utf8'), {
    script: ({ content }) => ({
      code: transpileModule(content, {
        compilerOptions: { target: ScriptTarget.ESNext, module: ModuleKind.ESNext, verbatimModuleSyntax: true }
      }).outputText
    })
  })
  const code = transpileModule(compile(source.code, { filename, generate: 'ssr' }).js.code, {
    compilerOptions: { module: ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText
  let props: Record<string, unknown> | undefined
  const statusQuery = jest.fn(
    (_class: unknown, _query: unknown, callback: (statuses: Array<{ _id: string }>) => void) => {
      callback([{ _id: 'canceled-a' }, { _id: 'canceled-b' }])
    }
  )
  const dependencies: Record<string, unknown> = {
    'svelte/internal': {
      create_ssr_component: (render: unknown) => render,
      validate_component: () => ({
        $$render: (_result: unknown, value: Record<string, unknown>) => {
          props = value
          return ''
        }
      })
    },
    svelte: { createEventDispatcher: jest.fn() },
    '@hcengineering/core': {
      class: { Status: 'Status', StatusCategory: 'StatusCategory' },
      SortingOrder: { Descending: -1 }
    },
    '@hcengineering/task': { statusCategory: { Lost: 'Lost' } },
    '@hcengineering/tracker': {},
    '@hcengineering/platform': { setPlatformStatus: jest.fn(), unknownError: jest.fn() },
    '@hcengineering/presentation': { ObjectPopup: {}, createQuery: () => ({ query: statusQuery }) },
    '../duplicate-issue': { markIssueDuplicate: jest.fn() },
    '../plugin': {
      class: { Issue: 'Issue', IssueStatus: 'IssueStatus' },
      completion: { IssueCategory: 'IssueCategory' },
      string: { MarkAsDuplicate: 'MarkAsDuplicate' }
    },
    './issues/IssueStatusIcon.svelte': {}
  }
  const exports = { default: (_result: object, _props: object, _bindings: object, _slots: object) => '' }
  runInNewContext(code, {
    exports,
    require: (id: string) => {
      if (!(id in dependencies)) throw new Error(`Unexpected component dependency: ${id}`)
      return dependencies[id]
    }
  })
  exports.default({}, { value: { _id: 'source' } }, {}, {})
  expect(statusQuery).toHaveBeenCalledWith('Status', { category: 'Lost' }, expect.any(Function))
  expect(props?.docQuery).toEqual({ status: { $nin: ['canceled-a', 'canceled-b'] } })
  expect(props?.ignoreObjects).toEqual(['source'])
  expect(props?.searchMode).toBe('spotlight')
})
