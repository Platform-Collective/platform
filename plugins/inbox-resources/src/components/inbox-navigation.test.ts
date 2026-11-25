// SPDX-License-Identifier: EPL-2.0

import type { Doc, Ref, Class } from '@hcengineering/core'
import type { Card } from '@hcengineering/card'
import type { NotificationContext } from '@hcengineering/communication-types'
import type { DocNotifyContext } from '@hcengineering/notification'
import type { NavigationItem } from '../type'
import {
  getRemovalSelection,
  isNavigationItemRemovalPending,
  isOpenedNavigationItem,
  NavigationRemovalQueue,
  shouldLookupLegacyContext,
  shouldReselectNavigationItem,
  type RemovalSelection
} from './inbox-navigation'

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

function removeSelectedItem (
  items: NavigationItem[],
  index: number,
  selection = index,
  fromKeyboard = false,
  currentItems = items
): RemovalSelection {
  const removed = items[index]
  const shouldReselect =
    fromKeyboard ||
    isOpenedNavigationItem(removed, documentFor(removed), removed.type === 'legacy' ? removed.context : undefined)
  return getRemovalSelection(items, currentItems, removed, selection, shouldReselect)
}

describe('inbox removal navigation (#7335 and #7350)', () => {
  const factories: Array<(id: string) => NavigationItem> = [modern, legacy]

  describe.each(factories)('%p entries', (makeItem) => {
    test.each([0, 1, 2])('checkbox removal at index %i selects the adjacent entry', (index) => {
      const items = ['a', 'b', 'c'].map((id) => makeItem(id))
      const result = removeSelectedItem(items, index)
      const next = items[index + 1] ?? items[index - 1]
      expect(result).toEqual({
        items: items.filter((_, itemIndex) => itemIndex !== index),
        selection: Math.min(index, 1),
        nextItem: next
      })
    })

    test('removing the final opened entry has no next selection', () => {
      const item = makeItem('a')
      const result = removeSelectedItem([item], 0)
      expect(result).toEqual({ items: [], selection: 0, nextItem: undefined })
    })

    test.each([false, true])('Backspace selects the next keyboard entry (other document open: %s)', (openOther) => {
      const items = ['a', 'b', 'c'].map((id) => makeItem(id))
      const opened = openOther ? items[0] : undefined
      expect(
        isOpenedNavigationItem(
          items[1],
          opened == null ? undefined : documentFor(opened),
          opened?.type === 'legacy' ? opened.context : undefined
        )
      ).toBe(false)
      const result = getRemovalSelection(items, items, items[1], 1, true)
      expect(result.nextItem).toEqual(items[2])
      expect(result.selection).toBe(1)
    })

    test('Backspace on the last keyboard entry selects its predecessor', () => {
      const items = ['a', 'b'].map((id) => makeItem(id))
      const result = getRemovalSelection(items, items, items[1], 1, true)
      expect(result.nextItem).toEqual(items[0])
      expect(result.selection).toBe(0)
    })

    test('Backspace on the only keyboard entry has no next selection', () => {
      const items = [makeItem('a')]
      const result = getRemovalSelection(items, items, items[0], 0, true)
      expect(result).toEqual({ items: [], selection: 0, nextItem: undefined })
    })

    test('removing a preceding checkbox keeps the keyboard selection on the same entry', () => {
      const items = ['a', 'b', 'c'].map((id) => makeItem(id))
      const shouldReselect = isOpenedNavigationItem(
        items[0],
        documentFor(items[2]),
        items[2].type === 'legacy' ? items[2].context : undefined
      )
      const result = getRemovalSelection(items, items, items[0], 2, shouldReselect)
      expect(result).toEqual({ items: items.slice(1), selection: 1, nextItem: undefined })
      expect(result.items[result.selection]).toEqual(items[2])
    })

    test('removing a following checkbox preserves the opened entry and keyboard index', () => {
      const items = ['a', 'b', 'c'].map((id) => makeItem(id))
      const shouldReselect = isOpenedNavigationItem(
        items[2],
        documentFor(items[0]),
        items[0].type === 'legacy' ? items[0].context : undefined
      )
      const result = getRemovalSelection(items, items, items[2], 0, shouldReselect)
      expect(result).toEqual({ items: items.slice(0, 2), selection: 0, nextItem: undefined })
    })
  })

  test.each([modern, legacy])(
    'an opened checkbox row is matched independently of the keyboard index (%p)',
    (makeItem) => {
      const items = ['a', 'b', 'c'].map((id) => makeItem(id))
      const result = removeSelectedItem(items, 0, 2)
      expect(result.nextItem).toEqual(items[1])
      expect(result.selection).toBe(0)
      expect(items.map((item) => item._id)).toEqual(['a', 'b', 'c'])
    }
  )

  test('removing the second legacy context for a shared document selects the following row', () => {
    const items = [legacy('shared', 'first'), legacy('shared', 'second'), modern('c')]
    const result = removeSelectedItem(items, 1)
    expect(result.nextItem).toEqual(items[2])
    expect(result.items).toEqual([items[0], items[2]])
  })

  test.each([2, 3])(
    'removing %i legacy contexts for the same document advances and clears the final entry',
    (count) => {
      const items = Array.from({ length: count }, (_, index) => legacy('shared', `context-${index}`))
      let currentItems: NavigationItem[] = items
      let selection = 0

      for (let index = 0; index < items.length; index++) {
        const removed = items[index]
        const shouldReselect = isOpenedNavigationItem(removed, documentFor(removed), removed.context)
        const result = getRemovalSelection(items.slice(index), currentItems, removed, selection, shouldReselect)
        expect(result.nextItem).toEqual(items[index + 1])
        expect(result.items).toEqual(items.slice(index + 1))
        currentItems = result.items
        selection = result.selection
      }
      expect(currentItems).toEqual([])
      expect(selection).toBe(0)
    }
  )

  test('a legacy context matches independently of the opened document ID', () => {
    const removed = legacy('message')
    const items = [removed, modern('card')]
    const openedDoc = documentFor(legacy('channel'))
    const shouldReselect = isOpenedNavigationItem(removed, openedDoc, removed.context)
    const result = getRemovalSelection(items, items, removed, 0, shouldReselect)
    expect(result.nextItem).toEqual(items[1])
  })

  test('a legacy opened document still matches before its context has loaded', () => {
    const items = [legacy('a'), modern('b')]
    const shouldReselect = isOpenedNavigationItem(items[0], documentFor(items[0]), undefined)
    const result = getRemovalSelection(items, items, items[0], 0, shouldReselect)
    expect(result.nextItem).toEqual(items[1])
  })

  test('another legacy context for the same document does not replace the opened context', () => {
    const removed = legacy('shared', 'first')
    const opened = legacy('shared', 'second')
    const items = [removed, opened, modern('card')]
    const shouldReselect = isOpenedNavigationItem(removed, documentFor(opened), opened.context)
    const result = getRemovalSelection(items, items, removed, 1, shouldReselect)
    expect(result).toEqual({ items: items.slice(1), selection: 0, nextItem: undefined })
  })

  test('a modern opened document matches even with a legacy context present', () => {
    const items = [modern('a'), legacy('b')]
    const shouldReselect = isOpenedNavigationItem(items[0], documentFor(items[0]), legacy('other').context)
    const result = getRemovalSelection(items, items, items[0], 0, shouldReselect)
    expect(result.nextItem).toEqual(items[1])
  })

  test.each([false, true])('selects once when live queries update before/after removal (early: %s)', (early) => {
    const items = [modern('a'), legacy('b'), modern('c')]
    const currentItems = early ? [{ ...items[0] }, { ...items[2] }] : items
    const result = removeSelectedItem(items, 1, 1, false, currentItems)
    expect(result.nextItem).toEqual(items[2])
    expect(result.items).toEqual([items[0], items[2]])
  })

  test('keeps the original adjacent context when live updates reorder surviving rows', () => {
    const items = [modern('a'), legacy('shared', 'removed'), legacy('shared', 'next'), modern('d')]
    const currentItems = [{ ...items[3] }, { ...items[0] }, { ...items[2] }]
    const result = removeSelectedItem(items, 1, 1, false, currentItems)
    expect(result.nextItem).toEqual(items[2])
    expect(result.selection).toBe(2)
  })

  test('adjusts the adjacent index when a preceding row disappears during removal', () => {
    const items = [modern('a'), legacy('b'), modern('c'), legacy('d')]
    const result = removeSelectedItem(items, 1, 1, false, [{ ...items[2] }, { ...items[3] }])
    expect(result.nextItem).toEqual(items[2])
    expect(result.selection).toBe(0)
  })

  test('ignores a stale row without changing the surviving items', () => {
    const items = [modern('a'), legacy('b')]
    const result = getRemovalSelection(items, items, modern('stale'), 1, false)
    expect(result).toEqual({ items, selection: 1, nextItem: undefined })
  })
})

