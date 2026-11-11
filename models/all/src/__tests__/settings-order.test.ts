// SPDX-License-Identifier: EPL-2.0

import core, { type Doc, type Ref, type Class, type Tx, type TxCreateDoc } from '@hcengineering/core'
import setting from '@hcengineering/model-setting'
import buildModel from '..'

interface CategoryAttributes {
  name: string
  order?: number
}

function categoriesOf (txes: Tx[], _class: Ref<Class<Doc>>): CategoryAttributes[] {
  return txes
    .filter((tx): tx is TxCreateDoc<Doc> => tx._class === core.class.TxCreateDoc)
    .filter((tx) => tx.objectClass === _class)
    .map((tx) => tx.attributes as unknown as CategoryAttributes)
}

function duplicateOrders (categories: CategoryAttributes[]): string[] {
  const byOrder = new Map<number, string[]>()
  for (const category of categories) {
    if (category.order === undefined) continue
    byOrder.set(category.order, [...(byOrder.get(category.order) ?? []), category.name])
  }
  return Array.from(byOrder.entries())
    .filter(([, names]) => names.length > 1)
    .map(([order, names]) => `${order}: ${names.sort().join(', ')}`)
}

describe('settings navigation order', () => {
  const txes = buildModel().getTxes()

  it.each([
    ['personal settings', setting.class.SettingsCategory],
    ['workspace settings', setting.class.WorkspaceSettingCategory]
  ])('gives every page in the %s list its own position', (_, _class) => {
    const categories = categoriesOf(txes, _class)
    expect(categories.length).toBeGreaterThan(0)
    expect(duplicateOrders(categories)).toEqual([])
  })
})
