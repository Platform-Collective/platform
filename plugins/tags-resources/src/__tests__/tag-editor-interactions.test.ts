/**
 * @jest-environment jsdom
 */
// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import type { Class, Doc, PersonId, Ref, Space } from '@hcengineering/core'
import type { Asset } from '@hcengineering/platform'
import { createQuery, getClient } from '@hcengineering/presentation'
import type { KeyedAttribute } from '@hcengineering/presentation'
import tags from '@hcengineering/tags'
import type { TagCategory, TagElement, TagReference } from '@hcengineering/tags'
import { showPopup } from '@hcengineering/ui'
import { SvelteComponent, tick } from 'svelte'
import Tags from '../components/Tags.svelte'
import TagsEditor from '../components/TagsEditor.svelte'
import TagsPopup from '../components/TagsPopup.svelte'
import { deferred } from './deferred'

jest.mock('../components/CreateTagElement.svelte', () => jest.requireActual('./fixtures/UiStub.svelte'))
jest.mock('../components/WeightPopup.svelte', () => jest.requireActual('./fixtures/UiStub.svelte'))
jest.mock('@hcengineering/core', () => ({
  toIdMap: (documents: Doc[]): Map<Ref<Doc>, Doc> => new Map(documents.map((doc) => [doc._id, doc]))
}))
jest.mock('@hcengineering/platform', () => ({
  translateCB: (_label: string, _params: unknown, _language: string, onTranslate: (label: string) => void) => {
    onTranslate('Labels')
  }
}))
jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: { string: { Search: 'Search' } },
  createQuery: jest.fn(),
  getClient: jest.fn()
}))
jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))
jest.mock('@hcengineering/tags', () => ({
  __esModule: true,
  default: { class: { TagReference: 'tags:class:TagReference' } },
  findTagCategory: jest.fn()
}))
jest.mock('../plugin', () => ({
  __esModule: true,
  default: {
    class: {
      TagReference: 'tags:class:TagReference',
      TagElement: 'tags:class:TagElement',
      TagCategory: 'tags:class:TagCategory'
    },
    string: { Expert: 'Expert', Meaningfull: 'Meaningful', Initial: 'Initial' }
  }
}))
jest.mock('../utils', () => ({ createTagElement: jest.fn() }))
jest.mock('@hcengineering/ui', () => {
  const { default: ui } = jest.requireActual<{ default: typeof SvelteComponent }>('./fixtures/UiStub.svelte')
  const { default: button } = jest.requireActual<{ default: typeof SvelteComponent }>('./fixtures/ButtonStub.svelte')
  const { default: slot } = jest.requireActual<{ default: typeof SvelteComponent }>('./fixtures/SlotStub.svelte')
  function store<T> (value: T): { subscribe: (run: (value: T) => void) => () => void } {
    return {
      subscribe (run: (value: T) => void): () => void {
        run(value)
        return () => {}
      }
    }
  }
  return {
    Button: button,
    ShowMore: slot,
    Label: ui,
    Icon: ui,
    EditWithIcon: ui,
    showPopup: jest.fn(),
    getEventPopupPositionElement: jest.fn(() => document.body),
    resizeObserver: jest.fn(() => ({ destroy: jest.fn() })),
    themeStore: store({ language: 'en', dark: false }),
    deviceOptionsStore: store({ isMobile: false }),
    getPlatformColorDef: jest.fn(() => ({ color: 'red' }))
  }
})

const handleError = jest.spyOn(Analytics, 'handleError')

