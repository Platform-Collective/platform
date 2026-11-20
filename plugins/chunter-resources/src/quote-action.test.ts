// SPDX-License-Identifier: EPL-2.0

import chunter, { type ChatMessage, type ThreadMessage } from '@hcengineering/chunter'
import { type Doc, type Ref } from '@hcengineering/core'
import { setPlatformStatus } from '@hcengineering/platform'
import { EmptyMarkup, markupToJSON } from '@hcengineering/text'
import type { Readable, Writable } from 'svelte/store'
import { getMessageLink } from './navigation'
import { canQuoteMessage, quoteMessage, registerQuoteInput } from './quote-action'
import { activeQuoteInputStore, quoteInputsStore } from './stores'

jest.mock('svelte/store', () => ({
  writable: <T> (value: T): Writable<T> => {
    const subscribers = new Set<(value: T) => void>()
    const set = (next: T): void => {
      value = next
      subscribers.forEach((run) => {
        run(value)
      })
    }
    return {
      set,
      update: (updater) => {
        set(updater(value))
      },
      subscribe: (run) => {
        subscribers.add(run)
        run(value)
        return () => {
          subscribers.delete(run)
        }
      }
    }
  },
  get: <T> (store: Readable<T>): T => {
    let value!: T
    store.subscribe((current) => {
      value = current
    })()
    return value
  }
}))

jest.mock('./navigation', () => ({ getMessageLink: jest.fn() }))
jest.mock('./utils', () => ({
  isThreadMessage: (message: ChatMessage) => message._class === chunter.class.ThreadMessage
}))
jest.mock('./stores', () => ({
  quoteInputsStore: jest.requireMock<typeof import('svelte/store')>('svelte/store').writable(new Set()),
  activeQuoteInputStore: jest.requireMock<typeof import('svelte/store')>('svelte/store').writable(undefined)
}))
jest.mock('@hcengineering/contact-resources', () => ({
  getPersonByPersonId: jest.fn(),
  getSocialIdByPersonId: jest.fn()
}))
jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  setPlatformStatus: jest.fn()
}))
jest.mock('@hcengineering/workbench-resources', () => ({
  isElementFromSidebar: (element: HTMLElement) => element.id === 'sidebar'
}))

describe('quote action', () => {
  const message = {
    _id: 'message',
    _class: chunter.class.ChatMessage,
    attachedTo: 'channel',
    message: EmptyMarkup
  } as unknown as ChatMessage
  const link = 'https://huly.app/message'

  beforeEach(() => {
    quoteInputsStore.set(new Set())
    activeQuoteInputStore.set(undefined)
    jest.mocked(getMessageLink).mockResolvedValue(link)
  })

  it('is unavailable without a composer for the message channel', async () => {
    const appendMarkup = jest.fn()
    registerQuoteInput({ objectId: 'other-channel' as Ref<Doc>, isSidebar: false, appendMarkup })

    expect(await canQuoteMessage(undefined)).toBe(false)
    expect(await canQuoteMessage(message)).toBe(false)
    await quoteMessage(message)
    expect(appendMarkup).not.toHaveBeenCalled()
  })

  it('appends a quote to the channel composer and unregisters it when closed', async () => {
    const appendMarkup = jest.fn()
    const unregister = registerQuoteInput({ objectId: message.attachedTo, isSidebar: false, appendMarkup })

    expect(await canQuoteMessage(message)).toBe(true)
    await quoteMessage(message)
    expect(appendMarkup).toHaveBeenCalledTimes(1)
    expect(markupToJSON(appendMarkup.mock.calls[0][0]).content?.[0].type).toBe('blockquote')

    unregister()
    expect(await canQuoteMessage(message)).toBe(false)
  })

  it('targets the sidebar composer when the same channel is open twice', async () => {
    const appendMain = jest.fn()
    const appendSidebar = jest.fn()
    registerQuoteInput({ objectId: message.attachedTo, isSidebar: false, appendMarkup: appendMain })
    registerQuoteInput({ objectId: message.attachedTo, isSidebar: true, appendMarkup: appendSidebar })

    await quoteMessage(message, { target: { id: 'sidebar' } } as unknown as Event)

    expect(appendSidebar).toHaveBeenCalledTimes(1)
    expect(appendMain).not.toHaveBeenCalled()
  })

  it('quotes a thread message into its channel rather than the thread composer', async () => {
    const appendMarkup = jest.fn()
    registerQuoteInput({ objectId: message.attachedTo, isSidebar: false, appendMarkup })
    const reply = {
      ...message,
      _class: chunter.class.ThreadMessage,
      attachedTo: 'parent-message',
      objectId: message.attachedTo
    } as unknown as ThreadMessage

    expect(await canQuoteMessage(reply)).toBe(true)
    await quoteMessage(reply)

    expect(appendMarkup).toHaveBeenCalledTimes(1)
  })

  it('keeps the source composer when a context menu renders outside the sidebar', async () => {
    const appendMain = jest.fn()
    const appendSidebar = jest.fn()
    const element = Object.assign(new EventTarget(), {
      contains: () => false
    }) as unknown as HTMLElement
    registerQuoteInput({ objectId: message.attachedTo, isSidebar: false, appendMarkup: appendMain })
    const unregister = registerQuoteInput({
      objectId: message.attachedTo,
      isSidebar: true,
      element,
      appendMarkup: appendSidebar
    })
    element.dispatchEvent(new Event('contextmenu'))

    await quoteMessage(message, { target: { id: 'popup' } } as unknown as Event)

    expect(appendSidebar).toHaveBeenCalledTimes(1)
    expect(appendMain).not.toHaveBeenCalled()
    unregister()
  })

  it('does not insert into a composer closed while the link is loading', async () => {
    const appendMarkup = jest.fn()
    const unregister = registerQuoteInput({ objectId: message.attachedTo, isSidebar: false, appendMarkup })
    jest.mocked(getMessageLink).mockImplementation(async () => {
      unregister()
      return link
    })

    await quoteMessage(message)

    expect(appendMarkup).not.toHaveBeenCalled()
  })

  it('reports link lookup failures without modifying the composer', async () => {
    const appendMarkup = jest.fn()
    registerQuoteInput({ objectId: message.attachedTo, isSidebar: false, appendMarkup })
    jest.mocked(getMessageLink).mockRejectedValue(new Error('Link lookup failed'))

    await quoteMessage(message)

    expect(appendMarkup).not.toHaveBeenCalled()
    expect(setPlatformStatus).toHaveBeenCalled()
  })
})
