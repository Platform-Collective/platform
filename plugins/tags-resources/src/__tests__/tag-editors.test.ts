/**
 * @jest-environment jsdom
 */
// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import type { AnyAttribute, Class, Doc, PersonId, Ref, Space } from '@hcengineering/core'
import { createQuery, getClient } from '@hcengineering/presentation'
import type { KeyedAttribute } from '@hcengineering/presentation'
import tags, { TagsEvents } from '@hcengineering/tags'
import type { TagElement, TagReference } from '@hcengineering/tags'
import { showPopup, tooltip } from '@hcengineering/ui'
import { getCollectionCounter, getObjectId } from '@hcengineering/view-resources'
import { SvelteComponent, tick } from 'svelte'
import AttributeBarEditor from '@hcengineering/presentation/src/components/AttributeBarEditor.svelte'
import DocTagsEditor from '../components/DocTagsEditor.svelte'
import LabelsPresenter from '../components/LabelsPresenter.svelte'
import TagsAttributeEditor from '../components/TagsAttributeEditor.svelte'
import TagsPresentationPopup from '../components/TagsPresentationPopup.svelte'
import TagsPresenter from '../components/TagsPresenter.svelte'
import ObjectsTagsEditorPopup from '../components/ObjectsTagsEditorPopup.svelte'
import Tags from '../components/Tags.svelte'
import TagsEditorPopup from '../components/TagsEditorPopup.svelte'
import { deferred } from './deferred'

jest.mock('../components/TagsPopup.svelte', () => jest.requireActual('./fixtures/TagsPopupStub.svelte'))
jest.mock('../components/TagsEditor.svelte', () => jest.requireActual('./fixtures/TagsEditorStub.svelte'))

jest.mock('@hcengineering/view', () => ({ __esModule: true, default: {} }))
jest.mock('@hcengineering/core', () => ({
  toIdMap: (documents: Doc[]): Map<Ref<Doc>, Doc> => new Map(documents.map((doc) => [doc._id, doc]))
}))
jest.mock('@hcengineering/ui', () => {
  const { default: component } = jest.requireActual<{ default: typeof SvelteComponent }>('./fixtures/UiStub.svelte')
  return {
    Icon: component,
    Label: component,
    ButtonBase: component,
    Chip: component,
    showPopup: jest.fn(),
    getEventPopupPositionElement: jest.fn(() => document.body),
    tooltip: jest.fn(() => ({ update: jest.fn(), destroy: jest.fn() })),
    resizeObserver: jest.fn(() => ({ destroy: jest.fn() }))
  }
})
jest.mock('../utils', () => ({
  selectedTagElements: {
    subscribe (run: (value: Ref<TagElement>[]) => void): () => void {
      run([])
      return () => {}
    }
  }
}))
jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn(), handleEvent: jest.fn() } }))
jest.mock('@hcengineering/presentation', () => ({ createQuery: jest.fn(), getClient: jest.fn() }))
jest.mock('@hcengineering/presentation/src/utils', () => {
  const presentation = jest.requireMock<{ getClient: typeof getClient }>('@hcengineering/presentation')
  return { getClient: presentation.getClient, getAttributeEditor: jest.fn() }
})
jest.mock('@hcengineering/presentation/src/attributes', () => ({
  getAttribute: jest.fn(),
  updateAttribute: jest.fn()
}))
jest.mock('@hcengineering/view-resources', () => ({ getCollectionCounter: jest.fn(), getObjectId: jest.fn() }))
jest.mock('@hcengineering/tags', () => ({
  __esModule: true,
  default: { class: { TagReference: 'tags:class:TagReference' }, string: { AddLabel: 'Add label' } },
  TagsEvents: { TagCreated: 'tag-created', TagRemoved: 'tag-removed' }
}))
jest.mock('../plugin', () => ({
  __esModule: true,
  default: {
    class: { TagReference: 'tags:class:TagReference', TagElement: 'tags:class:TagElement' },
    icon: { Tags: 'tags-icon' },
    string: { Expert: 'Expert', Meaningfull: 'Meaningful', Initial: 'Initial' }
  }
}))

