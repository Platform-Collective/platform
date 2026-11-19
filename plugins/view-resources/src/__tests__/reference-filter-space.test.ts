// SPDX-License-Identifier: EPL-2.0

import core, {
  type AnyAttribute,
  type Class,
  ClassifierKind,
  type Data,
  type Doc,
  Hierarchy,
  MeasureMetricsContext,
  ModelDb,
  type Obj,
  type Ref,
  type Space,
  type Tx,
  TxFactory,
  type WithLookup
} from '@hcengineering/core'
import type { IntlString } from '@hcengineering/platform'
import view, { type KeyFilter, type ReferenceFilterSpace } from '@hcengineering/view'
import {
  compareBySpaceThenLabel,
  filterAndSortBySpace,
  getReferenceFilterSpace,
  getSpaceFilterLabel,
  matchesSpaceFilterSearch
} from '../referenceFilterSpace'

const config = {
  spaceClass: 'test:class:Project' as Ref<Class<Space>>,
  labelKey: 'identifier'
} as unknown as ReferenceFilterSpace

interface Milestone extends Doc {
  label: string
}

function milestone (_id: string, label: string, identifier?: string): WithLookup<Milestone> {
  return {
    _id: _id as Ref<Milestone>,
    label,
    $lookup: identifier !== undefined ? { space: { identifier } } : undefined
  } as unknown as WithLookup<Milestone>
}

describe('reference filter space labels', () => {
  it('reads the label of the looked-up space', () => {
    expect(getSpaceFilterLabel(milestone('m1', 'Sprint 1', 'PROJ'), config)).toBe('PROJ')
    expect(getSpaceFilterLabel(milestone('m2', 'Sprint 1'), config)).toBeUndefined()
    expect(getSpaceFilterLabel(milestone('m3', 'Sprint 1', ''), config)).toBeUndefined()
  })

  it('matches the value label, the space label and the combined form, ignoring case', () => {
    expect(matchesSpaceFilterSearch('Sprint 1', 'PROJ', 'sprint')).toBe(true)
    expect(matchesSpaceFilterSearch('Sprint 1', 'PROJ', 'proj')).toBe(true)
    expect(matchesSpaceFilterSearch('Sprint 1', 'PROJ', 'PROJ · Spr')).toBe(true)
    expect(matchesSpaceFilterSearch('Sprint 1', 'PROJ', 'proj sprint 1')).toBe(true)
    expect(matchesSpaceFilterSearch('Sprint 1', 'PROJ', 'OTHER')).toBe(false)
    expect(matchesSpaceFilterSearch('Sprint 1', undefined, 'PROJ')).toBe(false)
    expect(matchesSpaceFilterSearch('Sprint 1', undefined, '  ')).toBe(true)
  })

  it('orders by space and then by label with numeric label order', () => {
    const rows = [
      { label: 'Sprint 10', spaceLabel: 'BETA' },
      { label: 'Sprint 2', spaceLabel: 'alpha' },
      { label: 'Sprint 10', spaceLabel: 'ALPHA' },
      { label: 'Backlog', spaceLabel: undefined }
    ]
    expect([...rows].sort(compareBySpaceThenLabel)).toEqual([
      { label: 'Backlog', spaceLabel: undefined },
      { label: 'Sprint 2', spaceLabel: 'alpha' },
      { label: 'Sprint 10', spaceLabel: 'ALPHA' },
      { label: 'Sprint 10', spaceLabel: 'BETA' }
    ])
  })

  it('keeps same-named milestones grouped by project and filters by project identifier', () => {
    const values = [
      milestone('b1', 'Sprint 1', 'BETA'),
      milestone('a2', 'Sprint 2', 'ALPHA'),
      milestone('a1', 'Sprint 1', 'ALPHA'),
      milestone('b2', 'Sprint 2', 'BETA')
    ]
    const ids = (list: Milestone[]): string[] => list.map((it) => it._id)
    const label = (value: Milestone): string => value.label

    expect(ids(filterAndSortBySpace(values, config, label, ''))).toEqual(['a1', 'a2', 'b1', 'b2'])
    expect(ids(filterAndSortBySpace(values, config, label, 'beta'))).toEqual(['b1', 'b2'])
    expect(ids(filterAndSortBySpace(values, config, label, 'Sprint 1'))).toEqual(['a1', 'b1'])
  })
})

