// SPDX-License-Identifier: EPL-2.0

import core, { ClassifierKind, fillDefaults, Hierarchy, TxFactory } from '@hcengineering/core'
import type { AnyAttribute, Doc, DocData, Mixin, Ref } from '@hcengineering/core'
import type { IntlString } from '@hcengineering/platform'
import task from '@hcengineering/task'
import type { TaskType } from '@hcengineering/task'
import tracker, { IssuePriority } from '@hcengineering/tracker'
import type { Issue, IssueDraft, IssueParentInfo, IssueTemplate, Project } from '@hcengineering/tracker'
import { readFileSync } from 'fs'
import { join } from 'path'
import { compile, preprocess } from 'svelte/compiler'
import ts from 'typescript'
import { runInNewContext } from 'vm'
import { fillIssueDefaults } from '../issue-defaults'
import { saveSubIssues } from '../save-sub-issues'

jest.mock('@hcengineering/presentation', () => ({ createMarkup: jest.fn() }), { virtual: true })
jest.mock('@hcengineering/text', () => ({ isEmptyMarkup: () => true }))

interface SubIssuesMethods {
  save: (parents: IssueParentInfo[], id: Ref<Doc>) => Promise<void>
  load: (drafts: IssueDraft[]) => void
}

/** Compile the real component and bind its public methods without rendering its child components. */
async function loadSubIssues (client: object): Promise<SubIssuesMethods> {
  const filename = join(__dirname, '../components/SubIssues.svelte')
  const source = await preprocess(
    readFileSync(filename, 'utf8'),
    {
      script: ({ content }) => ({
        code: ts.transpileModule(content, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true }
        }).outputText
      }),
      style: () => ({ code: '' })
    },
    { filename }
  )
  const compiled = compile(source.code, { filename, generate: 'ssr' })
  const methods: Partial<SubIssuesMethods> = {}
  const props = { projectId: 'project', project: { _id: 'project', identifier: 'TEST' } }
  const bindings = {
    save: (save: SubIssuesMethods['save']) => {
      methods.save = save
    },
    load: (load: SubIssuesMethods['load']) => {
      methods.load = load
    }
  }
  const modules: Record<string, unknown> = {
    'svelte/internal': {
      create_ssr_component: (render: (result: object, props: object, bindings: object, slots: object) => string) =>
        render({ head: '' }, props, bindings, {}),
      subscribe: (value: unknown, callback: (value: unknown) => void) => {
        callback(value)
        return () => {}
      }
    },
    svelte: { onDestroy: () => {} },
    '@hcengineering/core': jest.requireActual('@hcengineering/core'),
    '@hcengineering/attachment': {},
    '@hcengineering/presentation': {
      getClient: () => client,
      draftsStore: {},
      DraftController: { remove: jest.fn() }
    },
    '@hcengineering/tags': {},
    '@hcengineering/text': { isEmptyMarkup: () => true },
    '@hcengineering/tracker': {},
    '@hcengineering/ui': {},
    '@hcengineering/task': { getTaskTypeStates: () => [] },
    '@hcengineering/task-resources': { taskTypeStore: new Map() },
    '@hcengineering/view-resources': { statusStore: { byId: new Map() } },
    '../plugin': { __esModule: true, default: tracker },
    '../save-sub-issues': { saveSubIssues },
    './icons/Collapsed.svelte': {},
    './icons/Expanded.svelte': {},
    './templates/DraftIssueChildList.svelte': {}
  }
  const code = ts.transpileModule(compiled.js.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  runInNewContext(
    code,
    {
      exports: {},
      require: (name: string) => {
        if (!(name in modules)) throw new Error(`Unexpected component import: ${name}`)
        return modules[name]
      }
    },
    { filename }
  )
  return methods as SubIssuesMethods
}

