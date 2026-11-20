// SPDX-License-Identifier: EPL-2.0

import core, { ClassifierKind, Hierarchy, TxFactory } from '@hcengineering/core'
import type { AnyAttribute, Class, Doc, Mixin, Ref } from '@hcengineering/core'
import type { IntlString } from '@hcengineering/platform'
import type { TaskType } from '@hcengineering/task'
import { EmptyMarkup } from '@hcengineering/text'
import tracker from '@hcengineering/tracker'
import {
  fillCreateIssueAttributeDefaults,
  getUntouchedCreateIssueDraft,
  getCreateIssueAttributes,
  getCreateIssueAttributeValues,
  isRequiredAttributeFilled,
  removeChangedTaskTypeValues,
  setCreateIssueAttributeValue,
  setCreateIssueMixinValues
} from '../create-issue-attributes'

// Use the real shared required-value check without loading the whole presentation package
jest.mock('@hcengineering/presentation', () =>
  jest.requireActual('../../../../packages/presentation/src/required-value')
)

const issueType = 'test:mixin:IssueType' as Ref<Mixin<Doc>>
const otherIssueType = 'test:mixin:OtherIssueType' as Ref<Mixin<Doc>>

function createHierarchy (): Hierarchy {
  const hierarchy = new Hierarchy()
  const factory = new TxFactory(core.account.System)
  for (const [_id, parent, kind] of [
    [core.class.Obj, undefined, ClassifierKind.CLASS],
    [core.class.Doc, core.class.Obj, ClassifierKind.CLASS],
    [core.class.AttachedDoc, core.class.Doc, ClassifierKind.CLASS],
    [tracker.class.Issue, core.class.AttachedDoc, ClassifierKind.CLASS],
    [core.class.TypeString, core.class.Obj, ClassifierKind.CLASS],
    [core.class.TypeMarkup, core.class.Obj, ClassifierKind.CLASS],
    [core.class.Collection, core.class.Obj, ClassifierKind.CLASS],
    [issueType, tracker.class.Issue, ClassifierKind.MIXIN],
    [otherIssueType, tracker.class.Issue, ClassifierKind.MIXIN]
  ] as Array<[Ref<Class<Doc>>, Ref<Class<Doc>> | undefined, ClassifierKind]>) {
    hierarchy.tx(
      factory.createTxCreateDoc(
        kind === ClassifierKind.MIXIN ? core.class.Mixin : core.class.Class,
        core.space.Model,
        { label: 'Test' as IntlString, kind, extends: parent },
        _id
      )
    )
  }
  return hierarchy
}

function attributeType (_class: AnyAttribute['type']['_class']): AnyAttribute['type'] {
  const result: AnyAttribute['type'] = { _class, label: 'Test' as IntlString }
  return result
}

function addAttribute (
  hierarchy: Hierarchy,
  attributeOf: Ref<Class<Doc>>,
  name: string,
  options: Partial<AnyAttribute> = {}
): void {
  const factory = new TxFactory(core.account.System)
  hierarchy.tx(
    factory.createTxCreateDoc(core.class.Attribute, core.space.Model, {
      name,
      attributeOf,
      label: name as IntlString,
      type: attributeType(core.class.TypeString),
      isCustom: true,
      ...options
    })
  )
}

function createTaskType (targetClass: Ref<Mixin<Doc>>): Pick<TaskType, 'targetClass'> {
  const result: Pick<TaskType, 'targetClass'> = { targetClass }
  return result
}

