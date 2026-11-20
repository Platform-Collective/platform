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

interface ArchiveLabels {
  tooltip: string | undefined
  ariaLabel: string | undefined
}

describe('inbox archive controls', () => {
  const source = readFileSync(join(cwd(), 'src/components/DocNotifyContextCard.svelte'), 'utf8')
  // The template parser does not need the component's TypeScript script or styles.
  const template = source.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
  const labels: ArchiveLabels[] = []
  const seen = new Set<object>()

  function expressionSource (expression: any): string | undefined {
    return expression === undefined ? undefined : template.slice(expression.start, expression.end)
  }

  function visit (value: any, tooltip?: any): void {
    if (value === null || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (seen.size > 10000) throw new Error('Unexpectedly large component template')
    const action = value.attributes?.find(
      (attribute: any) => attribute.type === 'Action' && attribute.name === 'tooltip'
    )
    const currentTooltip = action ?? tooltip
    if (value.type === 'InlineComponent' && value.name === 'CheckBox') {
      const tooltipLabel = currentTooltip?.expression?.properties?.find(
        (property: any) => property.key?.name === 'label'
      )?.value
      const ariaLabel = value.attributes?.find(
        (attribute: any) => attribute.type === 'Attribute' && attribute.name === 'label'
      )?.value?.[0]?.expression
      labels.push({ tooltip: expressionSource(tooltipLabel), ariaLabel: expressionSource(ariaLabel) })
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
      expect(label.tooltip).toBeDefined()
      expect(label.ariaLabel).toBeDefined()
      // Evaluate the actual template bindings in both states with distinct translation keys.
      const tooltip = runInNewContext(`(${label.tooltip})`, { archived, view })
      const ariaLabel = runInNewContext(`(${label.ariaLabel})`, { archived, view })
      expect(tooltip).toBe(archived ? 'Unarchive' : 'Archive')
      expect(ariaLabel).toBe(archived ? 'Unarchive' : 'Archive')
    }
  })
})