const object: Doc = {
  _id: 'document' as Ref<Doc>,
  _class: 'test:class:Document' as Ref<Class<Doc>>,
  space: 'space' as Ref<Space>,
  modifiedBy: 'account' as PersonId,
  modifiedOn: 0
}
const otherObject: Doc = {
  ...object,
  _id: 'other-document' as Ref<Doc>,
  _class: 'test:class:OtherDocument' as Ref<Class<Doc>>
}
const targetClass = 'test:mixin:TagTarget' as Ref<Class<Doc>>
const handleError = jest.spyOn(Analytics, 'handleError')
const handleEvent = jest.spyOn(Analytics, 'handleEvent')

interface ReferenceQuery {
  attachedTo?: string | { $in: string[] }
  attachedToClass?: string | { $in: string[] }
  collection?: string
  tag?: Ref<TagElement>
}

function matchesField (value: string, query: string | { $in: string[] } | undefined): boolean {
  return query === undefined || (typeof query === 'string' ? value === query : query.$in.includes(value))
}

function matchesReference (reference: TagReference, query: ReferenceQuery): boolean {
  return (
    matchesField(reference.attachedTo, query.attachedTo) &&
    matchesField(reference.attachedToClass, query.attachedToClass) &&
    matchesField(reference.collection, query.collection) &&
    matchesField(reference.tag, query.tag)
  )
}

let referenceSequence = 0

function createReference (overrides: Partial<TagReference> = {}): TagReference {
  return {
    ...object,
    _id: `reference-${referenceSequence++}` as Ref<TagReference>,
    _class: tags.class.TagReference,
    attachedTo: object._id,
    attachedToClass: object._class,
    collection: 'labels',
    tag: 'tag' as Ref<TagElement>,
    title: 'Bug',
    color: 1,
    ...overrides
  }
}

let references: TagReference[] = []
const query = jest.fn((_class: string, scope: ReferenceQuery, callback: (result: TagReference[]) => void) => {
  callback(
    _class === tags.class.TagReference ? references.filter((reference) => matchesReference(reference, scope)) : []
  )
  return true
})
const findAllPage = jest.fn(async (_class: string, scope: ReferenceQuery) => {
  return { docs: references.filter((reference) => matchesReference(reference, scope)).slice(0, 1) }
})
const findOne = jest.fn(async (_class: string, scope: ReferenceQuery) => {
  return references.find((reference) => matchesReference(reference, scope))
})
const remove = jest.fn(async (removed: TagReference) => {
  references = references.filter((reference) => reference._id !== removed._id)
})
const addCollection = jest.fn(
  async (
    _class: string,
    space: Ref<Space>,
    attachedTo: Ref<Doc>,
    attachedToClass: Ref<Class<Doc>>,
    collection: string,
    data: Pick<TagReference, 'tag' | 'title' | 'color'>
  ) => {
    const reference = createReference({
      ...data,
      space,
      attachedTo,
      attachedToClass,
      collection
    })
    references.push(reference)
    return reference._id
  }
)
const removeCollection = jest.fn().mockResolvedValue(undefined)
const update = jest.fn().mockResolvedValue(undefined)
const client = {
  findAllPage,
  findOne,
  remove,
  addCollection,
  removeCollection,
  update,
  getHierarchy: jest.fn().mockReturnValue({
    getAttribute: jest.fn((_class: string, key: string) => ({ label: key })),
    isMixin: jest.fn((_class: string) => _class === targetClass)
  })
}
let component: SvelteComponent | undefined

function mountPopup (mode: 'single' | 'bulk'): void {
  component =
    mode === 'single'
      ? new TagsEditorPopup({ target: document.body, props: { object, targetClass } })
      : new ObjectsTagsEditorPopup({ target: document.body, props: { value: [object, otherObject] } })
}

function selected (): string | null {
  const popup = document.querySelector('[data-selected]')
  if (popup === null) throw new Error('Missing popup')
  return popup.getAttribute('data-selected')
}

function click (label: string): void {
  // Production buttons keep template whitespace between the icon and label, e.g. " Add label".
  const button = Array.from(document.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === label
  )
  if (button === undefined) throw new Error(`Missing ${label} button`)
  button.click()
}

async function flushUpdates (): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
  await tick()
}

beforeEach(() => {
  jest.clearAllMocks()
  references = []
  referenceSequence = 0
  jest.mocked(getClient).mockReturnValue(client as unknown as ReturnType<typeof getClient>)
  const liveQuery = { query, unsubscribe: jest.fn() }
  jest.mocked(createQuery).mockReturnValue(liveQuery as unknown as ReturnType<typeof createQuery>)
  jest.mocked(getObjectId).mockResolvedValue('document-id')
  jest.mocked(getCollectionCounter).mockReturnValue(0)
})

