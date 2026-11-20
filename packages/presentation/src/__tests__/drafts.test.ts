/**
 * @jest-environment jsdom
 */

// SPDX-License-Identifier: EPL-2.0

import { DraftController } from '../drafts'

jest.mock('@hcengineering/ui', () => ({
  fetchMetadataLocalStorage: () => undefined,
  setMetadataLocalStorage: () => {}
}))

jest.mock('../plugin', () => ({
  __esModule: true,
  default: { metadata: { Draft: 'test-drafts' } }
}))

jest.mock('svelte/store', () => ({
  writable: <T,>(initial: T) => {
    let value = initial
    const subscribers = new Set<(value: T) => void>()
    return {
      subscribe: (subscriber: (value: T) => void) => {
        subscriber(value)
        subscribers.add(subscriber)
        return () => subscribers.delete(subscriber)
      },
      set: (next: T) => {
        value = next
        subscribers.forEach((subscriber) => subscriber(value))
      }
    }
  }
}))

describe('DraftController', () => {
  it('removes a draft after a nested attribute is edited and cleared', () => {
    const controller = new DraftController<Record<string, unknown>>('test-draft')
    const empty = { issueType: { withDefault: 'default' } }

    try {
      controller.save({ issueType: { withDefault: 'default', explicit: 'value' } }, empty)
      expect(controller.get()).toBeDefined()

      controller.save({ issueType: { withDefault: 'default', explicit: undefined } }, empty)
      expect(controller.get()).toBeUndefined()
    } finally {
      controller.destroy()
    }
  })
})
