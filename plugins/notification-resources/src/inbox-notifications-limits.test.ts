// SPDX-License-Identifier: EPL-2.0

import { get } from 'svelte/store'

interface QueryCall {
  docClass: string
  callback: (result: unknown[]) => void
  options?: {
    limit?: number
  }
}

let onClientCallback: ((client: never, account: never) => Promise<void>) | undefined
const queryCalls: QueryCall[] = []

jest.mock('svelte/store', () => {
  function writable<T> (initialValue: T): {
    set: (value: T) => void
    subscribe: (callback: (value: T) => void) => () => void
    update: (callback: (value: T) => T) => void
  } {
    let value = initialValue
    const subscribers = new Set<(value: T) => void>()

    return {
      set: (newValue) => {
        value = newValue
        subscribers.forEach((callback) => {
          callback(value)
        })
      },
      subscribe: (callback) => {
        subscribers.add(callback)
        callback(value)
        return () => subscribers.delete(callback)
      },
      update: (callback) => {
        value = callback(value)
        subscribers.forEach((subscriber) => {
          subscriber(value)
        })
      }
    }
  }

  return {
    derived: <T> (
      stores: Array<{ subscribe: (callback: (value: unknown) => void) => () => void }>,
      callback: (values: unknown[]) => T,
      initialValue: T
    ) => {
      const derivedStore = writable(initialValue)
      const values: unknown[] = []

      stores.forEach((store, index) => {
        store.subscribe((value) => {
          values[index] = value
          if (values.length === stores.length) {
            derivedStore.set(callback(values))
          }
        })
      })

      return derivedStore
    },
    get: <T> (store: { subscribe: (callback: (value: T) => void) => () => void }): T => {
      let value: T | undefined
      const unsubscribe = store.subscribe((newValue) => {
        value = newValue
      })
      unsubscribe()
      return value as T
    },
    writable
  }
})

jest.mock('@hcengineering/activity', () => ({
  __esModule: true,
  default: {
    class: {
      ActivityMessage: 'activity-message'
    }
  }
}))

jest.mock('@hcengineering/core', () => ({
  __esModule: true,
  default: {},
  AccountRole: {
    ReadOnlyGuest: 'read-only-guest'
  },
  SortingOrder: {
    Descending: 'descending'
  },
  getCurrentAccount: jest.fn(),
  toIdMap: jest.fn(() => new Map())
}))

jest.mock('@hcengineering/notification', () => ({
  __esModule: true,
  default: {
    class: {
      ActivityInboxNotification: 'activity-inbox-notification',
      CommonInboxNotification: 'common-inbox-notification',
      DocNotifyContext: 'doc-notify-context'
    }
  }
}))

jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  createQuery: jest.fn(() => ({
    query: jest.fn(
      (docClass: string, _query: unknown, callback: (result: unknown[]) => void, options?: { limit?: number }) => {
        queryCalls.push({ docClass, callback, options })
      }
    )
  })),
  getClient: jest.fn(),
  onClient: jest.fn((callback: (client: never, account: never) => Promise<void>) => {
    onClientCallback = callback
  })
}))

jest.mock('./utils', () => ({
  isActivityNotification: jest.fn()
}))

import { InboxNotificationsClientImpl } from './inboxNotificationsClient'

function getLastQueryCall (docClass: string): QueryCall {
  const queryCall = queryCalls.filter((call) => call.docClass === docClass).at(-1)

  if (queryCall === undefined) {
    throw new Error(`Expected a query for ${docClass}`)
  }

  return queryCall
}

describe('InboxNotificationsClientImpl pagination', () => {
  beforeEach(() => {
    queryCalls.length = 0
    onClientCallback = undefined
  })

  it('loads another activity page while retaining all common notifications', async () => {
    const inboxClient = InboxNotificationsClientImpl.createClient()
    const account = { uuid: 'account-id' }

    await onClientCallback?.({} as unknown as never, account as never)

    const initialActivityQuery = getLastQueryCall('activity-inbox-notification')
    expect(initialActivityQuery.options?.limit).toBe(1000)
    expect(getLastQueryCall('common-inbox-notification').options).toBeUndefined()

    initialActivityQuery.callback(Array.from({ length: 1000 }, () => ({})))
    expect(get(inboxClient.hasMoreInboxNotifications)).toBe(true)

    inboxClient.loadMoreInboxNotifications()

    expect(getLastQueryCall('activity-inbox-notification').options?.limit).toBe(2000)
    expect(getLastQueryCall('common-inbox-notification').options).toBeUndefined()

    getLastQueryCall('activity-inbox-notification').callback([])
    expect(get(inboxClient.hasMoreInboxNotifications)).toBe(false)
  })
})