afterEach(() => {
  component?.$destroy()
  component = undefined
  document.body.replaceChildren()
})

// Synthetic child fixtures expose permanent Add/Remove controls and render parent inputs.
// They do not toggle selection like TagsPopup or exercise TagsEditor's actual UI.
// Handler reinvocation below is not proof that a user can retry through the real popup.
describe.each(['single', 'bulk'] as const)('%s tag popup', (mode) => {
  it('does not select a tag attached only in another collection or class', () => {
    references = [
      createReference({ collection: 'skills' }),
      createReference({ attachedToClass: targetClass }),
      createReference({ attachedTo: otherObject._id, attachedToClass: otherObject._class, collection: 'skills' })
    ]
    mountPopup(mode)

    expect(selected()).toBe('')
    expect(query).toHaveBeenCalledWith(
      tags.class.TagReference,
      mode === 'single'
        ? { attachedTo: object._id, attachedToClass: object._class, collection: 'labels' }
        : {
            attachedTo: { $in: [object._id, otherObject._id] },
            attachedToClass: { $in: [object._class, otherObject._class] },
            collection: 'labels'
          },
      expect.any(Function)
    )
  })

  it('selects labels present on every document in its own scope', () => {
    references = [
      createReference(),
      createReference({ attachedTo: otherObject._id, attachedToClass: otherObject._class })
    ]
    mountPopup(mode)

    expect(selected()).toBe('tag')
  })

  it('removes only the label reference in each document scope', async () => {
    const wrongCollection = createReference({ _id: 'skill' as Ref<TagReference>, collection: 'skills' })
    const wrongClass = createReference({ _id: 'mixin' as Ref<TagReference>, attachedToClass: targetClass })
    const label = createReference()
    const otherLabel = createReference({
      _id: 'other-label' as Ref<TagReference>,
      attachedTo: otherObject._id,
      attachedToClass: otherObject._class
    })
    references = [wrongCollection, wrongClass, label, otherLabel]
    mountPopup(mode)
    click('Remove')
    await flushUpdates()

    expect(findOne).toHaveBeenCalledWith(tags.class.TagReference, {
      attachedTo: object._id,
      attachedToClass: object._class,
      collection: 'labels',
      tag: 'tag'
    })
    expect(remove).toHaveBeenCalledWith(label)
    expect(references).toContain(wrongCollection)
    expect(references).toContain(wrongClass)
    if (mode === 'bulk') {
      expect(findOne).toHaveBeenCalledWith(tags.class.TagReference, {
        attachedTo: otherObject._id,
        attachedToClass: otherObject._class,
        collection: 'labels',
        tag: 'tag'
      })
      expect(remove).toHaveBeenCalledWith(otherLabel)
      expect(remove).toHaveBeenCalledTimes(2)
    } else {
      expect(remove).toHaveBeenCalledTimes(1)
      expect(selected()).toBe('')
      expect(handleEvent).toHaveBeenCalledWith(TagsEvents.TagRemoved, {
        objectId: 'document-id',
        objectClass: object._class
      })
    }
  })

  it('does not remove a reference found only in another scope', async () => {
    references = [createReference({ collection: 'skills' }), createReference({ attachedToClass: targetClass })]
    mountPopup(mode)
    click('Remove')
    await flushUpdates()

    expect(remove).not.toHaveBeenCalled()
    expect(handleEvent).not.toHaveBeenCalled()
    expect(references).toHaveLength(2)
  })

  it('checks persisted labels when the popup selection is stale', async () => {
    mountPopup(mode)
    expect(selected()).toBe('')
    references = [createReference()]
    click('Add')
    await flushUpdates()

    expect(findAllPage).toHaveBeenCalledWith(
      tags.class.TagReference,
      { attachedTo: object._id, attachedToClass: object._class, collection: 'labels', tag: 'tag' },
      { limit: 1 }
    )
    expect(addCollection).toHaveBeenCalledTimes(mode === 'bulk' ? 1 : 0)
    expect(handleEvent).not.toHaveBeenCalled()
  })

  it('adds labels in each document scope while preserving other scopes', async () => {
    const skill = createReference({ collection: 'skills' })
    references = [skill]
    mountPopup(mode)
    click('Add')
    await flushUpdates()

    expect(addCollection).toHaveBeenCalledWith(
      tags.class.TagReference,
      object.space,
      object._id,
      object._class,
      'labels',
      { tag: 'tag', title: 'Bug', color: 1 }
    )
    expect(addCollection).toHaveBeenCalledTimes(mode === 'bulk' ? 2 : 1)
    expect(references).toContain(skill)
    if (mode === 'bulk') {
      expect(addCollection).toHaveBeenCalledWith(
        tags.class.TagReference,
        otherObject.space,
        otherObject._id,
        otherObject._class,
        'labels',
        { tag: 'tag', title: 'Bug', color: 1 }
      )
    } else {
      expect(selected()).toBe('tag')
      expect(handleEvent).toHaveBeenCalledWith(TagsEvents.TagCreated, {
        objectId: 'document-id',
        objectClass: object._class
      })
    }
  })

  it.each(['findAllPage', 'addCollection', 'findOne', 'remove'] as const)(
    'reports a rejected %s and permits handler reinvocation',
    async (operation) => {
      references = operation === 'remove' ? [createReference()] : []
      const error = new Error('Offline')
      client[operation].mockRejectedValueOnce(error)
      mountPopup(mode)
      click(operation === 'findAllPage' || operation === 'addCollection' ? 'Add' : 'Remove')
      await flushUpdates()

      expect(handleError).toHaveBeenCalledTimes(1)
      expect(handleError).toHaveBeenCalledWith(error)
      expect(handleEvent).not.toHaveBeenCalled()
      if (operation === 'findAllPage') {
        expect(addCollection).toHaveBeenCalledTimes(mode === 'bulk' ? 1 : 0)
      }
      click(operation === 'findAllPage' || operation === 'addCollection' ? 'Add' : 'Remove')
      await flushUpdates()
      expect(handleError).toHaveBeenCalledTimes(1)
      expect(client[operation]).toHaveBeenCalledTimes(
        operation === 'remove' || mode === 'single' ? 2 : operation === 'addCollection' ? 3 : 4
      )
    }
  )

  it('ignores selection-only events', async () => {
    mountPopup(mode)
    click('Selection')
    await flushUpdates()

    expect(findAllPage).not.toHaveBeenCalled()
    expect(findOne).not.toHaveBeenCalled()
    expect(handleError).not.toHaveBeenCalled()
  })

  it('normalizes non-Error rejections from update events', async () => {
    findAllPage.mockRejectedValueOnce('Offline')
    mountPopup(mode)
    click('Add')
    await flushUpdates()

    expect(handleError).toHaveBeenCalledTimes(1)
    expect(handleError).toHaveBeenCalledWith(new Error('Offline'))
  })
})

