// SPDX-License-Identifier: EPL-2.0

import ts from 'typescript'
import type { Doc, Ref, Class } from '@hcengineering/core'
import type { Card } from '@hcengineering/card'
import type { NotificationContext } from '@hcengineering/communication-types'
import type { DocNotifyContext } from '@hcengineering/notification'
import type { NavigationItem } from '../type'
import type { Location } from '@hcengineering/ui'

// Keep Node helpers scoped to Jest; this client package uses DOM typings.
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: string) => string }>('node:fs')
const { runInNewContext } = jest.requireActual<{
  runInNewContext: (code: string, context: Record<string, unknown>) => unknown
}>('node:vm')

interface NavigationEvent {
  type: string
  detail?: { navItem: NavigationItem, doc: Doc }
}

interface NavigationHarness {
  remove: (item: NavigationItem) => Promise<void>
  keydown: (event: KeyboardEvent) => Promise<void>
  cache: (doc: Doc) => void
  setItems: (items: NavigationItem[]) => void
  setOpened: (doc?: Doc, context?: DocNotifyContext) => void
  readonly items: NavigationItem[]
  readonly selection: number
  readonly removing: NavigationItem | undefined
}

function modern (id: string): Extract<NavigationItem, { type: 'modern' }> {
  return {
    type: 'modern',
    _id: id as Ref<Card>,
    _class: 'card' as Ref<Class<Card>>,
    date: new Date(0),
    context: {
      id: `context-${id}` as NotificationContext['id'],
      cardId: id as NotificationContext['cardId'],
      account: 'account' as NotificationContext['account'],
      lastUpdate: new Date(0),
      lastView: new Date(0)
    }
  }
}

function legacy (id: string, contextId = `context-${id}`): Extract<NavigationItem, { type: 'legacy' }> {
  const doc = documentFor({ _id: id as Ref<Doc>, _class: 'issue' as Ref<Class<Doc>> })
  return {
    type: 'legacy',
    _id: doc._id,
    _class: doc._class,
    date: new Date(0),
    notifications: [],
    context: {
      ...doc,
      _id: contextId as Ref<DocNotifyContext>,
      _class: 'context' as Ref<Class<DocNotifyContext>>,
      space: 'personal' as DocNotifyContext['space'],
      objectId: doc._id,
      objectClass: doc._class,
      objectSpace: doc.space,
      user: 'account' as DocNotifyContext['user'],
      isPinned: false,
      hidden: false
    }
  }
}

function documentFor (item: Pick<NavigationItem, '_id' | '_class'>): Doc {
  return {
    _id: item._id,
    _class: item._class,
    space: 'space' as Doc['space'],
    modifiedOn: 0,
    modifiedBy: 'person' as Doc['modifiedBy']
  }
}

// Execute the component's actual instance script, leaving rendering to the browser suite.
// Only imports are replaced; the removal and keyboard handlers are never copied into tests.
function mountNavigation (
  items: NavigationItem[],
  selection = 0,
  opened?: NavigationItem,
  onEvent?: (event: NavigationEvent) => void
): {
  navigation: NavigationHarness
  events: NavigationEvent[]
  remove: jest.Mock<Promise<void>, [NavigationItem]>
  findOne: jest.Mock<Promise<Doc | undefined>, [unknown, { _id: string }]>
  select: jest.Mock
  focus: jest.Mock
  handleError: jest.Mock
} {
  const instance = instanceScript('InboxNavigation')
  const events: NavigationEvent[] = []
  const remove = jest.fn<Promise<void>, [NavigationItem]>().mockResolvedValue(undefined)
  const findOne = jest
    .fn<Promise<Doc | undefined>, [unknown, { _id: string }]>()
    .mockImplementation(async (_class, query) => documentFor(items.find((item) => item._id === query._id)!))
  const select = jest.fn()
  const focus = jest.fn()
  const handleError = jest.fn()
  const code = ts.transpileModule(
    `${instance}
    list = testList
    contentDiv = testContent
    listSelection = initialSelection
    const harness = {
      remove: handleRemove,
      keydown: onKeydown,
      cache: (value) => docById.set(value._id, value),
      setItems: (value) => { navItems = value },
      setOpened: (value, context) => { doc = value; legacyContext = context },
      get items() { return navItems },
      get selection() { return listSelection },
      get removing() { return removingItem }
    }
    harness`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }
  ).outputText
  const navigation = runInNewContext(code, {
    $navigationItemsStore: items,
    initialSelection: selection,
    testList: { select },
    testContent: { focus },
    createEventDispatcher: () => (type: string, detail?: NavigationEvent['detail']) => {
      const event = { type, detail }
      events.push(event)
      onEvent?.(event)
    },
    tick: async () => {},
    Analytics: { handleError },
    notification: { class: { ActivityNotificationViewlet: 'viewlet' } },
    getClient: () => ({ findOne, findAll: async () => [] }),
    InboxNotificationsClientImpl: { getClient: () => ({}) },
    NavigationClient: class {
      remove = remove
      navigationItemsStore = {}
      isLoadingStore = {}
    }
  }) as NavigationHarness
  navigation.setOpened(
    opened == null ? undefined : documentFor(opened),
    opened?.type === 'legacy' ? opened.context : undefined
  )
  return { navigation, events, remove, findOne, select, focus, handleError }
}

