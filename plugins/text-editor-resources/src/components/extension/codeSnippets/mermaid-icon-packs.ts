// SPDX-License-Identifier: EPL-2.0

import type { Mermaid } from 'mermaid'

// Iconify packs that Mermaid diagrams can reference as `logos:<name>` and `mdi:<name>`.
//
// NOTE: these packs are NOT available in the desktop (Electron) app.
//
// Why: together the two packs are about 11 MB of JSON. The web build loads them lazily
// from a separate chunk, but the desktop build emits a single bundle, and minifying that
// bundle with the packs inside runs out of memory. desktop/webpack.config.js therefore
// aliases both packages to `false`, so webpack substitutes an empty module and the JSON
// is never parsed in the desktop build.
//
// What desktop users see: Mermaid diagrams still render. Icons from the `logos` and `mdi`
// packs are drawn as Mermaid's "?" placeholder, because loadIconPack() rejects for an
// excluded pack and Mermaid falls back to its unknown-icon glyph.
//
// How to lift it: serve the pack JSON at runtime (for example as static assets fetched on
// demand from the front server) instead of bundling it, then drop the desktop aliases.

let iconPacksRegistered = false

export async function loadIconPack<T> (name: string, pack: Promise<{ icons?: T }>): Promise<T> {
  const { icons } = await pack
  if (icons === undefined) {
    // The package resolved to an empty module: it is excluded from this build (desktop).
    throw new Error(`Mermaid icon pack "${name}" is not included in this build`)
  }
  return icons
}

export function registerMermaidIconPacks (mermaid: Pick<Mermaid, 'registerIconPacks'>): void {
  if (iconPacksRegistered) return

  mermaid.registerIconPacks([
    {
      name: 'logos',
      loader: async () => await loadIconPack('logos', import('@iconify-json/logos'))
    },
    {
      name: 'mdi',
      loader: async () => await loadIconPack('mdi', import('@iconify-json/mdi'))
    }
  ])

  iconPacksRegistered = true
}