function createHierarchy (): Hierarchy {
  const hierarchy = new Hierarchy()
  const factory = new TxFactory(core.account.System)
  for (const [_id, parent] of [
    [core.class.Obj, undefined],
    [core.class.Doc, core.class.Obj],
    [core.class.AttachedDoc, core.class.Doc],
    [task.class.Task, core.class.AttachedDoc],
    [tracker.class.Issue, task.class.Task]
  ]) {
    hierarchy.tx(
      factory.createTxCreateDoc(
        core.class.Class,
        core.space.Model,
        { label: 'Test' as IntlString, kind: ClassifierKind.CLASS, extends: parent },
        _id
      )
    )
  }
  return hierarchy
}

function addAttribute (hierarchy: Hierarchy, name: string, options: Partial<AnyAttribute> = {}): void {
  const factory = new TxFactory(core.account.System)
  hierarchy.tx(
    factory.createTxCreateDoc(core.class.Attribute, core.space.Model, {
      name,
      attributeOf: tracker.class.Issue,
      label: name as IntlString,
      type: { _class: core.class.EnumOf },
      isCustom: true,
      defaultValue: 'Open',
      ...options
    })
  )
}

function createDraft (): IssueDraft {
  return {
    _id: 'draft' as Ref<Issue>,
    title: 'Issue',
    description: '<p>Description</p>',
    kind: '' as Ref<TaskType>,
    space: 'project' as Ref<Project>,
    priority: IssuePriority.NoPriority,
    assignee: null,
    component: null,
    milestone: null,
    startDate: null,
    dueDate: null,
    estimation: 0,
    labels: [],
    subIssues: []
  }
}