const object: Doc = {
  _id: 'document' as Ref<Doc>,
  _class: 'test:class:Document' as Ref<Class<Doc>>,
  space: 'space' as Ref<Space>,
  modifiedBy: 'account' as PersonId,
  modifiedOn: 0
}
const tag: TagElement = {
  ...object,
  _id: 'tag' as Ref<TagElement>,
  _class: 'tags:class:TagElement' as Ref<Class<TagElement>>,
  targetClass: object._class,
  category: 'category' as Ref<TagCategory>,
  title: 'Bug',
  description: '',
  color: 1
}
const category: TagCategory = {
  ...object,
  _id: tag.category,
  _class: 'tags:class:TagCategory' as Ref<Class<TagCategory>>,
  targetClass: object._class,
  label: 'Labels',
  icon: 'tag-icon' as Asset,
  tags: [],
  default: true
}
// Synthetic storage and service boundary; the editor and popup toggle behavior are production code.
const key = { key: 'labels', attr: { label: 'Labels', type: {}, schema: '0' } } as unknown as KeyedAttribute
let references: TagReference[] = []
let referenceSequence = 0
let components: SvelteComponent[] = []
const findAllPage = jest.fn(
  async (_class: string, scope: Pick<TagReference, 'attachedTo' | 'attachedToClass' | 'collection' | 'tag'>) => ({
    docs: references
      .filter(
        (reference) =>
          reference.attachedTo === scope.attachedTo &&
          reference.attachedToClass === scope.attachedToClass &&
          reference.collection === scope.collection &&
          reference.tag === scope.tag
      )
      .slice(0, 1)
  })
)
const addCollection = jest.fn(
  async (
    _class: string,
    space: Ref<Space>,
    attachedTo: Ref<Doc>,
    attachedToClass: Ref<Class<Doc>>,
    collection: string,
    data: Pick<TagReference, 'tag' | 'title' | 'color'>
  ) => {
    const reference: TagReference = {
      ...object,
      _id: `reference-${referenceSequence++}` as Ref<TagReference>,
      _class: tags.class.TagReference,
      space,
      attachedTo,
      attachedToClass,
      collection,
      ...data
    }
    references.push(reference)
    return reference._id
  }
)
const removeCollection = jest.fn(async (_class: string, _space: Ref<Space>, id: Ref<TagReference>) => {
  references = references.filter((reference) => reference._id !== id)
})
const client = { findAllPage, addCollection, removeCollection }

async function flushUpdates (): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
  await tick()
}

async function openPopup (persisted = true): Promise<void> {
  components.push(
    persisted
      ? new Tags({ target: document.body, props: { object, _class: object._class, key } })
      : new TagsEditor({ target: document.body, props: { items: [], targetClass: object._class, key } })
  )
  await tick()
  const add = document.querySelector<HTMLButtonElement>('#add-tag')
  if (add === null) throw new Error('Missing add-tag control')
  add.click()
  const call = jest.mocked(showPopup).mock.lastCall
  if (call === undefined) throw new Error('Missing popup call')
  expect(call[0]).toBe(TagsPopup)
  const update = call[4] as (result: { action: string, tag?: TagElement }) => void
  const popup = new TagsPopup({
    target: document.body,
    props: call[1] as { targetClass: Ref<Class<Doc>>, selected: Ref<TagElement>[], hideAdd: boolean }
  })
  popup.$on('update', (event) => {
    update(event.detail)
  })
  components.push(popup)
  await flushUpdates()
}

function toggle (): void {
  const button = document.querySelector<HTMLButtonElement>('.menu-item')
  if (button === null) throw new Error('Missing tag toggle')
  button.click()
}

interface QueryScope {
  _id?: { $in: Ref<Doc>[] }
  targetClass?: Ref<Class<Doc>>
  attachedTo?: Ref<Doc>
  attachedToClass?: Ref<Class<Doc>>
  collection?: string
}

// No live notifications after writes: removal must see the fresh stored reference.
const query = jest.fn((classId: string, scope: QueryScope, onResult: (result: unknown[]) => void) => {
  if (classId === 'tags:class:TagElement') {
    onResult(
      (scope.targetClass === undefined || scope.targetClass === tag.targetClass) &&
        (scope._id === undefined || scope._id.$in.includes(tag._id))
        ? [tag]
        : []
    )
  } else if (classId === 'tags:class:TagCategory') {
    onResult(scope.targetClass === category.targetClass ? [category] : [])
  } else {
    onResult(
      references.filter(
        (reference) =>
          reference.attachedTo === scope.attachedTo &&
          reference.attachedToClass === scope.attachedToClass &&
          reference.collection === scope.collection
      )
    )
  }
})

