// SPDX-License-Identifier: EPL-2.0

import { readFileSync } from 'fs'
import { join } from 'path'
import { runInNewContext } from 'vm'
import * as ts from 'typescript'

// Execute the production grouping and each-block expressions on both the old and new component.
test('the label picker includes labels whose category is no longer loaded', () => {
  const source = readFileSync(join(__dirname, '../components/TagsPopup.svelte'), 'utf8')
  const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)?.[1]
  if (script === undefined) throw new Error('Missing component script')
  const grouping = ts
    .createSourceFile('component.ts', script, ts.ScriptTarget.Latest, true)
    .statements.find((node) => ts.isLabeledStatement(node) && node.statement.getText().startsWith('groups ='))
  const each = source.match(/\{#each (categories|groups) as cat, i(?: \(cat\._id\))?\}/)?.[1]
  const itemExpression = source.match(/\{@const catObjects = ([^\n]+)\}/)?.[1]
  if (each === undefined || itemExpression === undefined) throw new Error('Missing picker each block')
  const objects = [
    { _id: 'known-label', category: 'known' },
    { _id: 'orphan', category: 'deleted' }
  ]
  const state = {
    categories: [{ _id: 'known', label: 'Known' }],
    objects,
    tags: { category: { NoCategory: 'none' } },
    tagSort: (a: { _id: string }, b: { _id: string }) => a._id.localeCompare(b._id),
    groupTagElements: grouping === undefined ? undefined : require('../tag-category-groups').groupTagElements
  }
  if (grouping !== undefined) {
    runInNewContext(ts.transpileModule(grouping.getText(), {}).outputText, state)
  }
  const visible = runInNewContext(`${each}.flatMap((cat) => ${itemExpression})`, state)
  expect(visible.map((item: { _id: string }) => item._id).sort()).toEqual(['known-label', 'orphan'])
})