it('skips persisted successes when a partially failed bulk handler is invoked again', async () => {
  const skill = createReference({ _id: 'skill' as Ref<TagReference>, collection: 'skills' })
  references = [skill]
  const error = new Error('Offline on first document')
  addCollection.mockRejectedValueOnce(error)
  mountPopup('bulk')
  click('Add')
  await flushUpdates()

  expect(handleError).toHaveBeenCalledWith(error)
  expect(references.filter((ref) => ref.collection === 'labels').map((ref) => ref.attachedTo)).toEqual([
    otherObject._id
  ])
  addCollection.mockClear()
  click('Add')
  await flushUpdates()

  expect(addCollection).toHaveBeenCalledTimes(1)
  expect(addCollection).toHaveBeenCalledWith(
    tags.class.TagReference,
    object.space,
    object._id,
    object._class,
    'labels',
    { tag: 'tag', title: 'Bug', color: 1 }
  )
  expect(
    references
      .filter((ref) => ref.collection === 'labels')
      .map((ref) => ref.attachedTo)
      .sort()
  ).toEqual([object._id, otherObject._id].sort())
  expect(references).toContain(skill)
  expect(handleError).toHaveBeenCalledTimes(1)
})

it.each(['single', 'bulk'] as const)(
  'blocks repeated %s handler additions after success without live notification',
  async (mode) => {
    mountPopup(mode)
    click('Add')
    await flushUpdates()
    click('Add')
    await flushUpdates()

    expect(addCollection).toHaveBeenCalledTimes(mode === 'bulk' ? 2 : 1)
    expect(references).toHaveLength(mode === 'bulk' ? 2 : 1)
  }
)

