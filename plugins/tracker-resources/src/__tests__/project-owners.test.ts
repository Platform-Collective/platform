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
  canHideProjectOwners,
  canShowProjectOwners,
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
    await expect(canShowProjectOwners()).resolves.toBe(true)
    await expect(canHideProjectOwners()).resolves.toBe(false)
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
    await expect(canHideProjectOwners()).resolves.toBe(true)
  })
})
