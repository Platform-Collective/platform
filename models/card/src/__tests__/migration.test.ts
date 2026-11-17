// SPDX-License-Identifier: EPL-2.0

import card from '@hcengineering/card'
import core, { Hierarchy } from '@hcengineering/core'
import view from '@hcengineering/view'
import { addShowAllVersionsViewOption, makeConfigSortable } from '../migration'

function upgradeClient (viewlets: any[]): { client: any, txes: any[] } {
  const txes: any[] = []
  const client: any = {
    getHierarchy: () => Object.assign(new Hierarchy(), { getDescendants: () => [] }),
    getModel: () => undefined,
    findAll: jest.fn(async (cls: unknown) => (cls === card.class.MasterTag ? [{ _id: 'tag' }] : viewlets)),
    findOne: jest.fn(async () => undefined),
    tx: jest.fn(async (tx: any) => {
      txes.push(tx)
      const doc = viewlets.find((v) => v._id === tx.objectId)
      if (doc !== undefined) Object.assign(doc, tx.operations)
      return {}
    })
  }
  return { client, txes }
}

describe('card viewlet migrations', () => {
  it('skips viewlets without an id and makes identified viewlets sortable only once', async () => {
    const { client, txes } = upgradeClient([
      { attachTo: 'tag', configOptions: {} },
      { _id: 'viewlet', _class: view.class.Viewlet, space: core.space.Model, configOptions: { strict: true } }
    ])
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await makeConfigSortable(client)
      await makeConfigSortable(client)
      expect(txes).toHaveLength(1)
      expect(txes[0]).toMatchObject({
        objectId: 'viewlet',
        objectClass: view.class.Viewlet,
        objectSpace: core.space.Model,
        operations: { configOptions: { strict: true, sortable: true } }
      })
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('preserves options, skips missing ids and does not update twice', async () => {
    const existing = { key: 'custom', type: 'toggle', defaultValue: true }
    const { client, txes } = upgradeClient([
      { attachTo: card.class.Card },
      {
        _id: 'viewlet',
        _class: view.class.Viewlet,
        space: core.space.Model,
        attachTo: card.class.Card,
        viewOptions: { groupBy: ['status'], orderBy: [['rank', 1]], other: [existing] }
      }
    ])
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await addShowAllVersionsViewOption(client)
      await addShowAllVersionsViewOption(client)
      expect(txes).toHaveLength(1)
      expect(txes[0]).toMatchObject({
        objectId: 'viewlet',
        objectClass: view.class.Viewlet,
        objectSpace: core.space.Model,
        operations: {
          viewOptions: {
            groupBy: ['status'],
            orderBy: [['rank', 1]],
            other: [existing, expect.objectContaining({ key: 'showAllVersions' })]
          }
        }
      })
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