it('does not count duplicate or wrong-class references as labels on every document', async () => {
  references = [
    createReference(),
    createReference({ _id: 'duplicate' as Ref<TagReference> }),
    createReference({ attachedTo: otherObject._id, attachedToClass: object._class })
  ]
  mountPopup('bulk')
  expect(selected()).toBe('')

  references.push(createReference({ attachedTo: otherObject._id, attachedToClass: otherObject._class }))
  const lastQuery = query.mock.lastCall
  if (lastQuery === undefined) throw new Error('Missing live query')
  lastQuery[2](references.filter((reference) => matchesReference(reference, lastQuery[1])))
  await tick()
  expect(selected()).toBe('tag')
})

it('updates the default popup reference class when its document changes', async () => {
  const label = createReference()
  const otherLabel = createReference({ attachedTo: otherObject._id, attachedToClass: otherObject._class })
  references = [label, otherLabel]
  component = new TagsEditorPopup({ target: document.body, props: { object } })
  component.$set({ object: otherObject })
  await tick()

  expect(query).toHaveBeenLastCalledWith(
    tags.class.TagReference,
    { attachedTo: otherObject._id, attachedToClass: otherObject._class, collection: 'labels' },
    expect.any(Function)
  )
  expect(document.querySelector('[data-target-class]')?.getAttribute('data-target-class')).toBe(otherObject._class)
  click('Remove')
  await flushUpdates()
  expect(remove).toHaveBeenCalledWith(otherLabel)
  expect(references).toEqual([label])
})

it('filters the Tags parent by attribute collection when rendered through a stub', async () => {
  const label = createReference()
  const skill = createReference({ _id: 'skill' as Ref<TagReference>, collection: 'skills', title: 'TypeScript' })
  references = [label, skill, createReference({ attachedToClass: targetClass, title: 'Other class' })]
  const key = { key: 'labels', attr: {} } as unknown as KeyedAttribute
  component = new Tags({ target: document.body, props: { object, _class: object._class, key } })

  expect(query).toHaveBeenCalledWith(
    tags.class.TagReference,
    { attachedTo: object._id, attachedToClass: object._class, collection: 'labels' },
    expect.any(Function),
    { sort: { weight: -1, title: 1 } }
  )
  expect(document.querySelector('[data-reference]')?.textContent).toBe('Bug')
  expect(document.querySelectorAll('[data-reference]')).toHaveLength(1)

  component.$set({ key: { ...key, key: 'skills' } })
  await tick()
  expect(document.querySelector('[data-reference]')?.textContent).toBe('TypeScript')
  expect(document.querySelectorAll('[data-reference]')).toHaveLength(1)
})

it.each(['findAllPage', 'addCollection', 'removeCollection', 'update'] as const)(
  'handles a rejected %s in the Tags attribute editor',
  async (operation) => {
    references = [createReference({ tag: 'other-tag' as Ref<TagElement> })]
    const key = { key: 'labels', attr: {} } as unknown as KeyedAttribute
    const error = new Error('Offline')
    client[operation].mockRejectedValueOnce(error)
    component = new Tags({ target: document.body, props: { object, _class: object._class, key } })
    click(operation === 'update' ? 'Weight' : operation === 'removeCollection' ? 'Remove' : 'Add')
    await flushUpdates()

    expect(handleError).toHaveBeenCalledTimes(1)
    expect(handleError).toHaveBeenCalledWith(error)
    if (operation === 'findAllPage') expect(addCollection).not.toHaveBeenCalled()
  }
)

