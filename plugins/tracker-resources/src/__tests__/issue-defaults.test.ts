// SPDX-License-Identifier: EPL-2.0

import core, { ClassifierKind, fillDefaults, Hierarchy, TxFactory } from '@hcengineering/core'
import type { AnyAttribute, DocData, Ref } from '@hcengineering/core'
import type { IntlString } from '@hcengineering/platform'
import task from '@hcengineering/task'
import type { TaskType } from '@hcengineering/task'
import tracker, { IssuePriority } from '@hcengineering/tracker'
import type { Issue, IssueDraft, IssueTemplate, Project } from '@hcengineering/tracker'
import { fillIssueDefaults } from '../issue-defaults'

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
  it('persists a custom enum default for first and subsequent issues after a draft reload', () => {
    for (let index = 0; index < 2; index++) {
      const hierarchy = createHierarchy()
      addAttribute(hierarchy, 'customEnum')
      const draft = createDraft()
      fillDefaults(hierarchy, draft, tracker.class.Issue)
      const reloadedDraft: IssueDraft = JSON.parse(JSON.stringify(draft))
      const value = { title: draft.title, description: null, subIssues: 0 } as unknown as DocData<Issue>

      fillIssueDefaults(hierarchy, reloadedDraft, value)

      expect(JSON.parse(JSON.stringify(value))).toMatchObject({ customEnum: 'Open' })
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

  it('keeps values already set on the persistence payload', () => {
    const hierarchy = createHierarchy()
    addAttribute(hierarchy, 'customEnum')
    const draft = { ...createDraft(), customEnum: 'Draft value' }
    const value = { customEnum: 'Prepared value' } as unknown as DocData<Issue>

    fillIssueDefaults(hierarchy, draft, value)

    expect(value).toEqual({ customEnum: 'Prepared value' })
  })
})
