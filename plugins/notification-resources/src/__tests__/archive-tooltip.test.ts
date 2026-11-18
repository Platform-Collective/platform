// Copyright © 2026 Hardcore Engineering Inc.
// Licensed under the Eclipse Public License, Version 2.0.

import { parse } from 'svelte/compiler'

// This UI package includes Jest types; keep the Node-only fixture APIs local to this test.
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('node:fs')
const { join } = jest.requireActual<{ join: (...paths: string[]) => string }>('node:path')
const { runInNewContext } = jest.requireActual<{ runInNewContext: (code: string, context: object) => unknown }>(
  'node:vm'
)
const { cwd } = jest.requireActual<{ cwd: () => string }>('node:process')

describe('inbox archive controls', () => {
  const source = readFileSync(join(cwd(), 'src/components/DocNotifyContextCard.svelte'), 'utf8')
  // The template parser does not need the component's TypeScript script or styles.
  const template = source.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
  const labels: Array<string | undefined> = []
  const seen = new Set<object>()

  function visit (value: any, tooltip?: any): void {
    if (value === null || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (seen.size > 10000) throw new Error('Unexpectedly large component template')
    const action = value.attributes?.find(
      (attribute: any) => attribute.type === 'Action' && attribute.name === 'tooltip'
    )
    const currentTooltip = action ?? tooltip
    if (value.type === 'InlineComponent' && value.name === 'CheckBox') {
      const label = currentTooltip?.expression?.properties?.find(
        (property: any) => property.key?.name === 'label'
      )?.value
      labels.push(label === undefined ? undefined : template.slice(label.start, label.end))
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        child.forEach((node) => {
          visit(node, currentTooltip)
        })
      } else visit(child, currentTooltip)
    }
  }

  visit(parse(template).html)

  it('covers the cards with and without a loaded document', () => {
    expect(labels).toHaveLength(2)
  })

  it.each([false, true])('labels both archive controls when archived=%s', (archived) => {
    const view = { string: { Archive: 'Archive', UnArchive: 'Unarchive' } }
    for (const label of labels) {
      expect(label).toBeDefined()
      // Evaluate the actual template binding in both states with distinct translation keys.
      const resolved = runInNewContext(`(${label})`, { archived, view })
      expect(resolved).toBe(archived ? 'Unarchive' : 'Archive')
    }
  })
})