it('keeps the full editor, inline editor, counter, tooltip and popup in the same mixin collection', async () => {
  const label = createReference({ _id: 'mixin-label' as Ref<TagReference>, attachedToClass: targetClass })
  const skill = createReference({
    _id: 'mixin-skill' as Ref<TagReference>,
    attachedToClass: targetClass,
    collection: 'skills',
    title: 'TypeScript'
  })
  const baseLabel = createReference({ _id: 'base-label' as Ref<TagReference> })
  references = [label, skill, baseLabel]
  // Synthetic attribute metadata supplies only the fields consumed by these parents.
  const attribute = { attributeOf: targetClass } as unknown as AnyAttribute
  const key: KeyedAttribute = { key: 'skills', attr: attribute }
  component = new Tags({ target: document.body, props: { object, _class: targetClass, key } })
  expect(document.querySelector('[data-reference]')?.textContent).toBe('TypeScript')
  expect(document.querySelectorAll('[data-reference]')).toHaveLength(1)
  component.$destroy()

  component = new TagsAttributeEditor({
    target: document.body,
    props: { object, attribute, attributeKey: 'skills' }
  })
  expect(query).toHaveBeenCalledWith(
    tags.class.TagReference,
    { attachedTo: object._id, attachedToClass: targetClass, collection: 'skills' },
    expect.any(Function)
  )
  expect(document.querySelector('[data-reference]')?.textContent).toBe('TypeScript')
  click('Add label')
  await flushUpdates()
  const popupCall = jest.mocked(showPopup).mock.lastCall
  if (popupCall === undefined) throw new Error('Missing inline popup')
  expect(popupCall[0]).toBe(TagsEditorPopup)
  expect(popupCall[1]).toEqual({ object, targetClass, attachedToClass: targetClass, collection: 'skills' })
  component.$destroy()

  // The UI boundary is untyped; constrain its payload before passing it to the component.
  const popupProps = popupCall[1] as {
    object: Doc
    targetClass: Ref<Class<Doc>>
    attachedToClass: Ref<Class<Doc>>
    collection: string
  }
  component = new TagsEditorPopup({ target: document.body, props: popupProps })
  expect(selected()).toBe('tag')
  click('Remove')
  await flushUpdates()
  expect(findOne).toHaveBeenLastCalledWith(tags.class.TagReference, {
    attachedTo: object._id,
    attachedToClass: targetClass,
    collection: 'skills',
    tag: 'tag'
  })
  expect(remove).toHaveBeenCalledWith(skill)
  expect(references).toEqual([label, baseLabel])
  click('Add')
  await flushUpdates()
  expect(addCollection).toHaveBeenCalledWith(tags.class.TagReference, object.space, object._id, targetClass, 'skills', {
    tag: 'tag',
    title: 'Bug',
    color: 1
  })
  component.$destroy()

  // The table presenter shows the document's own counter for that attribute, as before this change.
  jest.mocked(getCollectionCounter).mockReturnValue(1)
  component = new TagsPresenter({ target: document.body, props: { value: object, _class: targetClass, key: 'skills' } })
  expect(getCollectionCounter).toHaveBeenCalledWith(client.getHierarchy(), object, {
    key: 'skills',
    attr: { label: 'skills' }
  })
  expect(document.body.textContent?.trim()).toBe('1')
  const tooltipCall = jest.mocked(tooltip).mock.lastCall
  if (tooltipCall === undefined) throw new Error('Missing tooltip')
  expect(tooltipCall[1]).toMatchObject({
    component: TagsPresentationPopup,
    props: { object, _class: targetClass, key: { key: 'skills' } }
  })
  component.$destroy()

  component = new TagsPresentationPopup({ target: document.body, props: { object, _class: targetClass, key } })
  expect(query).toHaveBeenCalledWith(
    tags.class.TagReference,
    { attachedTo: object._id, attachedToClass: targetClass, collection: 'skills' },
    expect.any(Function),
    { sort: { weight: -1, title: 1 } }
  )
  expect(document.querySelectorAll('[data-reference]')).toHaveLength(1)
  component.$set({ key: { ...key, key: 'labels' } })
  await tick()
  expect(document.querySelector('[data-reference]')?.getAttribute('data-reference')).toBe(label._id)
  expect(document.querySelectorAll('[data-reference]')).toHaveLength(1)
})

it('uses the attribute scope when the inline collection changes', async () => {
  references = [
    createReference(),
    createReference({ _id: 'skill' as Ref<TagReference>, attachedToClass: targetClass, collection: 'skills' })
  ]
  component = new TagsAttributeEditor({ target: document.body, props: { object } })
  expect(document.querySelector('[data-reference]')?.getAttribute('data-reference')).toBe('reference-0')
  const attribute = { attributeOf: targetClass } as unknown as AnyAttribute
  component.$set({ attribute, attributeKey: 'skills' })
  await tick()
  expect(document.querySelector('[data-reference]')?.getAttribute('data-reference')).toBe('skill')
  expect(document.querySelectorAll('[data-reference]')).toHaveLength(1)
  click('Add label')
  await flushUpdates()
  expect(jest.mocked(showPopup).mock.lastCall?.[1]).toEqual({
    object,
    targetClass,
    attachedToClass: targetClass,
    collection: 'skills'
  })
})

