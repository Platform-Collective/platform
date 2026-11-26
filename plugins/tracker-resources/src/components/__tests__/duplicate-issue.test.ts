// SPDX-License-Identifier: EPL-2.0

import core, { ClassifierKind, Hierarchy, TxFactory } from '@hcengineering/core'
import type { Class, Doc, Ref } from '@hcengineering/core'
import type { IntlString } from '@hcengineering/platform'
import type { TaskType } from '@hcengineering/task'
import type { Issue } from '@hcengineering/tracker'
import { getDuplicateIssueCustomFields } from '../duplicate-issue'

const issueClass = 'test:class:Issue' as Ref<Class<Issue>>
const taskMixin = 'test:mixin:Task' as Ref<Class<Doc>>
const integrationMixin = 'test:mixin:Integration' as Ref<Class<Doc>>
const taskKind = 'test:task:Kind' as Ref<TaskType>

function createHierarchy (): Hierarchy {
  const hierarchy = new Hierarchy()
  const factory = new TxFactory(core.account.System)
  for (const [_id, kind, parent] of [
    [core.class.Doc, ClassifierKind.CLASS, undefined],
    [issueClass, ClassifierKind.CLASS, core.class.Doc],
    [taskMixin, ClassifierKind.MIXIN, issueClass],
    [integrationMixin, ClassifierKind.MIXIN, issueClass]
  ] as const) {
    hierarchy.tx(
      factory.createTxCreateDoc(
        core.class.Class,
        core.space.Model,
        { kind, extends: parent, label: _id as unknown as IntlString },
        _id
      )
    )
  }
  for (const [attributeOf, name, isCustom] of [
    [core.class.Doc, 'inherited', true],
    [issueClass, 'customer', true],
    [issueClass, 'title', false],
    [issueClass, 'number', false],
    [taskMixin, 'severity', true],
    [taskMixin, 'enabled', true],
    [taskMixin, 'count', true],
    [taskMixin, 'empty', true],
    [taskMixin, 'nullable', true],
    [taskMixin, 'unset', true],
    [taskMixin, 'system', false],
    [integrationMixin, 'url', false]
  ] as const) {
    hierarchy.tx(
      factory.createTxCreateDoc(core.class.Attribute, core.space.Model, {
        attributeOf,
        name,
        isCustom,
        label: name as IntlString,
        type: { _class: core.class.TypeString }
      })
    )
  }
  return hierarchy
}

function createOriginalIssue (): Issue {
  return {
    _id: 'test:issue:Original',
    _class: issueClass,
    kind: taskKind,
    title: 'Original issue',
    number: 42,
    inherited: 'inherited value',
    customer: 'Acme',
    [taskMixin]: { severity: 'High', enabled: false, count: 0, empty: '', nullable: null, system: 'internal' },
    [integrationMixin]: { url: 'https://example.com/original' }
  } as unknown as Issue
}

describe('duplicate issue custom fields', () => {
  it('copies populated custom fields on the issue and its task kind mixin', () => {
    const original = createOriginalIssue()
    const result = getDuplicateIssueCustomFields(createHierarchy(), original, taskKind)

    expect(result.attributes).toEqual({ inherited: 'inherited value', customer: 'Acme' })
    expect(result.mixins.get(taskMixin)).toEqual({
      severity: 'High',
      enabled: false,
      count: 0,
      empty: '',
      nullable: null
    })
    expect(result.mixins.size).toBe(1)
    expect(original).toEqual(createOriginalIssue())
  })

  it('does not copy fields from the old task kind after selecting another kind', () => {
    const result = getDuplicateIssueCustomFields(
      createHierarchy(),
      createOriginalIssue(),
      'test:task:OtherKind' as Ref<TaskType>
    )

    expect(result.attributes).toEqual({})
    expect(result.mixins.size).toBe(0)
  })

  it('leaves ordinary creation and reset forms without duplicate fields', () => {
    const result = getDuplicateIssueCustomFields(createHierarchy())

    expect(result.attributes).toEqual({})
    expect(result.mixins.size).toBe(0)
  })

  it('does not create mixins for custom fields absent from the original issue', () => {
    const original = { _class: issueClass, kind: taskKind, [taskMixin]: { system: 'internal' } } as unknown as Issue
    const result = getDuplicateIssueCustomFields(createHierarchy(), original)

    expect(result.attributes).toEqual({})
    expect(result.mixins.size).toBe(0)
  })
})
