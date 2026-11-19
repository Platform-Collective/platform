// SPDX-License-Identifier: EPL-2.0

import type { TxOperations } from '@hcengineering/core'
import { get } from 'svelte/store'

jest.mock('svelte/store', () => ({
  writable: (initial: unknown) => {
    let value = initial
    return {
      set: (next: unknown) => {
        value = next
      },
      subscribe: (callback: (current: unknown) => void) => {
        callback(value)
        return () => {}
      }
    }
  },
  get: (store: { subscribe: (callback: (current: unknown) => void) => () => void }) => {
    let value: unknown
    const unsubscribe = store.subscribe((current) => {
      value = current
    })
    unsubscribe()
    return value
  }
}))

jest.mock('@hcengineering/presentation', () => ({ createQuery: jest.fn(), getClient: jest.fn() }), { virtual: true })
jest.mock('../plugin', () => ({
  __esModule: true,
  default: { class: { ProjectNavigatorPreference: 'tracker:class:ProjectNavigatorPreference' } }
}))

import {
  isShowingProjectOwners,
  navigatorPreferenceTarget,
  setShowProjectOwners,
  showProjectOwners
} from '../project-owners'

describe('project owners in the navigator', () => {
  it('shows owners until the account switched them off', () => {
    expect(isShowingProjectOwners([])).toBe(true)
    expect(isShowingProjectOwners([{ showProjectOwners: false }])).toBe(false)
    expect(isShowingProjectOwners([{ showProjectOwners: true }])).toBe(true)
  })

  it('stores the first choice as a private preference of the account', async () => {
    const client = { findOne: jest.fn().mockResolvedValue(undefined), createDoc: jest.fn(), updateDoc: jest.fn() }
    await setShowProjectOwners(client as unknown as TxOperations, false)
    expect(client.findOne).toHaveBeenCalledWith('tracker:class:ProjectNavigatorPreference', {
      attachedTo: navigatorPreferenceTarget
    })
    expect(client.createDoc).toHaveBeenCalledWith('tracker:class:ProjectNavigatorPreference', 'core:space:Workspace', {
      attachedTo: navigatorPreferenceTarget,
      showProjectOwners: false
    })
    expect(get(showProjectOwners)).toBe(false)
  })

  it('serializes simultaneous first choices so only one preference is created', async () => {
    const pref = {
      _id: 'pref',
      _class: 'tracker:class:ProjectNavigatorPreference',
      space: 'core:space:Workspace',
      showProjectOwners: false
    }
    let signalFindOne!: () => void
    const findOneCalled = new Promise<void>((resolve) => {
      signalFindOne = resolve
    })
    let resolveCreate!: () => void
    const createPending = new Promise<void>((resolve) => {
      resolveCreate = resolve
    })
    const client = {
      findOne: jest
        .fn()
        .mockImplementationOnce(async () => {
          signalFindOne()
          return undefined
        })
        .mockResolvedValueOnce(pref),
      createDoc: jest.fn().mockReturnValue(createPending),
      updateDoc: jest.fn()
    }

    const first = setShowProjectOwners(client as unknown as TxOperations, false)
    const second = setShowProjectOwners(client as unknown as TxOperations, false)
    await findOneCalled
    expect(client.findOne).toHaveBeenCalledTimes(1)
    resolveCreate()
    await Promise.all([first, second])
    expect(client.createDoc).toHaveBeenCalledTimes(1)
    expect(client.updateDoc).not.toHaveBeenCalled()
  })

  it('updates the existing preference instead of creating a second one', async () => {
    const pref = {
      _id: 'pref',
      _class: 'tracker:class:ProjectNavigatorPreference',
      space: 'core:space:Workspace',
      showProjectOwners: false
    }
    const client = { findOne: jest.fn().mockResolvedValue(pref), createDoc: jest.fn(), updateDoc: jest.fn() }
    await setShowProjectOwners(client as unknown as TxOperations, true)
    expect(client.createDoc).not.toHaveBeenCalled()
    expect(client.updateDoc).toHaveBeenCalledWith(pref._class, pref.space, pref._id, { showProjectOwners: true })
    expect(get(showProjectOwners)).toBe(true)
  })
})