it('passes mixin collection metadata from the real panel attribute host to the tag editor', async () => {
  references = [
    createReference(),
    createReference({ _id: 'mixin-skill' as Ref<TagReference>, attachedToClass: targetClass, collection: 'skills' })
  ]
  // Other attribute metadata and value updates are outside this collection-scope regression.
  const attribute = { attributeOf: targetClass } as unknown as AnyAttribute
  const key: KeyedAttribute = { key: 'skills', attr: attribute }
  const inlineUtilities = jest.requireMock<{
    getAttributeEditor: jest.Mock<Promise<typeof TagsAttributeEditor>, []>
  }>('@hcengineering/presentation/src/utils')
  inlineUtilities.getAttributeEditor.mockResolvedValue(TagsAttributeEditor)
  component = new AttributeBarEditor({ target: document.body, props: { object, _class: targetClass, key } })
  await flushUpdates()

  expect(document.querySelectorAll('[data-reference]')).toHaveLength(1)
  expect(document.querySelector('[data-reference]')?.getAttribute('data-reference')).toBe('mixin-skill')
  click('Add label')
  await flushUpdates()
  expect(jest.mocked(showPopup).mock.lastCall?.[1]).toEqual({
    object,
    targetClass,
    attachedToClass: targetClass,
    collection: 'skills'
  })
})

it('counts and displays only document-class labels in DocTagsEditor and LabelsPresenter', async () => {
  const label = createReference()
  references = [
    label,
    createReference({ _id: 'skill' as Ref<TagReference>, collection: 'skills' }),
    createReference({ _id: 'mixin' as Ref<TagReference>, attachedToClass: targetClass })
  ]
  component = new DocTagsEditor({ target: document.body, props: { object, targetClass } })
  expect(document.querySelectorAll('[data-reference]')).toHaveLength(1)
  expect(document.querySelector('[data-reference]')?.getAttribute('data-reference')).toBe(label._id)
  const onChange = jest.fn()
  component.$on('change', onChange)
  await tick()
  // The initial count is established during construction; later notifications emit scoped changes.
  references.push(createReference({ _id: 'second-label' as Ref<TagReference> }))
  const lastQuery = query.mock.lastCall
  if (lastQuery === undefined) throw new Error('Missing document query')
  expect(lastQuery[1]).toEqual({ attachedTo: object._id, attachedToClass: object._class, collection: 'labels' })
  lastQuery[2](references.filter((ref) => matchesReference(ref, lastQuery[1])))
  await tick()
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ detail: 2 }))
  component.$destroy()

  component = new LabelsPresenter({
    target: document.body,
    props: { object, value: 4, full: false, kind: 'todo' }
  })
  expect(query).toHaveBeenLastCalledWith(
    tags.class.TagReference,
    { attachedTo: object._id, attachedToClass: object._class, collection: 'labels' },
    expect.any(Function)
  )
  expect(document.querySelectorAll('[data-reference]')).toHaveLength(2)
})

it.each(['document', 'collection', 'class', 'return'] as const)(
  'does not apply a deferred add to a newer popup scope: %s',
  async (change) => {
    const lookup = deferred<{ docs: TagReference[] }>()
    const started = deferred<undefined>()
    findAllPage.mockImplementationOnce(async () => {
      started.resolve(undefined)
      return await lookup.promise
    })
    component = new TagsEditorPopup({ target: document.body, props: { object } })
    click('Add')
    await started.promise
    const next =
      change === 'document' || change === 'return'
        ? { object: otherObject }
        : change === 'class'
          ? { attachedToClass: targetClass }
          : { collection: 'skills' }
    component.$set(next)
    await tick()
    if (change === 'return') {
      component.$set({ object })
      await tick()
    }
    expect(selected()).toBe('')
    lookup.resolve({ docs: [] })
    await flushUpdates()

    expect(selected()).toBe('')
    expect(addCollection).toHaveBeenCalledWith(
      tags.class.TagReference,
      object.space,
      object._id,
      object._class,
      'labels',
      { tag: 'tag', title: 'Bug', color: 1 }
    )
    expect(getObjectId).toHaveBeenCalledWith(object, client.getHierarchy())
    expect(handleEvent).toHaveBeenCalledWith(TagsEvents.TagCreated, {
      objectId: 'document-id',
      objectClass: object._class
    })
  }
)