beforeEach(() => {
  jest.clearAllMocks()
  references = []
  referenceSequence = 0
  jest.mocked(getClient).mockReturnValue(client as unknown as ReturnType<typeof getClient>)
  jest
    .mocked(createQuery)
    .mockReturnValue({ query, unsubscribe: jest.fn() } as unknown as ReturnType<typeof createQuery>)
})

afterEach(() => {
  for (const component of components.reverse()) component.$destroy()
  components = []
  document.body.replaceChildren()
})

it.each(['lookup', 'write'] as const)('honors add/remove intent while the %s is pending', async (phase) => {
  const finish = deferred<undefined>()
  const started = deferred<undefined>()
  if (phase === 'lookup') {
    findAllPage.mockImplementationOnce(async () => {
      started.resolve(undefined)
      await finish.promise
      return { docs: [] }
    })
  } else {
    const write = addCollection.getMockImplementation()
    if (write === undefined) throw new Error('Missing write implementation')
    addCollection.mockImplementationOnce(async (...args) => {
      started.resolve(undefined)
      await finish.promise
      return await write(...args)
    })
  }
  await openPopup()
  toggle()
  await started.promise
  toggle()
  await tick()
  expect(document.querySelector('.menu-item')?.classList.contains('selected')).toBe(false)
  finish.resolve(undefined)
  await flushUpdates()

  expect(addCollection).toHaveBeenCalledTimes(1)
  expect(removeCollection).toHaveBeenCalledWith(
    tags.class.TagReference,
    object.space,
    'reference-0',
    object._id,
    object._class,
    'labels'
  )
  expect(references).toEqual([])
  expect(handleError).not.toHaveBeenCalled()
})

it('honors add/remove/add intent without query notifications', async () => {
  const finish = deferred<undefined>()
  const started = deferred<undefined>()
  findAllPage.mockImplementationOnce(async () => {
    started.resolve(undefined)
    await finish.promise
    return { docs: [] }
  })
  await openPopup()
  toggle()
  await started.promise
  toggle()
  toggle()
  finish.resolve(undefined)
  await flushUpdates()

  expect(addCollection).toHaveBeenCalledTimes(2)
  expect(removeCollection).toHaveBeenCalledTimes(1)
  expect(references).toHaveLength(1)
  expect(document.querySelector('.menu-item')?.classList.contains('selected')).toBe(true)
})

it('ignores a popup removal with no matching reference in an event-only editor', async () => {
  await openPopup(false)
  toggle()
  toggle()
  await flushUpdates()

  expect(removeCollection).not.toHaveBeenCalled()
  expect(handleError).not.toHaveBeenCalled()
})

it('reports a failed addition and permits a later toggle after failure', async () => {
  const error = new Error('Offline')
  findAllPage.mockRejectedValueOnce(error)
  await openPopup()
  toggle()
  await flushUpdates()
  expect(handleError).toHaveBeenCalledWith(error)
  toggle()
  toggle()
  await flushUpdates()

  expect(references).toHaveLength(1)
  expect(addCollection).toHaveBeenCalledTimes(1)
})

it('updates both tag and category queries when the real popup vocabulary changes', async () => {
  const popup = new TagsPopup({ target: document.body, props: { targetClass: object._class } })
  components.push(popup)
  const nextClass = 'test:class:OtherDocument' as Ref<Class<Doc>>
  popup.$set({ targetClass: nextClass })
  await tick()

  expect(query).toHaveBeenCalledWith('tags:class:TagCategory', { targetClass: nextClass }, expect.any(Function))
  expect(query).toHaveBeenCalledWith(
    'tags:class:TagElement',
    { title: { $like: '%%' }, targetClass: nextClass },
    expect.any(Function)
  )
})