describe('new issue task type attributes', () => {
  it('shows editable custom Issue and selected task type attributes', () => {
    const hierarchy = createHierarchy()
    addAttribute(hierarchy, tracker.class.Issue, 'issueCustom')
    addAttribute(hierarchy, tracker.class.Issue, 'title', { isCustom: false })
    addAttribute(hierarchy, issueType, 'typeCustom')
    addAttribute(hierarchy, issueType, 'hidden', { hidden: true })
    addAttribute(hierarchy, issueType, 'readonly', { readonly: true })
    addAttribute(hierarchy, issueType, 'collection', { type: attributeType(core.class.Collection) })
    addAttribute(hierarchy, otherIssueType, 'otherTypeCustom')

    const attributes = getCreateIssueAttributes(hierarchy, createTaskType(issueType))

    expect(attributes.map((attribute) => attribute.key)).toEqual(['issueCustom', 'typeCustom'])
    expect(attributes[1]._class).toBe(issueType)
  })

  it('validates required values by attribute type and accepts defaults', () => {
    const hierarchy = createHierarchy()
    addAttribute(hierarchy, issueType, 'text', { required: true })
    addAttribute(hierarchy, issueType, 'markup', { required: true, type: attributeType(core.class.TypeMarkup) })
    addAttribute(hierarchy, issueType, 'list', { required: true })
    addAttribute(hierarchy, issueType, 'count', { required: true })
    addAttribute(hierarchy, issueType, 'enabled', { required: true })
    addAttribute(hierarchy, issueType, 'withDefault', { required: true, defaultValue: 'default' })
    const attributes = getCreateIssueAttributes(hierarchy, createTaskType(issueType))
    const values = { text: '  ', markup: EmptyMarkup, list: [], count: 0, enabled: false }
    const draft = { [issueType]: values }
    const withValue = (key: string, value: unknown): Record<string, unknown> => ({
      [issueType]: { ...values, [key]: value }
    })

    expect(
      attributes.filter((attribute) => !isRequiredAttributeFilled(attribute, draft)).map((attribute) => attribute.key)
    ).toEqual(['text', 'markup', 'list'])
    expect(isRequiredAttributeFilled(attributes[0], withValue('text', 'value'))).toBe(true)
    expect(isRequiredAttributeFilled(attributes[1], withValue('markup', '<p>value</p>'))).toBe(true)
    expect(isRequiredAttributeFilled(attributes[2], withValue('list', ['value']))).toBe(true)
  })

  it.each([undefined, null])('treats an explicitly cleared default as empty: %s', (clearedValue) => {
    const hierarchy = createHierarchy()
    addAttribute(hierarchy, issueType, 'withDefault', { required: true, defaultValue: 'default' })
    const [attribute] = getCreateIssueAttributes(hierarchy, createTaskType(issueType))
    const initial = fillCreateIssueAttributeDefaults([attribute], {})
    const cleared = setCreateIssueAttributeValue(initial, attribute, clearedValue)

    expect(isRequiredAttributeFilled(attribute, initial)).toBe(true)
    expect(getCreateIssueAttributeValues([attribute], initial)).toEqual({ withDefault: 'default' })
    expect(isRequiredAttributeFilled(attribute, cleared)).toBe(false)
    expect(getCreateIssueAttributeValues([attribute], cleared)).toEqual(
      clearedValue === null ? { withDefault: null } : {}
    )
  })

  it('discards previous task type values without clearing other draft fields', () => {
    const hierarchy = createHierarchy()
    addAttribute(hierarchy, tracker.class.Issue, 'issueCustom')
    addAttribute(hierarchy, issueType, 'oldValue')
    addAttribute(hierarchy, issueType, 'sharedValue')
    addAttribute(hierarchy, otherIssueType, 'newValue')
    const previous = getCreateIssueAttributes(hierarchy, createTaskType(issueType))
    const next = getCreateIssueAttributes(hierarchy, createTaskType(otherIssueType))
    const previousValues = { oldValue: 'discard', sharedValue: 'discard' }
    const draft = {
      title: 'Draft',
      issueCustom: 'keep',
      [issueType]: previousValues
    }

    expect(removeChangedTaskTypeValues(draft, previous, next)).toEqual({
      title: 'Draft',
      issueCustom: 'keep'
    })
    expect(previousValues.oldValue).toBe('discard')
  })

  it('builds mixin values from defaults and explicit nested draft values only', () => {
    const hierarchy = createHierarchy()
    addAttribute(hierarchy, issueType, 'withDefault', { defaultValue: ['default'] })
    addAttribute(hierarchy, issueType, 'explicit')
    addAttribute(hierarchy, issueType, 'empty')
    const attributes = getCreateIssueAttributes(hierarchy, createTaskType(issueType))
    const draft = { title: 'Draft', unrelated: 'discard', [issueType]: { explicit: 'value' } }

    expect(getCreateIssueAttributeValues(attributes, draft)).toEqual({
      withDefault: ['default'],
      explicit: 'value'
    })
    expect(getCreateIssueAttributeValues(attributes, draft).withDefault).not.toBe(
      attributes.find((attribute) => attribute.key === 'withDefault')?.attr.defaultValue
    )
  })

  it('updates and defaults nested mixin draft values without replacing existing values', () => {
    const hierarchy = createHierarchy()
    addAttribute(hierarchy, issueType, 'withDefault', { defaultValue: 'default' })
    addAttribute(hierarchy, issueType, 'explicit')
    const attributes = getCreateIssueAttributes(hierarchy, createTaskType(issueType))
    const existingValues = { explicit: 'existing' }
    const draft = { [issueType]: existingValues }
    const updated = setCreateIssueAttributeValue(draft, attributes[1], 'changed')
    const filled = fillCreateIssueAttributeDefaults(attributes, updated)

    expect(filled).toEqual({ [issueType]: { explicit: 'changed', withDefault: 'default' } })
    expect(existingValues.explicit).toBe('existing')
  })

  it('keeps an untouched dialog equal to its empty reference', () => {
    const hierarchy = createHierarchy()
    addAttribute(hierarchy, issueType, 'withDefault', { defaultValue: 'default' })
    addAttribute(hierarchy, issueType, 'explicit')
    const attributes = getCreateIssueAttributes(hierarchy, createTaskType(issueType))
    const kind = 'test:type:Issue' as Ref<TaskType>
    const baseline = getUntouchedCreateIssueDraft(attributes, kind)
    const initial: Record<string, unknown> = { kind, title: '' }
    const untouched = fillCreateIssueAttributeDefaults(attributes, initial)

    expect(baseline).toEqual({ kind, [issueType]: { withDefault: 'default' } })
    expect(untouched.kind).toEqual(baseline.kind)
    expect(untouched[issueType]).toEqual(baseline[issueType])
    const edited = setCreateIssueAttributeValue(untouched, attributes[1], 'value')
    expect(edited[issueType]).not.toEqual(baseline[issueType])
    expect(getUntouchedCreateIssueDraft(attributes, undefined)).toMatchObject({ kind: '' })
  })

  it('lets edited and cleared values win over the original values of a duplicated issue', () => {
    const hierarchy = createHierarchy()
    addAttribute(hierarchy, tracker.class.Issue, 'edited')
    addAttribute(hierarchy, tracker.class.Issue, 'cleared')
    addAttribute(hierarchy, tracker.class.Issue, 'untouched')
    addAttribute(hierarchy, tracker.class.Issue, 'notShown', { hidden: true })
    addAttribute(hierarchy, issueType, 'typeEdited')
    const issueAttributes = getCreateIssueAttributes(hierarchy)
    const typeAttributes = getCreateIssueAttributes(hierarchy, createTaskType(issueType)).slice(issueAttributes.length)
    const original = { edited: 'old', cleared: 'old', untouched: 'old', notShown: 'old' }
    const draft = { ...original, edited: 'new', cleared: undefined, [issueType]: { typeEdited: 'new' } }

    expect(getCreateIssueAttributeValues(issueAttributes, draft, original)).toEqual({
      edited: 'new',
      untouched: 'old',
      notShown: 'old'
    })
    expect(getCreateIssueAttributeValues(typeAttributes, draft, { typeEdited: 'old', other: 'kept' })).toEqual({
      typeEdited: 'new',
      other: 'kept'
    })
  })

  it('removes the mixin of a duplicated issue when all its values are cleared', () => {
    const hierarchy = createHierarchy()
    addAttribute(hierarchy, issueType, 'typeEdited')
    const attributes = getCreateIssueAttributes(hierarchy, createTaskType(issueType))
    const mixins = new Map<Ref<Class<Doc>>, Record<string, unknown>>([[issueType, { typeEdited: 'old' }]])
    const cleared = { [issueType]: { typeEdited: undefined } }

    const clearedValues = getCreateIssueAttributeValues(attributes, cleared, mixins.get(issueType))
    setCreateIssueMixinValues(mixins, issueType, clearedValues)
    expect(mixins.has(issueType)).toBe(false)

    const edited = { [issueType]: { typeEdited: 'new' } }
    const editedValues = getCreateIssueAttributeValues(attributes, edited, { typeEdited: 'old' })
    setCreateIssueMixinValues(mixins, issueType, editedValues)
    expect(mixins.get(issueType)).toEqual({ typeEdited: 'new' })
  })
})