describe('getReferenceFilterSpace', () => {
  const issueClass = 'test:class:Issue' as Ref<Class<Doc>>
  const subIssueClass = 'test:class:SubIssue' as Ref<Class<Doc>>
  const issueMixin = 'test:mixin:IssueMixin' as Ref<Class<Doc>>
  const otherClass = 'test:class:Other' as Ref<Class<Doc>>
  const milestoneAttr = `${issueClass}_milestone` as Ref<AnyAttribute>
  const otherAttr = `${otherClass}_milestone` as Ref<AnyAttribute>

  let hierarchy: Hierarchy
  let model: ModelDb

  beforeEach(() => {
    const factory = new TxFactory(core.account.System)
    const createClass = (_id: Ref<Class<Obj>>, data: Partial<Data<Class<Obj>>>): Tx =>
      factory.createTxCreateDoc(
        core.class.Class,
        core.space.Model,
        { label: _id as unknown as IntlString, kind: ClassifierKind.CLASS, ...data },
        _id
      )
    const createAttribute = (_id: Ref<AnyAttribute>, attributeOf: Ref<Class<Doc>>): Tx =>
      factory.createTxCreateDoc(
        core.class.Attribute,
        core.space.Model,
        {
          attributeOf,
          name: 'milestone',
          label: 'Milestone' as IntlString,
          type: { _class: core.class.RefTo, label: 'Milestone' as IntlString, to: 'test:class:Milestone' }
        },
        _id
      )
    // Attribute has an index signature that hides mixin fields from MixinUpdate, so type them here.
    const mixinData: Pick<ReferenceFilterSpace, 'spaceClass' | 'labelKey'> = {
      spaceClass: config.spaceClass,
      labelKey: 'identifier'
    }
    const txes: Tx[] = [
      createClass(core.class.Obj, {}),
      createClass(core.class.Doc, { extends: core.class.Obj }),
      createClass(core.class.Class, { extends: core.class.Doc }),
      createClass(core.class.Attribute, { extends: core.class.Doc }),
      createClass(view.mixin.ReferenceFilterSpace, {
        extends: core.class.Attribute,
        kind: ClassifierKind.MIXIN
      }),
      createClass(issueClass, { extends: core.class.Doc }),
      createClass(subIssueClass, { extends: issueClass }),
      createClass(issueMixin, { extends: issueClass, kind: ClassifierKind.MIXIN }),
      createClass(otherClass, { extends: core.class.Doc }),
      createAttribute(milestoneAttr, issueClass),
      createAttribute(otherAttr, otherClass),
      factory.createTxMixin(
        milestoneAttr,
        core.class.Attribute,
        core.space.Model,
        view.mixin.ReferenceFilterSpace,
        mixinData
      )
    ]
    hierarchy = new Hierarchy()
    model = new ModelDb(hierarchy)
    model.addTxes(new MeasureMetricsContext('test', {}), txes, false)
  })

  function key (_class: Ref<Class<Doc>>, attribute?: AnyAttribute): KeyFilter {
    return {
      _class,
      key: 'milestone',
      attribute: attribute ?? hierarchy.getAttribute(issueClass, 'milestone')
    } as unknown as KeyFilter
  }

  it('reads the mixin the model applied to the attribute', () => {
    const result = getReferenceFilterSpace(hierarchy, model, key(issueClass), undefined)
    expect(result?.spaceClass).toBe(config.spaceClass)
    expect(result?.labelKey).toBe('identifier')
  })

  it.each([
    ['a subclass', subIssueClass],
    ['a mixin', issueMixin]
  ])('applies to filters on %s of the attribute class', (_, _class) => {
    expect(getReferenceFilterSpace(hierarchy, model, key(_class), undefined)?.labelKey).toBe('identifier')
  })

  it('uses the live attribute rather than the copy stored with a saved filter', () => {
    const stored = { _id: milestoneAttr, _class: core.class.Attribute } as unknown as AnyAttribute
    expect(getReferenceFilterSpace(hierarchy, model, key(issueClass, stored), undefined)?.labelKey).toBe('identifier')
  })

  it('does nothing inside a single space', () => {
    expect(getReferenceFilterSpace(hierarchy, model, key(issueClass), 'space' as Ref<Space>)).toBeUndefined()
  })

  it('does nothing for attributes without the mixin', () => {
    const other = hierarchy.getAttribute(otherClass, 'milestone')
    expect(getReferenceFilterSpace(hierarchy, model, key(otherClass, other), undefined)).toBeUndefined()
  })
})
