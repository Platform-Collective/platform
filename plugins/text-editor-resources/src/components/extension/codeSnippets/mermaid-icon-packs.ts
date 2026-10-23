// SPDX-License-Identifier: EPL-2.0

import type { Mermaid } from 'mermaid'

let iconPacksRegistered = false

export function registerMermaidIconPacks (mermaid: Pick<Mermaid, 'registerIconPacks'>): void {
  if (iconPacksRegistered) return

  mermaid.registerIconPacks([
    {
      name: 'logos',
      loader: async () => (await import('@iconify-json/logos')).icons
    },
    {
      name: 'mdi',
      loader: async () => (await import('@iconify-json/mdi')).icons
    }
  ])

  iconPacksRegistered = true
}
