// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import { writable, type Readable } from 'svelte/store'
import plugin from '../../plugin'
import { type ComponentPointExtension } from '../../types'
import { getClient } from '../../utils'

const extensions = writable<ComponentPointExtension[]>([])
let requested = false

/** Link presenters plugins register at presentation.extension.LinkMark; model documents, so loaded once. */
export function linkMarkExtensions (): Readable<ComponentPointExtension[]> {
  if (!requested) {
    requested = true
    try {
      getClient()
        .findAll(plugin.class.ComponentPointExtension, { extension: plugin.extension.LinkMark })
        .then((result) => {
          extensions.set(result)
        })
        .catch((err: unknown) => {
          requested = false
          Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
        })
    } catch (err: unknown) {
      // No client yet: let the next Mark ask again
      requested = false
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    }
  }
  return extensions
}

/** The first link presenter whose props.hrefPattern matches the href; undefined keeps the plain link. */
export function linkMarkExtensionFor (
  all: ComponentPointExtension[],
  href: unknown
): ComponentPointExtension | undefined {
  if (typeof href !== 'string' || href === '') return undefined
  return all.find((it) => {
    const pattern = it.props?.hrefPattern
    if (typeof pattern !== 'string') return false
    try {
      return new RegExp(pattern).test(href)
    } catch {
      return false
    }
  })
}