function instanceScript (component: string): string {
  const source = readFileSync(
    expect.getState().testPath!.replace('inbox-navigation.test.ts', `${component}.svelte`),
    'utf8'
  )
  const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)?.[1]
  if (script == null) throw new Error(`${component} instance script is missing`)
  const parsed = ts.createSourceFile(`${component}.ts`, script, ts.ScriptTarget.Latest, true)
  let instance = script
  for (const statement of [...parsed.statements].reverse()) {
    if (ts.isImportDeclaration(statement)) {
      instance = instance.slice(0, statement.getFullStart()) + instance.slice(statement.end)
    }
  }
  return instance.replace(/export let /g, 'let ')
}

interface ApplicationHarness {
  syncLocation: (loc: Location) => Promise<void>
  select: (event: { detail: NonNullable<NavigationEvent['detail']> }) => void
  close: () => void
  readonly doc: Doc | undefined
  readonly context: DocNotifyContext | undefined
}

function mountApplication (items: Array<Extract<NavigationItem, { type: 'legacy' }>>): {
  application: ApplicationHarness
  navigateToDoc: jest.Mock
  closeDoc: jest.Mock
  findOne: jest.Mock
} {
  const contexts = new Map(items.map((item) => [item.context._id, item.context]))
  const findOne = jest
    .fn()
    .mockImplementation(async (_class: unknown, query: { _id: string }) =>
      documentFor(items.find((item) => item._id === query._id)!)
    )
  const navigateToDoc = jest.fn()
  const closeDoc = jest.fn()
  const code = ts.transpileModule(
    `${instanceScript('InboxApplication')}
    ;({ syncLocation, select, close: handleClose,
      get doc() { return doc }, get context() { return legacyContext } })`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }
  ).outputText
  const application = runInNewContext(code, {
    getClient: () => ({ getHierarchy: () => ({}), findOne }),
    InboxNotificationsClientImpl: { getClient: () => ({}) },
    $contextByIdStore: contexts,
    $contextByDocStore: new Map(),
    $deviceInfo: {},
    inboxId: 'inbox',
    getDocInfoFromLocation: (loc: Location) => {
      const item = items.find((item) => item._id === loc.path[3])
      return item == null ? undefined : { _id: item._id, _class: item._class }
    },
    getMessageInfoFromLocation: () => undefined,
    getCurrentLocation: () => ({ path: ['', '', 'inbox'] }),
    resolvedLocationStore: { subscribe: () => () => {} },
    onDestroy: () => {},
    defineSeparators: () => {},
    closePanel: () => {},
    navigateToDoc,
    closeDoc
  }) as ApplicationHarness
  return { application, navigateToDoc, closeDoc, findOne }
}

interface TestKeyboardEvent extends KeyboardEvent {
  preventDefault: jest.Mock
  stopPropagation: jest.Mock
}