describe('issue creation defaults', () => {
  it('persists defaults and explicit custom values for sub-issues created in the same dialog', async () => {
    const hierarchy = createHierarchy()
    addAttribute(hierarchy, 'customEnum')
    const explicitChild: IssueDraft & { customEnum: string } = {
      ...createDraft(),
      _id: 'child-explicit' as Ref<Issue>,
      customEnum: 'Closed'
    }
    const subIssues: IssueDraft[] = [{ ...createDraft(), _id: 'child-default' as Ref<Issue> }, explicitChild]
    const parent = { ...createDraft(), subIssues }
    const reloadedParent: IssueDraft = JSON.parse(JSON.stringify(parent))
    const operations = {
      addCollection: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue({ result: true })
    }
    const client = {
      getHierarchy: () => hierarchy,
      updateDoc: jest.fn().mockResolvedValue({ object: { sequence: 2 } }),
      apply: jest.fn(() => operations)
    }
    const component = await loadSubIssues(client)
    const parents: IssueParentInfo[] = [
      {
        parentId: parent._id,
        parentTitle: parent.title,
        space: parent.space,
        identifier: 'TEST-0'
      }
    ]

    component.load(reloadedParent.subIssues)
    await component.save(parents, parent._id)

    expect(operations.addCollection).toHaveBeenCalledTimes(2)
    for (const [index, customEnum] of ['Open', 'Closed'].entries()) {
      expect(operations.addCollection).toHaveBeenNthCalledWith(
        index + 1,
        tracker.class.Issue,
        parent.space,
        parent._id,
        tracker.class.Issue,
        'subIssues',
        expect.objectContaining({ customEnum, description: null, subIssues: 0, parents }),
        subIssues[index]._id
      )
    }
  })

  it('persists a custom enum default for first and subsequent issues after a draft reload', () => {
    const hierarchy = createHierarchy()
    addAttribute(hierarchy, 'customEnum')
    const draft = createDraft()
    fillDefaults(hierarchy, draft, tracker.class.Issue)
    const reloadedDraft: IssueDraft = JSON.parse(JSON.stringify(draft))

    for (let index = 0; index < 2; index++) {
      reloadedDraft.title = `Issue ${index + 1}`
      const value = { title: reloadedDraft.title, description: null, subIssues: 0 } as unknown as DocData<Issue>

      fillIssueDefaults(hierarchy, reloadedDraft, value)

      expect(JSON.parse(JSON.stringify(value))).toMatchObject({ title: `Issue ${index + 1}`, customEnum: 'Open' })
    }
  })

  it('fills defaults missing from the draft and clones mutable defaults for each issue', () => {
    const hierarchy = createHierarchy()
    addAttribute(hierarchy, 'customEnum')
    addAttribute(hierarchy, 'customList', { defaultValue: ['Open'] })
    addAttribute(hierarchy, 'attachments', { isCustom: false, defaultValue: 0 })
    const first = {} as unknown as DocData<Issue>
    const second = {} as unknown as DocData<Issue>

    fillIssueDefaults(hierarchy, createDraft(), first)
    fillIssueDefaults(hierarchy, createDraft(), second)

    expect(first).toEqual({ customEnum: 'Open', customList: ['Open'], attachments: 0 })
    expect(second).toEqual(first)
    expect((first as unknown as Record<string, unknown>).customList).not.toBe(
      (second as unknown as Record<string, unknown>).customList
    )
  })

  it.each(['Closed', '', null, false, 0])('preserves an explicit custom draft value of %p', (customEnum) => {
    const hierarchy = createHierarchy()
    addAttribute(hierarchy, 'customEnum')
    const draft = { ...createDraft(), customEnum }
    const value = {} as unknown as DocData<Issue>

    fillIssueDefaults(hierarchy, draft, value)

    expect(value).toEqual({ customEnum })
  })

  it('copies inherited custom attributes but excludes unknown fields and draft representations of built-in fields', () => {
    const hierarchy = createHierarchy()
    addAttribute(hierarchy, 'customInherited', { attributeOf: task.class.Task })
    addAttribute(hierarchy, 'customEnum', { defaultValue: undefined })
    addAttribute(hierarchy, 'description', { isCustom: false, defaultValue: undefined })
    addAttribute(hierarchy, 'subIssues', { isCustom: false, defaultValue: undefined })
    addAttribute(hierarchy, 'labels', { isCustom: false, defaultValue: undefined })
    const draft = {
      ...createDraft(),
      customEnum: 'Closed',
      customInherited: 'Inherited value',
      unknown: 'discard',
      parentIssue: 'parent' as Ref<Issue>,
      template: { template: 'template' as Ref<IssueTemplate> },
      attachments: 3
    }
    const value = { title: 'Trimmed title', description: null, subIssues: 0 } as unknown as DocData<Issue>

    fillIssueDefaults(hierarchy, draft, value)

    expect(value).toEqual({
      title: 'Trimmed title',
      description: null,
      subIssues: 0,
      customEnum: 'Closed',
      customInherited: 'Inherited value'
    })
  })

  it('keeps task-type mixin fields outside the Issue-class payload', () => {
    const hierarchy = createHierarchy()
    const targetClass = 'test:mixin:TaskType' as Ref<Mixin<Issue>>
    const factory = new TxFactory(core.account.System)
    hierarchy.tx(
      factory.createTxCreateDoc(
        core.class.Mixin,
        core.space.Model,
        { label: 'Task type' as IntlString, kind: ClassifierKind.MIXIN, extends: tracker.class.Issue },
        targetClass
      )
    )
    addAttribute(hierarchy, 'customEnum')
    addAttribute(hierarchy, 'taskTypeEnum', { attributeOf: targetClass })
    addAttribute(hierarchy, 'taskTypeDefault', { attributeOf: targetClass })
    const draft = {
      ...createDraft(),
      [targetClass]: { taskTypeEnum: 'Closed' },
      taskTypeEnum: 'Closed'
    }
    const value = {} as unknown as DocData<Issue>

    fillIssueDefaults(hierarchy, draft, value)

    expect(value).toEqual({ customEnum: 'Open' })
  })

  it('keeps values already set on the persistence payload', () => {
    const hierarchy = createHierarchy()
    addAttribute(hierarchy, 'customEnum')
    const draft = { ...createDraft(), customEnum: 'Draft value' }
    const value = { customEnum: 'Prepared value' } as unknown as DocData<Issue>

    fillIssueDefaults(hierarchy, draft, value)

    expect(value).toEqual({ customEnum: 'Prepared value' })
  })
})
