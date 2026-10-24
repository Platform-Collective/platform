// SPDX-License-Identifier: EPL-2.0

import { readFileSync } from 'fs'
import { join } from 'path'
import { runInNewContext } from 'vm'
import { parse } from 'svelte/compiler'

interface Column {
  label: string
  presenter: string
}

const source = readFileSync(join(__dirname, '../components/TagsView.svelte'), 'utf8').replace(
  /<script[\s\S]*?<\/script>/,
  ''
)
const table = parse(source).html.children?.find((node) => node.name === 'TableBrowser')
const config = table?.attributes.find((attribute: { name: string }) => attribute.name === 'config').value[0].expression
const tags = {
  string: { Usage: 'tags:string:Usage', CategoryLabel: 'tags:string:CategoryLabel' },
  component: {
    TagElementPresenter: 'TagElementPresenter',
    CategoryPresenter: 'CategoryPresenter',
    TagElementCountPresenter: 'TagElementCountPresenter'
  }
}

describe('TagsView column headings', () => {
  it.each([
    ['Skill', 0],
    ['Skill', 2],
    ['Labels', 0],
    ['Labels', 2]
  ])('keeps the %s heading distinct from usage with %i categories', (item, categoryCount) => {
    const columns: Column[] = runInNewContext(source.slice(config.start, config.end), {
      tags,
      item,
      keyTitle: item.toLowerCase(),
      visibleCategories: Array(categoryCount).fill({}),
      tagElements: new Map(),
      icon: 'icon',
      onTag: undefined,
      countSorting: () => 0
    })

    expect(columns[0].label).toBe(item)
    const countColumn = columns.find((column) => column.presenter === tags.component.TagElementCountPresenter)
    expect(countColumn?.label).toBe(tags.string.Usage)
  })
})