function key (code: string): TestKeyboardEvent {
  return { code, preventDefault: jest.fn(), stopPropagation: jest.fn() } as unknown as TestKeyboardEvent
}

describe('inbox removal navigation (#7335 and #7350)', () => {
  const factories: Array<(id: string) => NavigationItem> = [modern, legacy]

  describe.each(factories)('%p entries', (makeItem) => {
    test.each([0, 1, 2])('checkbox removal at index %i opens the adjacent entry', async (index) => {
      const items = ['a', 'b', 'c'].map((id) => makeItem(id))
      const { navigation, events, select, focus } = mountNavigation(items, index, items[index])
      await navigation.remove(items[index])
      const next = items[index + 1] ?? items[index - 1]
      expect(events).toEqual([{ type: 'select', detail: { navItem: next, doc: documentFor(next) } }])
      expect(navigation.selection).toBe(Math.min(index, 1))
      expect(select).toHaveBeenCalledWith(navigation.selection)
      expect(focus).toHaveBeenCalled()
    })

    test('removing the final opened entry clears the panel', async () => {
      const item = makeItem('a')
      const { navigation, events, select } = mountNavigation([item], 0, item)
      await navigation.remove(item)
      expect(navigation.items).toEqual([])
      expect(navigation.selection).toBe(0)
      expect(events).toEqual([{ type: 'clear', detail: undefined }])
      expect(select).not.toHaveBeenCalled()
    })

    test.each([false, true])('Backspace opens the next keyboard entry (other document open: %s)', async (openOther) => {
      const items = ['a', 'b', 'c'].map((id) => makeItem(id))
      const { navigation, events, remove } = mountNavigation(items, 1, openOther ? items[0] : undefined)
      const event = key('Backspace')
      await navigation.keydown(event)
      expect(remove).toHaveBeenCalledWith(items[1])
      expect(events).toEqual([{ type: 'select', detail: { navItem: items[2], doc: documentFor(items[2]) } }])
      expect(navigation.selection).toBe(1)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(event.stopPropagation).toHaveBeenCalled()
    })

    test('Backspace on the last keyboard entry opens its predecessor', async () => {
      const items = ['a', 'b'].map((id) => makeItem(id))
      const { navigation, events } = mountNavigation(items, 1)
      await navigation.keydown(key('Backspace'))
      expect(events[0]?.detail?.navItem).toEqual(items[0])
      expect(navigation.selection).toBe(0)
    })

    test('Backspace on the only keyboard entry clears the panel', async () => {
      const { navigation, events } = mountNavigation([makeItem('a')])
      await navigation.keydown(key('Backspace'))
      expect(events).toEqual([{ type: 'clear', detail: undefined }])
    })

    test('removing a preceding checkbox keeps the keyboard selection on the same entry', async () => {
      const items = ['a', 'b', 'c'].map((id) => makeItem(id))
      const { navigation, events } = mountNavigation(items, 2, items[2])
      await navigation.remove(items[0])
      expect(navigation.selection).toBe(1)
      expect(navigation.items[navigation.selection]).toEqual(items[2])
      expect(events).toEqual([])
    })

    test('removing a following checkbox preserves the opened entry and keyboard index', async () => {
      const items = ['a', 'b', 'c'].map((id) => makeItem(id))
      const { navigation, events } = mountNavigation(items, 0, items[0])
      await navigation.remove(items[2])
      expect(navigation.selection).toBe(0)
      expect(events).toEqual([])
    })
  })

  test.each([modern, legacy])(
    'an opened checkbox row is matched independently of the keyboard index (%p)',
    async (makeItem) => {
      const items = ['a', 'b', 'c'].map((id) => makeItem(id))
      const { navigation, events } = mountNavigation(items, 2, items[0])
      await navigation.remove(items[0])
      expect(events[0]?.detail?.navItem).toEqual(items[1])
      expect(navigation.selection).toBe(0)
      expect(items.map((item) => item._id)).toEqual(['a', 'b', 'c'])
    }
  )

  test('reselects when the opened document is cleared while removal is pending', async () => {
    const items = [modern('a'), legacy('b')]
    const { navigation, events, remove } = mountNavigation(items, 0, items[0])
    remove.mockImplementation(async () => {
      navigation.setOpened(undefined)
    })
    await navigation.remove(items[0])
    expect(events[0]?.detail?.navItem).toEqual(items[1])
  })

  test('removing the second legacy context for a shared document opens the following row', async () => {
    const items = [legacy('shared', 'first'), legacy('shared', 'second'), modern('c')]
    const { navigation, events } = mountNavigation(items, 1, items[1])
    await navigation.remove(items[1])
    expect(events[0]?.detail?.navItem).toEqual(items[2])
    expect(navigation.items).toEqual([items[0], items[2]])
  })

  test('removing consecutive legacy contexts for the same document updates the parent and clears the final entry', async () => {
    const items = [legacy('shared', 'context-a'), legacy('shared', 'context-b')]
    const { application, navigateToDoc, closeDoc, findOne } = mountApplication(items)
    const sync = async (item: (typeof items)[number]): Promise<void> => {
      await application.syncLocation({ path: ['', '', 'inbox', item._id], query: { context: item.context._id } })
    }
    await sync(items[0])
    const { navigation, events } = mountNavigation(items, 0, items[0], (event) => {
      if (event.type === 'select' && event.detail != null) application.select({ detail: event.detail })
      if (event.type === 'clear') application.close()
    })

    await navigation.remove(items[0])
    expect(navigateToDoc).toHaveBeenCalledWith(items[1], documentFor(items[1]), undefined)
    await sync(items[1])
    expect(application.doc?._id).toBe('shared')
    expect(application.context).toEqual(items[1].context)
    expect(findOne).toHaveBeenCalledTimes(1)

    navigation.setOpened(application.doc, application.context)
    await navigation.remove(items[1])
    expect(navigation.items).toEqual([])
    expect(events.map(({ type }) => type)).toEqual(['select', 'clear'])
    expect(closeDoc).toHaveBeenCalledTimes(1)
    expect(application.doc).toBeUndefined()
    expect(application.context).toBeUndefined()
  })

  test('a legacy context matches independently of the opened document ID', async () => {
    const items = [legacy('message'), modern('card')]
    const { navigation, events } = mountNavigation(items)
    navigation.setOpened(
      documentFor(legacy('channel')),
      (items[0] as Extract<NavigationItem, { type: 'legacy' }>).context
    )
    await navigation.remove(items[0])
    expect(events[0]?.detail?.navItem).toEqual(items[1])
  })

  test('a legacy opened document still matches before its context has loaded', async () => {
    const items = [legacy('a'), modern('b')]
    const { navigation, events } = mountNavigation(items)
    navigation.setOpened(documentFor(items[0]))
    await navigation.remove(items[0])
    expect(events[0]?.detail?.navItem).toEqual(items[1])
  })

  test('another legacy context for the same document does not replace the opened context', async () => {
    const items = [legacy('shared', 'first'), legacy('shared', 'second'), modern('card')]
    const { navigation, events } = mountNavigation(items, 1, items[1])
    await navigation.remove(items[0])
    expect(navigation.items).toEqual(items.slice(1))
    expect(navigation.selection).toBe(0)
    expect(events).toEqual([])
  })

  test('a modern opened document matches even with a legacy context present', async () => {
    const items = [modern('a'), legacy('b')]
    const { navigation, events } = mountNavigation(items)
    navigation.setOpened(documentFor(items[0]), legacy('other').context)
    await navigation.remove(items[0])
    expect(events[0]?.detail?.navItem).toEqual(items[1])
  })

  test.each([false, true])('resolves the adjacent document before opening (cached: %s)', async (cached) => {
    const items = [modern('a'), legacy('b')]
    const { navigation, events, findOne } = mountNavigation(items, 0, items[0])
    const nextDoc = documentFor(items[1])
    let resolveDocument: (doc: Doc) => void = () => {}
    if (cached) navigation.cache(nextDoc)
    else
      {findOne.mockImplementation(
        async () =>
          await new Promise((resolve) => {
            resolveDocument = resolve
          })
      )}
    const pending = navigation.remove(items[0])
    await new Promise((resolve) =>
      setTimeout(() => {
        resolve(undefined)
      }, 0)
    )
    if (!cached) {
      expect(events).toEqual([])
      expect(findOne).toHaveBeenCalledWith(items[1]._class, { _id: items[1]._id })
      resolveDocument(nextDoc)
    }
    await pending
    expect(findOne).toHaveBeenCalledTimes(cached ? 0 : 1)
    expect(events[0]?.detail?.doc).toEqual(nextDoc)
  })

  test.each([false, true])('selects once when live queries update before/after removal (early: %s)', async (early) => {
    const items = [modern('a'), legacy('b'), modern('c')]
    const { navigation, events, remove } = mountNavigation(items, 1, items[1])
    if (early)
      {remove.mockImplementation(async () => {
        navigation.setItems([{ ...items[0] }, { ...items[2] }])
      })}
    await navigation.remove(items[1])
    if (!early) navigation.setItems([items[0], items[2]])
    expect(events).toEqual([{ type: 'select', detail: { navItem: items[2], doc: documentFor(items[2]) } }])
    expect(navigation.items).toEqual([items[0], items[2]])
  })

  test('keeps the original adjacent context when live updates reorder surviving rows', async () => {
    const items = [modern('a'), legacy('shared', 'removed'), legacy('shared', 'next'), modern('d')]
    const { navigation, events, remove, select } = mountNavigation(items, 1, items[1])
    remove.mockImplementation(async () => {
      navigation.setItems([{ ...items[3] }, { ...items[0] }, { ...items[2] }])
    })
    await navigation.remove(items[1])
    expect(events[0]?.detail?.navItem).toEqual(items[2])
    expect(navigation.selection).toBe(2)
    expect(select).toHaveBeenCalledWith(2)
  })

  test('adjusts the adjacent index when a preceding row disappears during removal', async () => {
    const items = [modern('a'), legacy('b'), modern('c'), legacy('d')]
    const { navigation, events, remove, select } = mountNavigation(items, 1, items[1])
    remove.mockImplementation(async () => {
      navigation.setItems([{ ...items[2] }, { ...items[3] }])
    })
    await navigation.remove(items[1])
    expect(events[0]?.detail?.navItem).toEqual(items[2])
    expect(navigation.selection).toBe(0)
    expect(select).toHaveBeenCalledWith(0)
  })

  test('ignores repeated removal while a request is pending', async () => {
    const items = [modern('a'), legacy('b')]
    const { navigation, remove } = mountNavigation(items, 0, items[0])
    let complete: () => void = () => {}
    remove.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        complete = resolve
      })
    })
    const pending = navigation.remove(items[0])
    await navigation.keydown(key('Backspace'))
    expect(remove).toHaveBeenCalledTimes(1)
    expect(navigation.removing).toEqual(items[0])
    complete()
    await pending
    expect(navigation.removing).toBeUndefined()
  })

  test('a failed removal preserves rows and selection, reports the error and permits retry', async () => {
    const items = [modern('a'), legacy('b')]
    const { navigation, remove, events, handleError } = mountNavigation(items, 0, items[0])
    remove.mockRejectedValueOnce('offline')
    await navigation.remove(items[0])
    expect(navigation.items).toEqual(items)
    expect(navigation.selection).toBe(0)
    expect(events).toEqual([])
    expect(handleError.mock.calls[0][0].message).toBe('offline')
    expect(navigation.removing).toBeUndefined()
    await navigation.remove(items[0])
    expect(events[0]?.detail?.navItem).toEqual(items[1])
  })

  test('a missing adjacent document clears the stale panel', async () => {
    const items = [modern('a'), legacy('b')]
    const { navigation, findOne, events } = mountNavigation(items, 0, items[0])
    findOne.mockResolvedValue(undefined)
    await navigation.remove(items[0])
    expect(events).toEqual([{ type: 'clear', detail: undefined }])
  })

  test('ignores Backspace on an empty inbox and removal of a stale row', async () => {
    const { navigation, remove, events } = mountNavigation([])
    await navigation.keydown(key('Backspace'))
    await navigation.remove(modern('stale'))
    expect(remove).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })
})