interface RemovalState {
  removing: NavigationItem | undefined
  queued: NavigationItem[]
}

describe('recreated navigation rows', () => {
  test('keeps automatic successor selection by type and context ID', () => {
    const first = legacy('shared', 'first')
    const second = legacy('shared', 'second')
    const items = [modern('a'), first, second]
    const refreshed = [modern('a'), legacy('shared', 'first'), legacy('shared', 'second')]
    const openedDoc = documentFor(first)

    expect(shouldReselectNavigationItem(refreshed[0], false, items[0], documentFor(items[0]), undefined)).toBe(true)
    expect(shouldReselectNavigationItem(refreshed[1], false, first, openedDoc, first.context)).toBe(true)
    expect(shouldReselectNavigationItem(refreshed[2], false, first, openedDoc, first.context)).toBe(false)
  })

  test('keeps removal progress on active and queued rows', () => {
    const active = legacy('shared', 'first')
    const queued = [legacy('shared', 'second')]

    expect(isNavigationItemRemovalPending(legacy('shared', 'first'), active, queued)).toBe(true)
    expect(isNavigationItemRemovalPending(legacy('shared', 'second'), active, queued)).toBe(true)
    expect(isNavigationItemRemovalPending(modern('a'), active, queued)).toBe(false)
    expect(isNavigationItemRemovalPending(modern('a'), modern('a'), [])).toBe(true)
  })
})

