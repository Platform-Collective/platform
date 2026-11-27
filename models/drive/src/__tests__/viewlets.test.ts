// SPDX-License-Identifier: EPL-2.0

import core, { SortingOrder, TxProcessor, type TxCreateDoc } from '@hcengineering/core'
import { Builder } from '@hcengineering/model'
import { createModel as createCoreModel } from '@hcengineering/model-core'
import view, { type Viewlet } from '@hcengineering/model-view'
import drive, { createModel } from '../index'

describe('Drive table ordering', () => {
  let table: Viewlet

  beforeAll(() => {
    const builder = new Builder()
    createCoreModel(builder)
    createModel(builder)
    const tx = builder
      .getTxes()
      .find(
        (tx): tx is TxCreateDoc<Viewlet> =>
          tx._class === core.class.TxCreateDoc && (tx as TxCreateDoc<Viewlet>).objectId === drive.viewlet.FileTable
      )
    if (tx === undefined) {
      throw new Error('Drive file table viewlet was not registered')
    }
    table = TxProcessor.createDoc2Doc(tx)
  })

  it('enables the ordering menu with name, size and last modified choices', () => {
    expect(table.descriptor).toBe(view.viewlet.Table)
    expect(table.viewOptions).toEqual({
      groupBy: [],
      orderBy: [
        ['title', SortingOrder.Ascending],
        ['$lookup.file.size', SortingOrder.Ascending],
        ['$lookup.file.lastModified', SortingOrder.Descending]
      ],
      other: []
    })
  })

  it('uses displayed columns and the file version lookup for ordering', () => {
    expect(table.options?.lookup).toEqual({ file: drive.class.FileVersion })
    expect(table.viewOptions?.orderBy).toHaveLength(3)
    for (const [key] of table.viewOptions?.orderBy ?? []) {
      expect(
        table.config.some((column) => (typeof column === 'string' ? column === key : column.sortingKey === key))
      ).toBe(true)
    }
  })
})
