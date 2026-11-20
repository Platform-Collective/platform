// SPDX-License-Identifier: EPL-2.0

import type { Asset, IntlString } from '@hcengineering/platform'
import type { InlineCommandItem } from '../extension/inlineCommandItems'
import { inlineCommandsConfig } from '../extensions'

jest.mock('@hcengineering/ui', () => ({ IconScribble: 'scribble' }))
jest.mock('@hcengineering/text-editor', () => ({
  __esModule: true,
  default: { string: {} }
}))
jest.mock('@hcengineering/view', () => ({
  __esModule: true,
  default: { icon: {} }
}))
jest.mock('../InlineCommandsList.svelte', () => ({}))
jest.mock('../node-view', () => ({ SvelteRenderer: jest.fn() }))

const command: InlineCommandItem = {
  id: 'document-subpage',
  label: 'Subpage' as IntlString,
  icon: 'document' as Asset,
  action: async () => {}
}

describe('host command permissions after the editor is mounted', () => {
  it('offers a command when permission data arrives after extension creation', () => {
    let commands: InlineCommandItem[] = []
    const config = inlineCommandsConfig(
      async () => {},
      [],
      () => commands
    )
    const items = (): Array<{ id: string }> => (config.suggestion as any).items({})
    expect(items().some(({ id }) => id === command.id)).toBe(false)
    commands = [command]
    expect(items().some(({ id }) => id === command.id)).toBe(true)
  })

  it('removes a command when permission is revoked after extension creation', () => {
    let commands: InlineCommandItem[] = [command]
    const config = inlineCommandsConfig(
      async () => {},
      [],
      () => commands
    )
    const items = (): Array<{ id: string }> => (config.suggestion as any).items({})
    expect(items().some(({ id }) => id === command.id)).toBe(true)
    commands = []
    expect(items().some(({ id }) => id === command.id)).toBe(false)
  })
})