describe('NavigationRemovalQueue', () => {
  test('queues fast removals and runs them in click order', async () => {
    const items = [modern('a'), legacy('b'), modern('c')]
    let completeFirst: () => void = () => {}
    const remove = jest.fn(async (item: NavigationItem) => {
      if (item === items[0]) {
        await new Promise<void>((resolve) => {
          completeFirst = resolve
        })
      }
    })
    const states: RemovalState[] = []
    const onChange = (removing: NavigationItem | undefined, queued: NavigationItem[]): void => {
      states.push({ removing, queued })
    }
    const queue = new NavigationRemovalQueue(remove, onChange, () => items)

    const first = queue.enqueue(items[0], false)
    const second = queue.enqueue(items[1], false)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(states[states.length - 1]).toEqual({ removing: items[0], queued: [items[1]] })

    completeFirst()
    await Promise.all([first, second])
    expect(remove.mock.calls.map(([item]) => item)).toEqual(items.slice(0, 2))
    expect(states[states.length - 1]).toEqual({ removing: undefined, queued: [] })
  })

  test('does not queue the same row twice', async () => {
    const item = modern('a')
    let complete: () => void = () => {}
    const remove = jest.fn(async () => {
      await new Promise<void>((resolve) => {
        complete = resolve
      })
    })
    const queue = new NavigationRemovalQueue(
      remove,
      () => {},
      () => [item]
    )
    const first = queue.enqueue(item, false)
    const duplicate = queue.enqueue(item, true)
    expect(remove).toHaveBeenCalledTimes(1)
    complete()
    await Promise.all([first, duplicate])
    expect(remove).toHaveBeenCalledTimes(1)
  })

  test('deduplicates recreated rows without merging legacy contexts for the same document', async () => {
    const items = [modern('a'), legacy('shared', 'first'), legacy('shared', 'second')]
    const refreshed = [modern('a'), legacy('shared', 'first'), legacy('shared', 'second')]
    let completeFirst: () => void = () => {}
    const remove = jest.fn(async (item: NavigationItem) => {
      if (item._id === items[0]._id) {
        await new Promise<void>((resolve) => {
          completeFirst = resolve
        })
      }
    })
    const states: RemovalState[] = []
    const onChange = (removing: NavigationItem | undefined, queued: NavigationItem[]): void => {
      states.push({ removing, queued })
    }
    const queue = new NavigationRemovalQueue(remove, onChange, () => items)

    const removals = items.map(async (item) => {
      await queue.enqueue(item, false)
    })
    const duplicates = refreshed.map(async (item) => {
      await queue.enqueue(item, true)
    })
    expect(remove).toHaveBeenCalledTimes(1)
    expect(states[states.length - 1]).toEqual({ removing: items[0], queued: items.slice(1) })

    completeFirst()
    await Promise.all([...removals, ...duplicates])
    expect(remove.mock.calls.map(([item]) => item)).toEqual(items)
  })

  test('preserves the keyboard origin of a queued removal', async () => {
    const items = [modern('a'), legacy('b')]
    let completeFirst: () => void = () => {}
    const remove = jest.fn(async (item: NavigationItem) => {
      if (item === items[0]) {
        await new Promise<void>((resolve) => {
          completeFirst = resolve
        })
      }
    })
    const queue = new NavigationRemovalQueue(
      remove,
      () => {},
      () => items
    )
    const first = queue.enqueue(items[0], false)
    const second = queue.enqueue(items[1], true)
    completeFirst()
    await Promise.all([first, second])
    expect(remove.mock.calls[1]).toEqual([items[1], true])
  })

  test.each([true, false])('skips a queued legacy row that vanishes (Backspace: %s)', async (fromKeyboard) => {
    const first = modern('first')
    const vanished = legacy('shared', 'removed-context')
    const opened = legacy('shared', 'opened-context')
    const last = modern('last')
    let items: NavigationItem[] = [first, vanished, opened, last]
    let completeFirst: () => void = () => {}
    const firstRemoval = new Promise<void>((resolve) => {
      completeFirst = resolve
    })
    const remove = jest.fn<Promise<void>, [NavigationItem, boolean]>(async (item) => {
      if (item === first) await firstRemoval
    })
    const onChange = jest.fn(() => {})
    const queue = new NavigationRemovalQueue(remove, onChange, () => items)

    const draining = queue.enqueue(first, false)
    await queue.enqueue(vanished, fromKeyboard)
    await queue.enqueue(last, false)
    expect(onChange).toHaveBeenLastCalledWith(first, [vanished, last])

    const refreshedLast = modern('last')
    items = [opened, refreshedLast]
    completeFirst()
    await draining

    expect(remove.mock.calls).toHaveLength(2)
    expect(remove.mock.calls[0]).toEqual([first, false])
    expect(remove.mock.calls[1][0]).toBe(refreshedLast)
    expect(onChange).not.toHaveBeenCalledWith(vanished, expect.anything())
    expect(onChange).toHaveBeenLastCalledWith(undefined, [])
  })
})

describe('legacy context lookup', () => {
  const item = legacy('doc', 'context-a')

  test('looks up a context when none is open', () => {
    expect(shouldLookupLegacyContext(item._id, undefined, undefined)).toBe(true)
  })

  test('skips the lookup when the open context matches the document', () => {
    expect(shouldLookupLegacyContext(item._id, undefined, item.context)).toBe(false)
  })

  test('skips the lookup when the open context matches the query', () => {
    expect(shouldLookupLegacyContext(item._id, item.context._id, item.context)).toBe(false)
  })

  test('looks up a different queried context', () => {
    expect(shouldLookupLegacyContext(item._id, legacy('doc', 'context-b').context._id, item.context)).toBe(true)
  })

  test('looks up a context for a different document', () => {
    expect(shouldLookupLegacyContext(modern('other')._id, undefined, item.context)).toBe(true)
  })
})