it.each(['document', 'collection', 'class'] as const)(
  'does not apply a deferred removal to a newer popup scope: %s',
  async (change) => {
    const label = createReference()
    const nextLabel = createReference({
      attachedTo: change === 'document' ? otherObject._id : object._id,
      attachedToClass: change === 'document' ? otherObject._class : change === 'class' ? targetClass : object._class,
      collection: change === 'collection' ? 'skills' : 'labels'
    })
    references = [label, nextLabel]
    const removal = deferred<undefined>()
    const started = deferred<undefined>()
    remove.mockImplementationOnce(async () => {
      started.resolve(undefined)
      await removal.promise
    })
    component = new TagsEditorPopup({ target: document.body, props: { object } })
    click('Remove')
    await started.promise
    component.$set(
      change === 'document'
        ? { object: otherObject }
        : change === 'class'
          ? { attachedToClass: targetClass }
          : { collection: 'skills' }
    )
    await tick()
    expect(selected()).toBe('tag')
    removal.resolve(undefined)
    await flushUpdates()

    expect(selected()).toBe('tag')
    expect(remove).toHaveBeenCalledWith(label)
    expect(getObjectId).toHaveBeenCalledWith(object, client.getHierarchy())
    expect(handleEvent).toHaveBeenCalledWith(TagsEvents.TagRemoved, {
      objectId: 'document-id',
      objectClass: object._class
    })
  }
)

it('preserves inherited Board labels through the panel host and explicit Card-scoped full editor/counts', async () => {
  const card: Doc = { ...object, _class: 'board:class:Card' as Ref<Class<Doc>> }
  const taskClass = 'task:class:Task' as Ref<Class<Doc>>
  // Card extends Task, where labels is declared. Existing Board writers/vocabulary use Card.
  const attribute = { attributeOf: taskClass } as unknown as AnyAttribute
  const key: KeyedAttribute = { key: 'labels', attr: attribute }
  const label = createReference({ attachedToClass: card._class })
  references = [label, createReference({ attachedToClass: taskClass, title: 'Task scope' })]
  const inlineUtilities = jest.requireMock<{
    getAttributeEditor: jest.Mock<Promise<typeof TagsAttributeEditor>, []>
  }>('@hcengineering/presentation/src/utils')
  inlineUtilities.getAttributeEditor.mockResolvedValue(TagsAttributeEditor)
  component = new AttributeBarEditor({ target: document.body, props: { object: card, _class: card._class, key } })
  await flushUpdates()
  expect(document.querySelectorAll('[data-reference]')).toHaveLength(1)
  expect(document.querySelector('[data-reference]')?.getAttribute('data-reference')).toBe(label._id)
  click('Add label')
  await flushUpdates()
  expect(jest.mocked(showPopup).mock.lastCall?.[1]).toEqual({
    object: card,
    targetClass: card._class,
    attachedToClass: card._class,
    collection: 'labels'
  })
  component.$destroy()

  // Explicit Card props exercise Tags, not generic EditDoc, which passes the declaring attribute class.
  component = new Tags({ target: document.body, props: { object: card, _class: card._class, key } })
  expect(document.querySelectorAll('[data-reference]')).toHaveLength(1)
  expect(document.querySelector('[data-reference]')?.getAttribute('data-reference')).toBe(label._id)
  component.$destroy()

  // These are the actual TableView/KanbanCard presenter props for a Board Card.
  jest.mocked(getCollectionCounter).mockReturnValue(1)
  component = new TagsPresenter({ target: document.body, props: { value: card, _class: card._class, key: 'labels' } })
  expect(getCollectionCounter).toHaveBeenCalledWith(client.getHierarchy(), card, {
    key: 'labels',
    attr: { label: 'labels' }
  })
  expect(document.body.textContent?.trim()).toBe('1')
  expect(jest.mocked(tooltip).mock.lastCall?.[1]).toMatchObject({
    component: TagsPresentationPopup,
    props: { object: card, _class: card._class, key: { key: 'labels' } }
  })
  component.$destroy()
  component = new TagsPresentationPopup({ target: document.body, props: { object: card, _class: card._class, key } })
  expect(document.querySelectorAll('[data-reference]')).toHaveLength(1)
  expect(document.querySelector('[data-reference]')?.getAttribute('data-reference')).toBe(label._id)
})
